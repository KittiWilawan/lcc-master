import argparse
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from train_pose_classifier import evaluate, select_threshold, split_arrays


def read_arguments():
    parser = argparse.ArgumentParser(description="Select a pose classifier using validation subjects")
    parser.add_argument("feature_cache", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--seed", type=int, default=20260926)
    parser.add_argument("--frames-per-video", type=int, default=4)
    return parser.parse_args()


def candidates(seed):
    return {
        "extra_trees_leaf_1": ExtraTreesClassifier(
            n_estimators=800, class_weight="balanced", min_samples_leaf=1,
            max_features="sqrt", n_jobs=-1, random_state=seed,
        ),
        "extra_trees_leaf_2": ExtraTreesClassifier(
            n_estimators=800, class_weight="balanced", min_samples_leaf=2,
            max_features="sqrt", n_jobs=-1, random_state=seed,
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=800, class_weight="balanced_subsample", min_samples_leaf=2,
            max_features="sqrt", n_jobs=-1, random_state=seed,
        ),
        "hist_gradient": HistGradientBoostingClassifier(
            max_iter=350, learning_rate=0.05, max_leaf_nodes=31,
            l2_regularization=1.0, random_state=seed,
        ),
        "svc_c1": make_pipeline(
            StandardScaler(), SVC(C=1.0, class_weight="balanced", probability=True, random_state=seed),
        ),
        "svc_c3": make_pipeline(
            StandardScaler(), SVC(C=3.0, class_weight="balanced", probability=True, random_state=seed),
        ),
        "svc_c10": make_pipeline(
            StandardScaler(), SVC(C=10.0, class_weight="balanced", probability=True, random_state=seed),
        ),
    }


def feature_variants(features, frames_per_video):
    if features.shape[1] % frames_per_video != 0:
        raise ValueError("Feature count is incompatible with frames-per-video")
    per_frame = features.shape[1] // frames_per_video
    sequence = features.reshape(features.shape[0], frames_per_video, per_frame)
    deltas = np.diff(sequence, axis=1).reshape(features.shape[0], -1)
    summaries = np.concatenate((
        sequence.mean(axis=1),
        sequence.std(axis=1),
        sequence.min(axis=1),
        sequence.max(axis=1),
    ), axis=1)

    landmark_feature_count = 33 * 3 + 33
    if per_frame < landmark_feature_count:
        raise ValueError("Each frame must contain pose coordinates and visibility scores")
    invariant_sequence = sequence[:, :, :landmark_feature_count]
    invariant_features = invariant_sequence.reshape(features.shape[0], -1)
    invariant_deltas = np.diff(invariant_sequence, axis=1).reshape(features.shape[0], -1)
    invariant_summaries = np.concatenate((
        invariant_sequence.mean(axis=1),
        invariant_sequence.std(axis=1),
        invariant_sequence.min(axis=1),
        invariant_sequence.max(axis=1),
    ), axis=1)
    return {
        "base": features,
        "temporal": np.concatenate((features, deltas, summaries), axis=1),
        "invariant": invariant_features,
        "invariant_temporal": np.concatenate((
            invariant_features,
            invariant_deltas,
            invariant_summaries,
        ), axis=1),
    }


def main():
    args = read_arguments()
    cache = np.load(args.feature_cache)
    features, labels, splits = cache["features"], cache["labels"], cache["splits"]
    validation_results = {}
    trained = {}
    test_sets = {}
    for variant_name, variant_features in feature_variants(features, args.frames_per_video).items():
        train_features, train_labels = split_arrays(variant_features, labels, splits, "train")
        validation_features, validation_labels = split_arrays(variant_features, labels, splits, "validation")
        test_features, test_labels = split_arrays(variant_features, labels, splits, "test")
        test_sets[variant_name] = (test_features, test_labels)
        for model_name, model in candidates(args.seed).items():
            name = f"{variant_name}:{model_name}"
            model.fit(train_features, train_labels)
            threshold = select_threshold(model, validation_features, validation_labels)
            metrics = evaluate(model, validation_features, validation_labels, threshold)
            validation_results[name] = {"threshold": threshold, **metrics}
            trained[name] = model
            print(json.dumps({"model": name, "validation": validation_results[name]}), flush=True)

    def rank(name):
        metrics = validation_results[name]
        return min(metrics["recall"], metrics["specificity"]), metrics["f1"], metrics["accuracy"]

    selected_name = max(validation_results, key=rank)
    selected_model = trained[selected_name]
    selected_variant = selected_name.split(":", 1)[0]
    selected_threshold = validation_results[selected_name]["threshold"]
    test_features, test_labels = test_sets[selected_variant]
    result = {
        "selection_rule": "maximize the lower of validation recall and specificity, then F1 and accuracy",
        "selected_model": selected_name,
        "selected_feature_variant": selected_variant,
        "selected_threshold": selected_threshold,
        "validation_candidates": validation_results,
        "test": evaluate(selected_model, test_features, test_labels, selected_threshold),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": selected_model,
        "feature_variant": selected_variant,
        "frames_per_video": args.frames_per_video,
        "threshold": selected_threshold,
    }, args.output_root / "selected-pose-fall-classifier.joblib")
    (args.output_root / "benchmark-results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
