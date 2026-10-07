"""Calibrate the experimental person-box fallback on validation videos only."""

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants as pose_feature_variants
from train_person_motion_fallback import confusion, feature_variants as person_feature_variants


def read_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person-cache", type=Path, required=True)
    parser.add_argument("--person-model", type=Path, required=True)
    parser.add_argument("--pose-dataset", action="append", required=True, help="Name=pose cache path")
    parser.add_argument("--pose-model", type=Path, required=True)
    parser.add_argument("--min-pose-frames", type=int, required=True)
    parser.add_argument("--min-person-frames", type=int, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def named_paths(values):
    result = {}
    for value in values:
        name, separator, raw_path = value.partition("=")
        if not separator or not name or not raw_path or name in result:
            raise ValueError("Each pose dataset must use a unique name=path")
        result[name] = Path(raw_path)
    return result


def prepare_source(name, pose_cache, person_cache, pose_artifact, person_artifact,
                   min_pose_frames, min_person_frames):
    person_indices = np.flatnonzero(person_cache["sources"] == name)
    if len(person_indices) != len(pose_cache["labels"]):
        raise ValueError(f"{name}: pose and person cache lengths differ")
    for key in ("labels", "splits"):
        if not np.array_equal(person_cache[key][person_indices], pose_cache[key]):
            raise ValueError(f"{name}: pose and person {key} differ")
    selected = pose_cache["splits"] == "validation"
    pose_raw = pose_cache["features"][selected]
    person_raw = person_cache["features"][person_indices][selected]
    labels = pose_cache["labels"][selected]
    pose_frames = pose_raw.reshape(len(pose_raw), pose_artifact["frames_per_video"], -1)
    person_frames = person_raw.reshape(len(person_raw), person_artifact["frames_per_video"], -1)
    pose_eligible = (pose_frames[:, :, -1] > 0).sum(axis=1) >= min_pose_frames
    person_eligible = (person_frames[:, :, -1] > 0).sum(axis=1) >= min_person_frames
    pose_features = pose_feature_variants(pose_raw, pose_artifact["frames_per_video"])
    pose_probabilities = pose_artifact["model"].predict_proba(
        pose_features[pose_artifact["feature_variant"]],
    )[:, 1]
    pose_flags = pose_eligible & (pose_probabilities >= pose_artifact["threshold"])
    person_features = person_feature_variants(person_raw, person_artifact["frames_per_video"])
    person_probabilities = person_artifact["model"].predict_proba(
        person_features[person_artifact["feature_variant"]],
    )[:, 1]
    return {
        "labels": labels,
        "pose_eligible": pose_eligible,
        "person_eligible": person_eligible,
        "pose_flags": pose_flags,
        "person_probabilities": person_probabilities,
    }


def evaluate_sources(prepared, threshold):
    metrics = {}
    for name, source in prepared.items():
        person_flags = source["person_eligible"] & (source["person_probabilities"] >= threshold)
        flags = np.where(source["pose_eligible"], source["pose_flags"], person_flags)
        metrics[name] = confusion(source["labels"], flags.astype(int))
    return metrics


def rank(metrics):
    recalls = [value["recall"] for value in metrics.values() if value["recall"] is not None]
    specificities = [
        value["specificity"] for value in metrics.values() if value["specificity"] is not None
    ]
    return (
        min(recalls), min(specificities),
        -sum(value["false_positive"] for value in metrics.values()),
        sum(value["true_positive"] for value in metrics.values()),
    )


def threshold_candidates(prepared):
    used_scores = np.concatenate([
        source["person_probabilities"][
            ~source["pose_eligible"] & source["person_eligible"]
        ]
        for source in prepared.values()
    ])
    if not len(used_scores):
        raise ValueError("Validation set has no cases eligible for the person fallback")
    boundaries = np.unique(np.concatenate(([0.0], used_scores, [1.0])))
    return (boundaries[:-1] + boundaries[1:]) / 2


def main():
    args = read_arguments()
    person_cache = np.load(args.person_cache)
    person_artifact = joblib.load(args.person_model)
    pose_artifact = joblib.load(args.pose_model)
    if not 0 <= args.min_pose_frames <= pose_artifact["frames_per_video"]:
        raise ValueError("min-pose-frames is outside the pose sequence")
    if not 0 <= args.min_person_frames <= person_artifact["frames_per_video"]:
        raise ValueError("min-person-frames is outside the person sequence")
    prepared = {
        name: prepare_source(
            name, np.load(path), person_cache, pose_artifact, person_artifact,
            args.min_pose_frames, args.min_person_frames,
        )
        for name, path in named_paths(args.pose_dataset).items()
    }
    original_metrics = evaluate_sources(prepared, person_artifact["threshold"])
    choices = [
        (rank(metrics), float(threshold), metrics)
        for threshold in threshold_candidates(prepared)
        for metrics in (evaluate_sources(prepared, threshold),)
    ]
    best_rank, best_threshold, best_metrics = max(choices, key=lambda item: item[0])
    output_artifact = {
        **person_artifact,
        "threshold": best_threshold,
        "calibration": {
            "pose_model": str(args.pose_model),
            "split": "validation",
            "min_pose_frames": args.min_pose_frames,
            "min_person_frames": args.min_person_frames,
        },
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump(output_artifact, args.output_root / "person-motion-fallback-calibrated.joblib")
    report = {
        "selection_rule": "maximize worst source recall, then worst specificity, then minimize false positives",
        "original_threshold": float(person_artifact["threshold"]),
        "calibrated_threshold": best_threshold,
        "original_validation": original_metrics,
        "calibrated_validation": best_metrics,
        "rank": best_rank,
        "candidate_count": len(choices),
    }
    (args.output_root / "person-fallback-calibration.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
