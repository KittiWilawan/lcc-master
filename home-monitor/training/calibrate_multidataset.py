import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants
from benchmark_multidataset import merge_caches, metrics_by_source, read_cache, validation_rank


def read_arguments():
    parser = argparse.ArgumentParser(description="Calibrate an existing model across independent datasets")
    parser.add_argument("primary_cache", type=Path)
    parser.add_argument("additional_cache", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--primary-name", required=True)
    parser.add_argument("--additional-name", required=True)
    return parser.parse_args()


def main():
    args = read_arguments()
    data = merge_caches(
        read_cache(args.primary_cache, args.primary_name),
        read_cache(args.additional_cache, args.additional_name),
    )
    artifact = joblib.load(args.model)
    variants = feature_variants(data["features"], int(artifact["frames_per_video"]))
    features = variants[artifact["feature_variant"]]
    candidates = []
    for threshold in np.linspace(0.1, 0.99, 179):
        value = float(threshold)
        validation = metrics_by_source(
            artifact["model"], features, data["labels"], data["splits"], data["sources"],
            "validation", value,
        )
        candidates.append((validation_rank(validation), value, validation))
    _, selected_threshold, validation = max(candidates, key=lambda item: item[0])
    report = {
        "selection_rule": "maximize worst per-dataset validation balance, then worst F1",
        "original_threshold": float(artifact["threshold"]),
        "selected_threshold": selected_threshold,
        "validation": validation,
        "test": metrics_by_source(
            artifact["model"], features, data["labels"], data["splits"], data["sources"],
            "test", selected_threshold,
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
