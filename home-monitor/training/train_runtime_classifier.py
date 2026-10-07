"""Train runtime-shaped windows; select exclusively on validation subjects.

Fall clips have weak video labels. Their late windows are positive training
examples, not manually labelled fall onsets. Evaluation is clip-level.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def windows(record, runtime, model, stride=1, phase=0):
    if stride < 1 or not 0 <= phase < stride:
        raise ValueError("Invalid temporal sampling configuration")
    history, previous = [], None
    count = model["framesPerWindow"]
    for index in range(phase, len(record["frames"]), stride):
        timestamp = record["timestampsMs"][index]
        if previous is not None and timestamp - previous > runtime["maxPoseGapMs"]:
            history.clear()
        frame = record["frames"][index]
        if frame[-1] <= 0:
            continue
        previous = timestamp
        history.append((timestamp, frame))
        history = [item for item in history if timestamp - item[0] <= runtime["maxWindowAgeMs"]][-count:]
        if len(history) < runtime["minTrackFrames"]:
            continue
        observed = [item[1] for item in history]
        if len(observed) < count:
            if runtime["initialWindowPolicy"] != "repeat_initial":
                continue
            observed = [observed[0]] * (count - len(observed)) + observed
        yield timestamp, observed


def transform(observed, model, np):
    sequence = np.asarray(observed, dtype=np.float32)
    if model["featureVariant"] in ("invariant", "invariant_temporal"):
        sequence = sequence[:, :model["landmarkCount"] * 4]
    if model["featureVariant"] in ("base", "invariant"):
        return sequence.reshape(-1)
    if model["featureVariant"] not in ("temporal", "invariant_temporal"):
        raise ValueError("Unsupported runtime feature variant")
    mean = sequence.astype(np.float64).mean(axis=0).astype(np.float32)
    deviation = np.sqrt(np.square((sequence - mean).astype(np.float64)).mean(axis=0)).astype(np.float32)
    return np.concatenate((sequence.reshape(-1), np.diff(sequence, axis=0).reshape(-1),
        mean, deviation, sequence.min(axis=0), sequence.max(axis=0)))


def clip_metrics(records, probabilities, threshold, runtime):
    tp = tn = fp = fn = 0
    for record, scored in zip(records, probabilities):
        confirmations = 0
        last_high = None
        detected = False
        for timestamp, probability in scored:
            if last_high is not None and timestamp - last_high > runtime["confirmationMaxGapMs"]:
                confirmations = 0
            if probability >= threshold:
                confirmations += 1
                last_high = timestamp
            else:
                confirmations = 0
            if confirmations >= runtime["confirmations"]:
                detected = True
        positive = record["case"]["label"] == "fall"
        if positive and detected: tp += 1
        elif positive: fn += 1
        elif detected: fp += 1
        else: tn += 1
    total = tp + tn + fp + fn
    return {"clips": total, "tp": tp, "tn": tn, "fp": fp, "fn": fn,
        "accuracy": (tp + tn) / total if total else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "specificity": tn / (tn + fp) if tn + fp else None,
        "precision": tp / (tp + fp) if tp + fp else None,
        "f1": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0}


def score_records(classifier, records, runtime, model, np):
    values, spans = [], []
    for record in records:
        sequence = list(windows(record, runtime, model))
        start = len(values)
        values.extend(transform(observed, model, np) for _, observed in sequence)
        spans.append((start, len(values), [timestamp for timestamp, _ in sequence]))
    scores = classifier.predict_proba(np.stack(values))[:, 1] if values else []
    return [list(zip(times, scores[start:end].tolist())) for start, end, times in spans]


def source_metrics(records, scored, threshold, runtime):
    output = {"combined": clip_metrics(records, scored, threshold, runtime)}
    for name in sorted({item["case"]["dataset"] for item in records}):
        chosen = [index for index, item in enumerate(records) if item["case"]["dataset"] == name]
        output[name] = clip_metrics([records[index] for index in chosen], [scored[index] for index in chosen], threshold, runtime)
    return output


def rank(metrics):
    individual = [value for name, value in metrics.items() if name != "combined"]
    return (min(min(value["recall"], value["specificity"]) for value in individual),
        metrics["combined"]["f1"], metrics["combined"]["specificity"])


def estimated_native_bytes(classifier):
    if type(classifier).__name__ == "HistGradientBoostingClassifier":
        counts = [len(stage[0].nodes) for stage in classifier._predictors]
        baseline_bytes = 8
    else:
        counts = [tree.tree_.node_count for tree in classifier.estimators_]
        baseline_bytes = 0
    # Binary protocol: three int headers, optional baseline, node count per tree,
    # three ints and two doubles per node.
    return 3 * 4 + baseline_bytes + len(counts) * 4 + sum(counts) * (3 * 4 + 2 * 8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if config["threads"] <= 0 or not 0 <= config["positiveTailFraction"] < 1:
        raise ValueError("Invalid training configuration")
    os.environ["OMP_NUM_THREADS"] = str(config["threads"])
    os.environ["OPENBLAS_NUM_THREADS"] = str(config["threads"])
    sys.path.insert(0, config["mlLibraries"])
    import joblib
    import numpy as np
    from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
    runtime = json.loads(Path(config["runtimeAsset"]).read_text(encoding="utf-8"))
    model = json.loads(Path(config["modelMetadata"]).read_text(encoding="utf-8"))
    records = [json.loads(line) for line in Path(config["checkpoint"]).read_text(encoding="utf-8").splitlines()]
    expected = json.loads(Path(config["provenance"]).read_text(encoding="utf-8"))
    if len(records) != expected["remaining"] + expected["completedAtStart"]:
        raise ValueError("Extraction is incomplete")
    seen_hashes, seen_subjects = {}, {}
    for record in records:
        split = record["case"]["split"]
        subject = record["case"]["dataset"], record["case"]["subject_id"]
        for key, mapping in ((record["sha256"], seen_hashes), (subject, seen_subjects)):
            if key in mapping and mapping[key] != split:
                raise ValueError("Subject or identical video leaks across partitions")
            mapping[key] = split
    train = [item for item in records if item["case"]["split"] == "train"]
    val = [item for item in records if item["case"]["split"] == "validation"]
    test = [item for item in records if item["case"]["split"] == "test"]
    data, labels, weights, sources = [], [], [], []
    for record in train:
        selected = []
        for augmentation in config["samplingAugmentations"]:
            for timestamp, observed in windows(record, runtime, model, **augmentation):
                if record["case"]["label"] == "fall" and timestamp < record["durationMs"] * config["positiveTailFraction"]:
                    continue
                selected.append(transform(observed, model, np))
        if selected:
            data.extend(selected)
            labels.extend([int(record["case"]["label"] == "fall")] * len(selected))
            weights.extend([1 / len(selected)] * len(selected))
            sources.extend([record["case"]["dataset"]] * len(selected))
    for dataset in config["supplementalTrainingCaches"]:
        cached = np.load(dataset["path"])
        selected = cached["splits"] == "train"
        raw = cached["features"][selected].reshape(-1, model["framesPerWindow"], model["landmarkCount"] * 4 + 6)
        eligible = (raw[:, :, -1] > 0).sum(axis=1) >= runtime["minTrackFrames"]
        for observed, label in zip(raw[eligible], cached["labels"][selected][eligible]):
            data.append(transform(observed, model, np)); labels.append(int(label)); weights.append(1.)
            sources.append(dataset["name"])
    source_array = np.asarray(sources)
    weights = np.asarray(weights)
    for name in set(sources):
        indices = source_array == name
        weights[indices] *= config["sourceWeights"][name] / weights[indices].sum()
    weights /= weights.mean()
    features = np.stack(data)
    validation_results = {}
    fitted = {}
    factories = {"hist_gradient": HistGradientBoostingClassifier, "extra_trees": ExtraTreesClassifier}
    for candidate in config["candidates"]:
        classifier = factories[candidate["kind"]](**candidate["parameters"])
        classifier.fit(features, np.asarray(labels), sample_weight=weights)
        scored = score_records(classifier, val, runtime, model, np)
        selections = [(rank(source_metrics(val, scored, threshold, runtime)), threshold) for threshold in config["thresholds"]]
        _, threshold = max(selections, key=lambda value: value[0])
        metrics = source_metrics(val, scored, threshold, runtime)
        native_bytes = estimated_native_bytes(classifier)
        validation_results[candidate["name"]] = {"threshold": threshold, "metrics": metrics,
            "estimatedNativeBytes": native_bytes, "fitsMobileBudget": native_bytes <= config["maxNativeModelBytes"]}
        fitted[candidate["name"]] = classifier
        print(json.dumps({"trained": candidate["name"], "threshold": threshold, "validation": metrics}), flush=True)
    within_budget = [name for name, result in validation_results.items() if result["fitsMobileBudget"]]
    if not within_budget:
        raise ValueError("No model fits configured mobile asset budget")
    selected_name = max(within_budget, key=lambda name: rank(validation_results[name]["metrics"]))
    selected = fitted[selected_name]
    threshold = validation_results[selected_name]["threshold"]
    baseline = joblib.load(config["baselineModel"])
    baseline_metadata = {**model, "featureVariant": baseline["feature_variant"], "framesPerWindow": baseline["frames_per_video"]}
    report = {"selectionRule": "maximize worst per-source validation sensitivity/specificity, then combined F1",
        "labelScope": "Weak video labels; positive late training windows are not labelled fall onsets",
        "features": list(features.shape), "sourceTrainingWindows": {name: sources.count(name) for name in set(sources)},
        "partitionClips": {"train": len(train), "validation": len(val), "test": len(test)},
        "runtimeSubjectAndShaPartitionsDisjoint": True, "validationCandidates": validation_results,
        "supplementalScope": "Training partition only, mapped keypoints; grouping inherited from source cache",
        "selected": selected_name, "threshold": threshold,
        "baselineValidation": source_metrics(val, score_records(baseline["model"], val, runtime, baseline_metadata, np), baseline["threshold"], runtime),
        "baselineTest": source_metrics(test, score_records(baseline["model"], test, runtime, baseline_metadata, np), baseline["threshold"], runtime),
        "candidateTest": source_metrics(test, score_records(selected, test, runtime, model, np), threshold, runtime),
        "config": config, "checkpointSha256": hashlib.sha256(Path(config["checkpoint"]).read_bytes()).hexdigest()}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": selected, "feature_variant": model["featureVariant"], "frames_per_video": model["framesPerWindow"],
        "threshold": threshold, "normalization": {key: model[key] for key in ("landmarkCount", "visibilityThreshold", "normalizationMinScale")},
        "training_report": report}, out / "runtime-pose-classifier.joblib")
    (out / "training-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"selected": selected_name, "test": report["candidateTest"]}), flush=True)


if __name__ == "__main__":
    main()
