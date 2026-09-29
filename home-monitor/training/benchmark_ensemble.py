import argparse
import csv
import itertools
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from benchmark_classifiers import feature_variants
from train_pose_classifier import split_arrays


def read_arguments():
    parser = argparse.ArgumentParser(description="Select a validation-tuned pose ensemble")
    parser.add_argument("feature_cache", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--frames-per-video", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260926)
    return parser.parse_args()


def metrics(labels, probabilities, threshold):
    predictions = probabilities >= threshold
    positive = labels == 1
    negative = labels == 0
    tp = int(np.sum(predictions & positive))
    tn = int(np.sum(~predictions & negative))
    fp = int(np.sum(predictions & negative))
    fn = int(np.sum(~predictions & positive))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {
        "videos": int(len(labels)),
        "true_positive": tp,
        "true_negative": tn,
        "false_positive": fp,
        "false_negative": fn,
        "accuracy": (tp + tn) / len(labels),
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
    }


def rank(result):
    return min(result["recall"], result["specificity"]), result["f1"], result["accuracy"]


def select_threshold(labels, probabilities):
    best = None
    for threshold in np.linspace(0.1, 0.9, 321):
        result = metrics(labels, probabilities, float(threshold))
        candidate = rank(result), float(threshold), result
        if best is None or candidate[0] > best[0]:
            best = candidate
    return best[1], best[2]


def build_models(seed):
    return {
        "base_extra_trees": {
            "variant": "base",
            "model": ExtraTreesClassifier(
                n_estimators=1000, class_weight="balanced", min_samples_leaf=1,
                max_features="sqrt", n_jobs=-1, random_state=seed,
            ),
        },
        "base_hist_gradient": {
            "variant": "base",
            "model": HistGradientBoostingClassifier(
                max_iter=450, learning_rate=0.04, max_leaf_nodes=31,
                l2_regularization=1.0, random_state=seed,
            ),
        },
        "temporal_hist_gradient": {
            "variant": "temporal",
            "model": HistGradientBoostingClassifier(
                max_iter=450, learning_rate=0.04, max_leaf_nodes=31,
                l2_regularization=1.0, random_state=seed,
            ),
        },
        "temporal_svc": {
            "variant": "temporal",
            "model": make_pipeline(
                StandardScaler(),
                SVC(C=10.0, class_weight="balanced", probability=True, random_state=seed),
            ),
        },
    }


def weight_options(model_count, units=10):
    for values in itertools.product(range(units + 1), repeat=model_count):
        if sum(values) == units and sum(value > 0 for value in values) >= 2:
            yield np.array(values, dtype=np.float64) / units


def load_rows(path):
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def main():
    args = read_arguments()
    cache = np.load(args.feature_cache)
    features, labels, splits = cache["features"], cache["labels"], cache["splits"]
    variants = feature_variants(features, args.frames_per_video)
    definitions = build_models(args.seed)
    validation_probabilities = []
    test_probabilities = []
    validation_labels = None
    test_labels = None
    for name, definition in definitions.items():
        selected_features = variants[definition["variant"]]
        train_features, train_labels = split_arrays(selected_features, labels, splits, "train")
        validation_features, validation_labels = split_arrays(selected_features, labels, splits, "validation")
        test_features, test_labels = split_arrays(selected_features, labels, splits, "test")
        definition["model"].fit(train_features, train_labels)
        validation_probabilities.append(definition["model"].predict_proba(validation_features)[:, 1])
        test_probabilities.append(definition["model"].predict_proba(test_features)[:, 1])
        print(json.dumps({"trained": name}), flush=True)

    validation_matrix = np.stack(validation_probabilities, axis=1)
    test_matrix = np.stack(test_probabilities, axis=1)
    best = None
    for weights in weight_options(len(definitions)):
        ensemble_probabilities = validation_matrix @ weights
        threshold, result = select_threshold(validation_labels, ensemble_probabilities)
        candidate = rank(result), weights, threshold, result
        if best is None or candidate[0] > best[0]:
            best = candidate

    _, selected_weights, selected_threshold, validation_result = best
    test_ensemble_probabilities = test_matrix @ selected_weights
    test_result = metrics(test_labels, test_ensemble_probabilities, selected_threshold)
    names = list(definitions)
    members = [
        {
            "name": name,
            "variant": definitions[name]["variant"],
            "weight": float(selected_weights[index]),
            "model": definitions[name]["model"],
        }
        for index, name in enumerate(names)
        if selected_weights[index] > 0
    ]
    result = {
        "selection_rule": "weights and threshold selected using validation subjects only",
        "members": [{key: value for key, value in item.items() if key != "model"} for item in members],
        "threshold": selected_threshold,
        "validation": validation_result,
        "test": test_result,
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "members": members,
        "frames_per_video": args.frames_per_video,
        "threshold": selected_threshold,
    }, args.output_root / "pose-fall-ensemble.joblib")
    rows = load_rows(args.manifest)
    test_rows = [row for row in rows if row["split"] == "test"]
    predictions = test_ensemble_probabilities >= selected_threshold
    case_results = [
        {
            **row,
            "probability": float(test_ensemble_probabilities[index]),
            "prediction": "fall" if predictions[index] else "normal",
            "correct": bool(predictions[index] == (row["label"] == "fall")),
        }
        for index, row in enumerate(test_rows)
    ]
    (args.output_root / "ensemble-results.json").write_text(
        json.dumps({**result, "test_cases": case_results}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
