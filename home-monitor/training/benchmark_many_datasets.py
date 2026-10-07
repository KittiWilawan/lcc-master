import argparse
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.pipeline import Pipeline

from benchmark_classifiers import candidates, feature_variants
from train_pose_classifier import evaluate, select_threshold, split_arrays


def read_arguments():
    parser = argparse.ArgumentParser(description="Train and compare a pose classifier across many datasets")
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--dataset", action="append", required=True, help="Dataset name=cache path")
    parser.add_argument("--baseline-model", type=Path, required=True)
    parser.add_argument("--frames-per-video", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260926)
    parser.add_argument("--include-svc", action="store_true")
    parser.add_argument("--model", action="append", help="Limit training to one or more candidate names")
    parser.add_argument("--source-weight-exponent", type=float, default=0.0)
    parser.add_argument("--min-detected-frames", type=int)
    parser.add_argument("--exclude-ineligible-from-train", action="store_true")
    return parser.parse_args()


def parse_dataset(value):
    name, separator, raw_path = value.partition("=")
    if not separator or not name or not raw_path:
        raise ValueError("Each dataset must use name=cache-path")
    cache = np.load(Path(raw_path))
    count = len(cache["labels"])
    return {
        "name": name,
        "features": cache["features"],
        "labels": cache["labels"],
        "splits": cache["splits"],
        "sources": np.full(count, name),
    }


def merge_datasets(datasets):
    return {
        key: np.concatenate([dataset[key] for dataset in datasets])
        for key in ("features", "labels", "splits", "sources")
    }


def metrics_by_source(model, features, data, split, threshold, eligible_mask=None):
    metrics = {}
    for source in sorted(set(data["sources"].tolist())):
        selected = (data["splits"] == split) & (data["sources"] == source)
        source_eligibility = eligible_mask[selected] if eligible_mask is not None else None
        metrics[source] = evaluate(
            model, features[selected], data["labels"][selected], threshold, source_eligibility,
        )
    selected = data["splits"] == split
    combined_eligibility = eligible_mask[selected] if eligible_mask is not None else None
    metrics["combined"] = evaluate(
        model, features[selected], data["labels"][selected], threshold, combined_eligibility,
    )
    return metrics


def rank(source_metrics):
    individual = [metrics for name, metrics in source_metrics.items() if name != "combined"]
    balances = [
        min(value for value in (metrics["recall"], metrics["specificity"]) if value is not None)
        for metrics in individual
    ]
    return (
        min(balances),
        min(metrics["f1"] for metrics in individual),
        source_metrics["combined"]["f1"],
    )


def source_weights(sources, exponent):
    if not np.isfinite(exponent) or exponent < 0:
        raise ValueError("source-weight-exponent must be a finite non-negative value")
    if exponent == 0:
        return None
    names, counts = np.unique(sources, return_counts=True)
    counts_by_name = dict(zip(names, counts))
    weights = np.array([counts_by_name[name] ** -exponent for name in sources], dtype=float)
    return weights / weights.mean()


def fit_model(model, features, labels, weights):
    if weights is None:
        model.fit(features, labels)
    elif isinstance(model, Pipeline):
        final_step_name = model.steps[-1][0]
        model.fit(features, labels, **{f"{final_step_name}__sample_weight": weights})
    else:
        model.fit(features, labels, sample_weight=weights)


def main():
    args = read_arguments()
    if args.min_detected_frames is not None and not 0 <= args.min_detected_frames <= args.frames_per_video:
        raise ValueError("min-detected-frames must fit within frames-per-video")
    datasets = [parse_dataset(value) for value in args.dataset]
    data = merge_datasets(datasets)
    eligible_mask = None
    if args.min_detected_frames is not None:
        frame_features = data["features"].reshape(len(data["features"]), args.frames_per_video, -1)
        detected_frames = (frame_features[:, :, -1] > 0).sum(axis=1)
        eligible_mask = detected_frames >= args.min_detected_frames
    training_selection = data["splits"] == "train"
    if args.exclude_ineligible_from_train:
        if eligible_mask is None:
            raise ValueError("exclude-ineligible-from-train requires min-detected-frames")
        training_selection &= eligible_mask
    training_weights = source_weights(
        data["sources"][training_selection], args.source_weight_exponent,
    )
    variants = feature_variants(data["features"], args.frames_per_video)
    baseline = joblib.load(args.baseline_model)
    baseline_features = variants[baseline["feature_variant"]]
    baseline_test = metrics_by_source(
        baseline["model"], baseline_features, data, "test", float(baseline["threshold"]),
        eligible_mask,
    )
    validation_results = {}
    trained = {}
    compatible_variants = ("invariant", "invariant_temporal")
    for variant_name in compatible_variants:
        variant_features = variants[variant_name]
        train_features = variant_features[training_selection]
        train_labels = data["labels"][training_selection]
        validation_features, validation_labels = split_arrays(
            variant_features, data["labels"], data["splits"], "validation",
        )
        validation_eligibility = eligible_mask[data["splits"] == "validation"] \
            if eligible_mask is not None else None
        available_models = candidates(args.seed)
        if not args.include_svc:
            available_models = {
                name: model for name, model in available_models.items() if not name.startswith("svc_")
            }
        if args.model:
            unknown_models = set(args.model) - set(available_models)
            if unknown_models:
                raise ValueError(f"Unknown model candidates: {sorted(unknown_models)}")
            available_models = {name: available_models[name] for name in args.model}
        for model_name, model in available_models.items():
            name = f"{variant_name}:{model_name}"
            fit_model(model, train_features, train_labels, training_weights)
            threshold = select_threshold(
                model, validation_features, validation_labels, validation_eligibility,
            )
            source_metrics = metrics_by_source(
                model, variant_features, data, "validation", threshold, eligible_mask,
            )
            validation_results[name] = {"threshold": threshold, "sources": source_metrics}
            trained[name] = model
            print(json.dumps({"trained": name, "rank": rank(source_metrics)}), flush=True)
    selected_name = max(validation_results, key=lambda name: rank(validation_results[name]["sources"]))
    selected_variant = selected_name.split(":", 1)[0]
    selected_model = trained[selected_name]
    selected_threshold = validation_results[selected_name]["threshold"]
    report = {
        "selection_rule": "maximize worst per-dataset validation balance, then worst F1",
        "datasets": [dataset["name"] for dataset in datasets],
        "selected_model": selected_name,
        "selected_feature_variant": selected_variant,
        "selected_threshold": selected_threshold,
        "source_weight_exponent": args.source_weight_exponent,
        "min_detected_frames": args.min_detected_frames,
        "exclude_ineligible_from_train": args.exclude_ineligible_from_train,
        "baseline_test": baseline_test,
        "improved_validation": validation_results[selected_name]["sources"],
        "improved_test": metrics_by_source(
            selected_model, variants[selected_variant], data, "test", selected_threshold,
            eligible_mask,
        ),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": selected_model,
        "feature_variant": selected_variant,
        "frames_per_video": args.frames_per_video,
        "threshold": selected_threshold,
    }, args.output_root / "selected-pose-fall-classifier.joblib")
    (args.output_root / "many-dataset-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
