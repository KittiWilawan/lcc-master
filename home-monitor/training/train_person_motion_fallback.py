"""Train an experimental person-box classifier for clips without reliable poses.

This is an offline benchmark. The model is not loaded by the live camera service.
"""

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from person_box_schema import BOX_FEATURES


def read_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--frames-per-video", type=int, required=True)
    parser.add_argument("--seed", type=int, default=20261005)
    return parser.parse_args()


def feature_variants(raw, frames_per_video):
    frame_width = len(BOX_FEATURES)
    if raw.ndim != 2 or raw.shape[1] != frames_per_video * frame_width:
        raise ValueError("Cache shape does not match the person-box feature schema")
    frames = raw.reshape(len(raw), frames_per_video, frame_width)
    positions = frames[:, :, :7]
    detected = frames[:, :, -1] > 0
    adjacent = detected[:, 1:] & detected[:, :-1]
    changes = (positions[:, 1:] - positions[:, :-1]) * adjacent[:, :, None]
    valid_count = detected.sum(axis=1, keepdims=True)
    summary = np.stack([
        (positions * detected[:, :, None]).sum(axis=1)
        / np.maximum(valid_count, 1),
        np.max(np.where(detected[:, :, None], positions, -np.inf), axis=1),
        np.min(np.where(detected[:, :, None], positions, np.inf), axis=1),
    ], axis=1)
    summary = np.where(np.isfinite(summary), summary, 0).reshape(len(raw), -1)
    temporal = np.concatenate([
        raw, changes.reshape(len(raw), -1), adjacent.astype(float),
        summary, valid_count,
    ], axis=1)
    return {"boxes": raw, "boxes_temporal": temporal}


def source_weights(sources, exponent):
    if exponent == 0:
        return None
    names, counts = np.unique(sources, return_counts=True)
    counts_by_name = dict(zip(names, counts))
    weights = np.array([counts_by_name[name] ** -exponent for name in sources], dtype=float)
    return weights / weights.mean()


def candidates(seed):
    return {
        "hist_gradient": HistGradientBoostingClassifier(random_state=seed),
        "extra_trees": ExtraTreesClassifier(
            n_estimators=240, min_samples_leaf=2, class_weight="balanced",
            n_jobs=-1, random_state=seed,
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=240, min_samples_leaf=2, class_weight="balanced_subsample",
            n_jobs=-1, random_state=seed,
        ),
        "logistic": make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=2500, random_state=seed),
        ),
    }


def fit_model(model, features, labels, weights):
    if weights is None:
        model.fit(features, labels)
    elif hasattr(model, "steps"):
        final_step = model.steps[-1][0]
        model.fit(features, labels, **{f"{final_step}__sample_weight": weights})
    else:
        model.fit(features, labels, sample_weight=weights)


def confusion(labels, predictions):
    positive = labels == 1
    flagged = predictions == 1
    tp = int(np.count_nonzero(positive & flagged))
    tn = int(np.count_nonzero(~positive & ~flagged))
    fp = int(np.count_nonzero(~positive & flagged))
    fn = int(np.count_nonzero(positive & ~flagged))
    def ratio(numerator, denominator):
        return numerator / denominator if denominator else None
    return {
        "videos": int(len(labels)), "true_positive": tp, "true_negative": tn,
        "false_positive": fp, "false_negative": fn,
        "accuracy": ratio(tp + tn, len(labels)),
        "recall": ratio(tp, tp + fn),
        "specificity": ratio(tn, tn + fp),
        "precision": ratio(tp, tp + fp),
    }


def source_metrics(labels, sources, predictions):
    metrics = {
        source: confusion(labels[sources == source], predictions[sources == source])
        for source in sorted(np.unique(sources))
    }
    metrics["combined"] = confusion(labels, predictions)
    return metrics


def validation_rank(metrics):
    source_balances = []
    source_specificities = []
    for source, values in metrics.items():
        if source == "combined":
            continue
        available = [value for value in (values["recall"], values["specificity"]) if value is not None]
        source_balances.append(min(available))
        if values["specificity"] is not None:
            source_specificities.append(values["specificity"])
    combined = metrics["combined"]
    return (
        min(source_balances),
        min(source_specificities),
        min(value for value in (combined["recall"], combined["specificity"]) if value is not None),
        combined["accuracy"],
    )


def main():
    args = read_arguments()
    cache = np.load(args.cache)
    data = {key: cache[key] for key in ("features", "labels", "splits", "sources")}
    if args.frames_per_video < 2:
        raise ValueError("frames-per-video must be at least two")
    variants = feature_variants(data["features"], args.frames_per_video)
    train = data["splits"] == "train"
    validation = data["splits"] == "validation"
    test = data["splits"] == "test"
    if not all(selection.any() for selection in (train, validation, test)):
        raise ValueError("All three participant-separated splits are required")
    examined = []
    selected = None
    for variant_name, features in variants.items():
        for weight_exponent in (0.0, 0.5, 1.0):
            weights = source_weights(data["sources"][train], weight_exponent)
            for model_name, model in candidates(args.seed).items():
                fit_model(model, features[train], data["labels"][train], weights)
                probabilities = model.predict_proba(features[validation])[:, 1]
                for threshold in np.linspace(0.05, 0.95, 37):
                    metrics = source_metrics(
                        data["labels"][validation], data["sources"][validation],
                        (probabilities >= threshold).astype(int),
                    )
                    rank = validation_rank(metrics)
                    if selected is None or rank > selected["rank"]:
                        selected = {
                            "rank": rank, "model": model, "model_name": model_name,
                            "variant": variant_name, "weight_exponent": weight_exponent,
                            "threshold": float(threshold), "validation": metrics,
                        }
                examined.append({
                    "variant": variant_name, "model": model_name,
                    "source_weight_exponent": weight_exponent,
                })
                print(json.dumps({"trained": examined[-1]}), flush=True)
    features = variants[selected["variant"]]
    probabilities = selected["model"].predict_proba(features[test])[:, 1]
    predictions = (probabilities >= selected["threshold"]).astype(int)
    report = {
        "purpose": "offline person-box fallback experiment; not deployed",
        "feature_cache": str(args.cache),
        "frames_per_video": args.frames_per_video,
        "seed": args.seed,
        "split_counts": {
            split: {
                source: {
                    "videos": int(np.count_nonzero((data["splits"] == split) & (data["sources"] == source))),
                    "falls": int(np.count_nonzero(
                        (data["splits"] == split) & (data["sources"] == source)
                        & (data["labels"] == 1)
                    )),
                }
                for source in sorted(np.unique(data["sources"]))
            }
            for split in ("train", "validation", "test")
        },
        "selection_rule": "validation worst source recall/specificity, then specificity and combined balance",
        "examined": examined,
        "selected_model": selected["model_name"],
        "selected_feature_variant": selected["variant"],
        "selected_source_weight_exponent": selected["weight_exponent"],
        "selected_threshold": selected["threshold"],
        "validation": selected["validation"],
        "test": source_metrics(data["labels"][test], data["sources"][test], predictions),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": selected["model"], "feature_variant": selected["variant"],
        "threshold": selected["threshold"], "frames_per_video": args.frames_per_video,
    }, args.output_root / "person-motion-fallback-experiment.joblib")
    (args.output_root / "person-motion-training-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps({"selected": selected["model_name"], "test": report["test"]}))


if __name__ == "__main__":
    main()
