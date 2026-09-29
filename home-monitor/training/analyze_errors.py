import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants
from train_pose_classifier import split_arrays


def read_arguments():
    parser = argparse.ArgumentParser(description="Analyze fall classifier errors without tuning on test labels")
    parser.add_argument("model", type=Path)
    parser.add_argument("feature_cache", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def counts(items, field):
    return dict(sorted(Counter(item[field] for item in items).items()))


def main():
    args = read_arguments()
    artifact = joblib.load(args.model)
    cache = np.load(args.feature_cache)
    features, labels, splits = cache["features"], cache["labels"], cache["splits"]
    selected = feature_variants(features, artifact["frames_per_video"])[artifact["feature_variant"]]
    test_features, test_labels = split_arrays(selected, labels, splits, "test")
    base_test_features, _ = split_arrays(features, labels, splits, "test")
    probabilities = artifact["model"].predict_proba(test_features)[:, 1]
    predictions = probabilities >= artifact["threshold"]
    with args.manifest.open("r", encoding="utf-8-sig", newline="") as source:
        test_rows = [row for row in csv.DictReader(source) if row["split"] == "test"]
    per_frame = base_test_features.shape[1] // artifact["frames_per_video"]
    sequences = base_test_features.reshape(len(test_rows), artifact["frames_per_video"], per_frame)
    cases = []
    for index, row in enumerate(test_rows):
        expected_fall = test_labels[index] == 1
        predicted_fall = bool(predictions[index])
        if expected_fall == predicted_fall:
            continue
        cases.append({
            **row,
            "error_type": "false_negative" if expected_fall else "false_positive",
            "probability": float(probabilities[index]),
            "pose_frames_found": int(np.sum(sequences[index, :, -1] > 0)),
        })
    false_positives = [item for item in cases if item["error_type"] == "false_positive"]
    false_negatives = [item for item in cases if item["error_type"] == "false_negative"]
    result = {
        "errors": len(cases),
        "false_positives": len(false_positives),
        "false_negatives": len(false_negatives),
        "by_action": counts(cases, "action_id"),
        "by_location": counts(cases, "location_id"),
        "by_subject": counts(cases, "subject_id"),
        "by_side": counts(cases, "side"),
        "cases": cases,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "cases"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
