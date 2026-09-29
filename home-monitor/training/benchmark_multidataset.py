import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import candidates, feature_variants
from train_pose_classifier import evaluate, select_threshold, split_arrays


def read_arguments():
    parser = argparse.ArgumentParser(description="Train and compare a pose classifier across datasets")
    parser.add_argument("primary_cache", type=Path)
    parser.add_argument("additional_cache", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--baseline-model", type=Path, required=True)
    parser.add_argument("--primary-name", required=True)
    parser.add_argument("--additional-name", required=True)
    parser.add_argument("--frames-per-video", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260926)
    return parser.parse_args()


def read_cache(path, source_name):
    cache = np.load(path)
    count = len(cache["labels"])
    return {
        "features": cache["features"],
        "labels": cache["labels"],
        "splits": cache["splits"],
        "sources": np.full(count, source_name),
    }


def merge_caches(primary, additional):
    return {
        key: np.concatenate((primary[key], additional[key]))
        for key in ("features", "labels", "splits", "sources")
    }


def metrics_by_source(model, features, labels, splits, sources, split, threshold):
    output = {}
    for source in sorted(set(sources.tolist())):
        selected = (splits == split) & (sources == source)
        output[source] = evaluate(model, features[selected], labels[selected], threshold)
    selected = splits == split
    output["combined"] = evaluate(model, features[selected], labels[selected], threshold)
    return output


def validation_rank(source_metrics):
    individual = [metrics for name, metrics in source_metrics.items() if name != "combined"]
    worst_balance = min(min(metrics["recall"], metrics["specificity"]) for metrics in individual)
    worst_f1 = min(metrics["f1"] for metrics in individual)
    return worst_balance, worst_f1, source_metrics["combined"]["f1"]


def evaluate_baseline(artifact_path, data, frames_per_video):
    artifact = joblib.load(artifact_path)
    variants = feature_variants(data["features"], frames_per_video)
    selected = variants[artifact["feature_variant"]]
    return metrics_by_source(
        artifact["model"], selected, data["labels"], data["splits"], data["sources"],
        "test", float(artifact["threshold"]),
    )


def main():
    args = read_arguments()
    primary = read_cache(args.primary_cache, args.primary_name)
    additional = read_cache(args.additional_cache, args.additional_name)
    data = merge_caches(primary, additional)
    validation_results = {}
    trained = {}
    test_features = {}

    for variant_name, variant_features in feature_variants(data["features"], args.frames_per_video).items():
        train_features, train_labels = split_arrays(
            variant_features, data["labels"], data["splits"], "train",
        )
        validation_features, validation_labels = split_arrays(
            variant_features, data["labels"], data["splits"], "validation",
        )
        for model_name, model in candidates(args.seed).items():
            name = f"{variant_name}:{model_name}"
            model.fit(train_features, train_labels)
            threshold = select_threshold(model, validation_features, validation_labels)
            source_metrics = metrics_by_source(
                model, variant_features, data["labels"], data["splits"], data["sources"],
                "validation", threshold,
            )
            validation_results[name] = {"threshold": threshold, "sources": source_metrics}
            trained[name] = model
            test_features[variant_name] = variant_features
            print(json.dumps({"trained": name, "validation": source_metrics}), flush=True)

    selected_name = max(
        validation_results,
        key=lambda name: validation_rank(validation_results[name]["sources"]),
    )
    selected_variant = selected_name.split(":", 1)[0]
    selected_model = trained[selected_name]
    selected_threshold = validation_results[selected_name]["threshold"]
    selected_features = test_features[selected_variant]
    report = {
        "selection_rule": "maximize worst per-dataset validation balance, then worst F1",
        "selected_model": selected_name,
        "selected_feature_variant": selected_variant,
        "selected_threshold": selected_threshold,
        "baseline_test": evaluate_baseline(args.baseline_model, data, args.frames_per_video),
        "improved_validation": validation_results[selected_name]["sources"],
        "improved_test": metrics_by_source(
            selected_model, selected_features, data["labels"], data["splits"], data["sources"],
            "test", selected_threshold,
        ),
        "split_counts": {
            split: {
                source: int(np.sum((data["splits"] == split) & (data["sources"] == source)))
                for source in sorted(set(data["sources"].tolist()))
            }
            for split in ("train", "validation", "test")
        },
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": selected_model,
        "feature_variant": selected_variant,
        "frames_per_video": args.frames_per_video,
        "threshold": selected_threshold,
    }, args.output_root / "selected-pose-fall-classifier.joblib")
    (args.output_root / "multidataset-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
