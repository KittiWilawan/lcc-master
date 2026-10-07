"""Train pose classifiers with training-only fold mining; expose validation only."""
import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

from runtime_augmentation import augment_window, balanced_clip_weights, difficulty_multipliers
from train_runtime_classifier import estimated_native_bytes, rank, score_records, source_metrics, transform, windows


def training_rows(records, runtime, model, config, np):
    rows, labels, sources, clips, groups = [], [], [], [], []
    for record in records:
        positive = record["case"]["label"] == "fall"
        for sampling in config["samplingAugmentations"]:
            for timestamp, observed in windows(record, runtime, model, **sampling):
                if positive and timestamp < record["durationMs"] * config["positiveTailFraction"]:
                    continue
                rows.append(np.asarray(observed, dtype=np.float32))
                labels.append(int(positive))
                sources.append(record["case"]["dataset"])
                clips.append(record["sha256"])
                groups.append(record["case"]["dataset"] + ":" + record["case"]["subject_id"])
    return rows, np.asarray(labels), sources, clips, groups


def fold_scores(rows, labels, sources, clips, groups, config, model, np, joblib, factories):
    features = np.stack([transform(row, model, np) for row in rows])
    fingerprint = hashlib.sha256(features.tobytes() + labels.tobytes() + json.dumps(
        {"groups": groups, "mining": config["foldMining"]}, sort_keys=True).encode()).hexdigest()
    cache = Path(config["foldScoreCache"])
    if cache.exists():
        saved = np.load(cache)
        if str(saved["fingerprint"]) != fingerprint:
            raise ValueError("Training fold cache belongs to another configuration")
        return saved["scores"]
    mining = config["foldMining"]
    assignments = {}
    for source in sorted(set(sources)):
        source_groups = sorted({group for group, name in zip(groups, sources) if name == source},
            key=lambda group: hashlib.sha256(f"{mining['seed']}:{group}".encode()).hexdigest())
        assignments.update({group: index % mining["folds"] for index, group in enumerate(source_groups)})
    fold_ids = np.asarray([assignments[group] for group in groups])
    scores = np.full(len(rows), np.nan)
    evidence = []
    for fold in range(mining["folds"]):
        held = fold_ids == fold
        fitted = ~held
        classifier = factories[mining["kind"]](**mining["parameters"])
        chosen = np.flatnonzero(fitted)
        weights = balanced_clip_weights([clips[index] for index in chosen], [sources[index] for index in chosen], mining["sourceWeights"], np)
        classifier.fit(features[fitted], labels[fitted], sample_weight=weights)
        scores[held] = classifier.predict_proba(features[held])[:, 1]
        evidence.append({"fold": fold, "trainingGroups": sorted(set(np.asarray(groups)[fitted])),
            "heldGroups": sorted(set(np.asarray(groups)[held])), "heldWindows": int(held.sum())})
        print(json.dumps({"miningFold": fold, "heldWindows": int(held.sum())}), flush=True)
    if not np.isfinite(scores).all():
        raise ValueError("Incomplete training-only fold scores")
    np.savez_compressed(cache, fingerprint=fingerprint, scores=scores)
    cache.with_suffix(".json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return scores


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[name] = str(config["threads"])
    sys.path.insert(0, config["mlLibraries"])
    import joblib
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier, ExtraTreesClassifier
    factories = {"hist_gradient": HistGradientBoostingClassifier, "extra_trees": ExtraTreesClassifier}
    runtime = json.loads(Path(config["runtimeAsset"]).read_text(encoding="utf-8"))
    model = json.loads(Path(config["modelMetadata"]).read_text(encoding="utf-8"))
    records = [json.loads(line) for line in Path(config["checkpoint"]).read_text(encoding="utf-8").splitlines()]
    hashes, subjects = {}, {}
    for record in records:
        split = record["case"]["split"]
        for key, mapping in ((record["sha256"], hashes), ((record["case"]["dataset"], record["case"]["subject_id"]), subjects)):
            if key in mapping and mapping[key] != split:
                raise ValueError("Participant or video leaks across partitions")
            mapping[key] = split
    train = [record for record in records if record["case"]["split"] == "train"]
    validation = [record for record in records if record["case"]["split"] == "validation"]
    rows, labels, sources, clips, groups = training_rows(train, runtime, model, config, np)
    weights = balanced_clip_weights(clips, sources, config["sourceWeights"], np)
    mining_scores = fold_scores(rows, labels, sources, clips, groups, config, model, np, joblib, factories)
    weights *= difficulty_multipliers(labels, mining_scores, config["difficultyWeighting"], np)
    rng = np.random.default_rng(config["augmentationSeed"])
    augmented, expanded_labels, expanded_weights = [], [], []
    for row, label, weight in zip(rows, labels, weights):
        for specification in config["featureAugmentations"]:
            augmented.append(transform(augment_window(row, model, specification, rng, np), model, np))
            expanded_labels.append(label)
            expanded_weights.append(weight / len(config["featureAugmentations"]))
    features = np.stack(augmented)
    del augmented, rows
    weights = np.asarray(expanded_weights)
    weights /= weights.mean()
    fitted, results = {}, {}
    for candidate in config["candidates"]:
        classifier = factories[candidate["kind"]](**candidate["parameters"])
        classifier.fit(features, np.asarray(expanded_labels), sample_weight=weights)
        scored = score_records(classifier, validation, runtime, model, np)
        choices = [(rank(source_metrics(validation, scored, threshold, runtime)), threshold) for threshold in config["thresholds"]]
        _, threshold = max(choices, key=lambda pair: pair[0])
        metrics = source_metrics(validation, scored, threshold, runtime)
        size = estimated_native_bytes(classifier)
        results[candidate["name"]] = {"threshold": threshold, "metrics": metrics, "estimatedNativeBytes": size,
            "fitsMobileBudget": size <= config["maxNativeModelBytes"]}
        fitted[candidate["name"]] = classifier
        print(json.dumps({"trained": candidate["name"], "validation": metrics, "threshold": threshold}), flush=True)
    eligible = [name for name, item in results.items() if item["fitsMobileBudget"]]
    if not eligible:
        raise ValueError("No classifier fits the mobile budget")
    selected = max(eligible, key=lambda name: rank(results[name]["metrics"]))
    baseline = joblib.load(config["baselineModel"])
    baseline_model = {**model, "featureVariant": baseline["feature_variant"], "framesPerWindow": baseline["frames_per_video"]}
    report = {"selectionRule": "Validation only, maximize worst per-source recall/specificity then combined F1",
        "labelScope": "Weak clip labels, late fall windows; geometry augmentation is synthetic, not additional recorded clips",
        "selected": selected, "threshold": results[selected]["threshold"], "validationCandidates": results,
        "features": list(features.shape), "canonicalWindows": len(labels), "eligibleTrainingClips": len(set(clips)),
        "sourceCanonicalWindows": dict(Counter(sources)),
        "partitionClips": dict(Counter(record["case"]["split"] for record in records)),
        "baselineValidation": source_metrics(validation, score_records(baseline["model"], validation, runtime, baseline_model, np), baseline["threshold"], runtime),
        "runtimeSubjectAndShaPartitionsDisjoint": True, "testEvaluated": False,
        "checkpointSha256": hashlib.sha256(Path(config["checkpoint"]).read_bytes()).hexdigest(), "config": config}
    output = Path(config["output"])
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": fitted[selected], "feature_variant": model["featureVariant"], "frames_per_video": model["framesPerWindow"],
        "threshold": report["threshold"], "normalization": {key: model[key] for key in ("landmarkCount", "visibilityThreshold", "normalizationMinScale")},
        "training_report": report}, output / "runtime-pose-classifier.joblib")
    (output / "training-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
