"""Fit memory-mapped runtime windows, freeze on validation, then audit regression once."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from binary_forest import BinaryForest
from extract_mobile_training import load_json, validate_partitions
from runtime_augmentation import augment_window, balanced_clip_weights
from train_runtime_classifier import estimated_native_bytes, rank, source_metrics, transform, windows


def read_records(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def unique_videos(records):
    unique, duplicates, seen = [], [], set()
    for record in records:
        if record["sha256"] in seen:
            duplicates.append(record["case"])
        else:
            unique.append(record)
            seen.add(record["sha256"])
    return unique, duplicates


def score_batched(classifier, records, runtime, metadata, batch_size, np):
    rows, destinations = [], []
    scores = [[] for _ in records]
    def flush():
        if not rows:
            return
        predicted = classifier.predict_proba(np.asarray(rows, dtype=np.float32))[:, 1]
        for (index, timestamp), probability in zip(destinations, predicted):
            scores[index].append((timestamp, float(probability)))
        rows.clear(); destinations.clear()
    for index, record in enumerate(records):
        for timestamp, observed in windows(record, runtime, metadata):
            rows.append(transform(observed, metadata, np)); destinations.append((index, timestamp))
            if len(rows) >= batch_size:
                flush()
    flush()
    return scores


def describe(records, scores, threshold, runtime):
    metrics = source_metrics(records, scores, threshold, runtime)
    coverage = {"noEligibleWindow": sum(not row for row in scores),
        "fewerThanConfirmationWindows": sum(len(row) < runtime["confirmations"] for row in scores)}
    return {"metrics": metrics, "coverage": coverage}


def report_status(path, process, **values):
    progress = {**values, "rssMiB": round(process.memory_info().rss/1024**2)}
    Path(path).write_text(json.dumps(progress), encoding="utf-8")
    print(json.dumps(progress), flush=True)


def choose_validation_threshold(choices, baseline):
    safe = [item for item in choices if item["metrics"]["combined"]["fn"] <= baseline["fn"] and
        item["metrics"]["combined"]["fp"] <= baseline["fp"]]
    return max(safe or choices, key=lambda item: rank(item["metrics"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = load_json(args.config)
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ[key] = str(config["threads"])
    import psutil
    process = psutil.Process()
    process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    process.cpu_affinity(process.cpu_affinity()[-config["threads"]:])
    import joblib
    import numpy as np
    import sklearn
    from sklearn.ensemble import HistGradientBoostingClassifier, ExtraTreesClassifier
    factories = {"hist_gradient": HistGradientBoostingClassifier, "extra_trees": ExtraTreesClassifier}
    output = Path(config["output"]); output.mkdir(parents=True, exist_ok=True)
    runtime, metadata = load_json(config["runtimeAsset"]), load_json(config["modelMetadata"])
    records = read_records(config["checkpoint"])
    manifest = load_json(config["manifest"])
    if {record["sha256"] for record in records} != {record["sha256"] for record in manifest} or len(records) != len(manifest):
        raise ValueError("Extraction is incomplete or duplicated")
    validate_partitions(records)
    helper = read_records(config["hardNegativeCache"])
    challenge = read_records(config["challengeCheckpoint"])
    challenge_manifest = load_json(config["challengeManifest"])
    if len(challenge) != len(challenge_manifest) or {row["sha256"] for row in challenge} != {row["sha256"] for row in challenge_manifest}:
        raise ValueError("Challenge extraction is incomplete")
    validate_partitions(records+helper+challenge)
    if any(row["case"]["split"] != "train" or row["case"]["label"] != "normal" for row in helper):
        raise ValueError("Manual helper annotations must be normal training cases")
    train = [row for row in records if row["case"]["split"] == "train"]
    validation = [row for row in records if row["case"]["split"] == "validation"]
    all_training = train+helper
    baseline = BinaryForest(config["baselineBinary"], np)
    baseline_metadata = load_json(config.get("baselineModelMetadata", config["modelMetadata"]))
    parity = load_json(config["baselineParity"])
    error = float(np.max(np.abs(baseline.predict_proba(parity["features"])[:, 1]-np.asarray(parity["probabilities"]))))
    if error > config["parityTolerance"]:
        raise ValueError("Baseline adapter does not match shipped export")
    baseline_scores = score_batched(baseline, validation, runtime, baseline_metadata, config["predictionBatchSize"], np)
    baseline_validation = describe(validation, baseline_scores, baseline_metadata["fallThreshold"], runtime)
    report_status(config["progress"], process, phase="baseline_validation", result=baseline_validation)

    specifications = config["featureAugmentations"]
    canonical = []
    for record in all_training:
        for sampling in config["samplingAugmentations"]:
            for timestamp, observed in windows(record, runtime, metadata, **sampling):
                positive = record["case"]["label"] == "fall"
                if positive and timestamp < record["durationMs"]*config["positiveTailFraction"]:
                    continue
                canonical.append((observed, int(positive), record["case"]["dataset"], record["sha256"]))
    shape = (len(canonical)*len(specifications), metadata["featureCount"])
    if not canonical or np.prod(shape)*np.dtype(np.float32).itemsize > config["maxFeatureBytes"]:
        raise ValueError("No windows or feature cache exceeds configured memory/disk budget")
    matrix_path = output/"training-features.f32"
    features = np.memmap(matrix_path, dtype=np.float32, mode="w+", shape=shape)
    labels = np.empty(shape[0], dtype=np.int8)
    clips, sources = [], []
    rng = np.random.default_rng(config["augmentationSeed"])
    for index, (observed, label, source, clip) in enumerate(canonical):
        for j, specification in enumerate(specifications):
            row = index*len(specifications)+j
            features[row] = transform(augment_window(observed, metadata, specification, rng, np), metadata, np)
            labels[row] = label; clips.append(clip); sources.append(source)
    features.flush()
    main_rows = sum(source != config["hardNegativeSource"] for source in sources)
    if any(source != config["hardNegativeSource"] for source in sources[main_rows:]):
        raise ValueError("Supplemental rows must be appended after the primary training corpus")
    del canonical
    report_status(config["progress"], process, phase="features_ready", featureShape=shape)
    results = {}
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    for trial in config["candidates"]:
        start = time.monotonic()
        n = shape[0] if trial["sourceWeights"][config["hardNegativeSource"]] > 0 else main_rows
        weights = balanced_clip_weights(clips[:n], sources[:n], trial["sourceWeights"], np)
        report_status(config["progress"], process, phase="fitting", candidate=trial["name"], rows=n)
        classifier = factories[trial["kind"]](**trial["parameters"])
        classifier.fit(features[:n], labels[:n], sample_weight=weights)
        scored = score_batched(classifier, validation, runtime, metadata, config["predictionBatchSize"], np)
        choices = [{"metrics": source_metrics(validation, scored, threshold, runtime), "threshold": threshold} for threshold in config["thresholds"]]
        threshold = choose_validation_threshold(choices, baseline_validation["metrics"]["combined"])["threshold"]
        result = describe(validation, scored, threshold, runtime)
        size = estimated_native_bytes(classifier)
        artifact_path = output/(trial["name"]+".joblib")
        artifact = {"model": classifier, "feature_variant": metadata["featureVariant"],
            "frames_per_video": metadata["framesPerWindow"], "threshold": threshold,
            "normalization": {key: metadata[key] for key in ("landmarkCount", "visibilityThreshold", "normalizationMinScale")},
            "training_report": {"configSha256": config_hash, "validation": result,
                "scope": "Full VIDEO single-actor poses; known news helper normal poses used only for training"}}
        joblib.dump(artifact, artifact_path)
        results[trial["name"]] = {**result, "threshold": threshold, "estimatedNativeBytes": size,
            "trainingRows": n, "trainingClips": len(set(clips[:n])),
            "sourceTrainingRows": dict(Counter(sources[:n])), "sourceWeights": trial["sourceWeights"],
            "withinMobileBudget": size <= config["maxNativeModelBytes"], "seconds": round(time.monotonic()-start, 2),
            "model": str(artifact_path.resolve()), "sha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest()}
        (output/"validation-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        report_status(config["progress"], process, phase="candidate_complete", candidate=trial["name"], result=results[trial["name"]])
        del classifier, artifact, scored
    eligible = [name for name, result in results.items() if result["withinMobileBudget"]]
    if not eligible:
        raise ValueError("No trained model fits mobile budget")
    reference = baseline_validation["metrics"]["combined"]
    nonregressing = [name for name in eligible if results[name]["metrics"]["combined"]["fn"] <= reference["fn"] and
        results[name]["metrics"]["combined"]["fp"] <= reference["fp"]]
    selected = max(nonregressing or eligible, key=lambda name: rank(results[name]["metrics"]))
    candidate = results[selected]
    measured = candidate["metrics"]["combined"]
    validation_gate = measured["fn"] <= reference["fn"] and measured["fp"] <= reference["fp"]
    frozen = {"selected": selected, **candidate, "frozenAtUtc": datetime.now(timezone.utc).isoformat(),
        "selectionRule": "Validation only: prefer candidates not increasing baseline FN/FP, then worst per-source recall/specificity, F1 and specificity",
        "validationGate": validation_gate, "baselineValidation": baseline_validation,
        "checkpointSha256": hashlib.sha256(Path(config["checkpoint"]).read_bytes()).hexdigest(),
        "configSha256": config_hash, "config": config,
        "versions": {"numpy": np.__version__, "sklearn": sklearn.__version__, "joblib": joblib.__version__},
        "featureShape": list(shape), "canonicalWindows": shape[0]//len(specifications),
        "sourceAugmentedWindows": dict(Counter(sources)), "eligibleTrainingClips": len(set(clips)),
        "partitionClips": dict(Counter(row["case"]["split"] for row in records)),
        "partitionPolicy": "Disjoint participants and video hashes; 499 videos were inspected previously and are regression, not an untouched test"}
    (output/"selection.json").write_text(json.dumps(frozen, indent=2), encoding="utf-8")
    report_status(config["progress"], process, phase="selection_frozen", selected=selected, validationGate=validation_gate)
    del features
    learned = joblib.load(candidate["model"])
    test, duplicates = unique_videos([row for row in records if row["case"]["split"] == "test"])
    evaluation = {}
    for name, classifier, threshold in (("current", baseline, baseline_metadata["fallThreshold"]),
        ("candidate", learned["model"], candidate["threshold"])):
        evaluation[name] = {}
        for cohort, data in (("regression499", test), ("elderly28", challenge)):
            profile = baseline_metadata if name == "current" else metadata
            scored = score_batched(classifier, data, runtime, profile, config["predictionBatchSize"], np)
            evaluation[name][cohort] = {**describe(data, scored, threshold, runtime),
                "cases": [{"case": row["case"], "sha256": row["sha256"],
                    "result": source_metrics([row], [scores], threshold, runtime)["combined"]}
                    for row, scores in zip(data, scored)]}
    old = evaluation["current"]["regression499"]["metrics"]["combined"]
    new = evaluation["candidate"]["regression499"]["metrics"]["combined"]
    old_elder = evaluation["current"]["elderly28"]["metrics"]["combined"]
    new_elder = evaluation["candidate"]["elderly28"]["metrics"]["combined"]
    gates = {"validationDidNotRegress": validation_gate, "regressionFallsDidNotRegress": new["fn"] <= old["fn"],
        "regressionFalseAlertsDidNotIncrease": new["fp"] <= old["fp"], "elderlyRecallDidNotRegress": new_elder["fn"] <= old_elder["fn"]}
    report = {"selected": selected, "results": evaluation, "offlineGates": gates,
        "duplicateVideosExcluded": duplicates,
        "readyForAndroidReplay": all(gates.values()), "androidReplayExecuted": False,
        "scope": "Frozen candidate evaluated once; no thresholds or fitting changed after regression. Elderly corpus is fall-only."}
    (output/"evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    import export_android_pose_model
    with_args = ["export", candidate["model"], config["landmarker"], str(output/"android-assets"),
        "--threshold", str(candidate["threshold"]), "--metadata-template", config["modelMetadata"]]
    sys.argv = with_args
    export_android_pose_model.main()
    report_status(config["progress"], process, phase="complete", selected=selected,
        currentRegression=old, candidateRegression=new, offlineGates=gates)


if __name__ == "__main__":
    main()
