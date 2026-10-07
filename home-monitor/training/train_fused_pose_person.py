"""Train an offline fall classifier from pose and person-box motion together."""

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants as pose_feature_variants
from person_box_schema import BOX_FEATURES
from train_person_motion_fallback import candidates, fit_model, source_metrics, source_weights
from train_person_motion_fallback import feature_variants as person_feature_variants
from train_person_motion_fallback import validation_rank


def read_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person-cache", type=Path, required=True)
    parser.add_argument("--pose-dataset", action="append", required=True, help="Name=pose cache path")
    parser.add_argument("--frames-per-video", type=int, required=True)
    parser.add_argument("--min-pose-frames", type=int, required=True)
    parser.add_argument("--min-person-frames", type=int, required=True)
    parser.add_argument("--min-observed-people", type=int, default=0)
    parser.add_argument("--seed", type=int, default=20261005)
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


def aligned_pose_features(person_cache, paths):
    output = None
    for name, path in paths.items():
        pose = np.load(path)
        indices = np.flatnonzero(person_cache["sources"] == name)
        if len(indices) != len(pose["features"]):
            raise ValueError(f"{name}: pose and person video counts differ")
        for key in ("labels", "splits"):
            if not np.array_equal(person_cache[key][indices], pose[key]):
                raise ValueError(f"{name}: pose and person {key} differ")
        if output is None:
            output = np.empty(
                (len(person_cache["labels"]), pose["features"].shape[1]), dtype=np.float32,
            )
        if pose["features"].shape[1] != output.shape[1]:
            raise ValueError("Pose caches have incompatible feature schemas")
        output[indices] = pose["features"]
    if output is None or sum(np.count_nonzero(person_cache["sources"] == name) for name in paths) != len(output):
        raise ValueError("Pose datasets must cover every person-cache source")
    return output


def eligibility(pose_raw, person_raw, frames_per_video, min_pose_frames, min_person_frames):
    pose_frames = pose_raw.reshape(len(pose_raw), frames_per_video, -1)
    person_frames = person_raw.reshape(len(person_raw), frames_per_video, -1)
    pose_visible = (pose_frames[:, :, -1] > 0).sum(axis=1) >= min_pose_frames
    person_visible = (person_frames[:, :, -1] > 0).sum(axis=1) >= min_person_frames
    return pose_visible | person_visible


def fused_feature_variants(pose_raw, person_raw, frames_per_video):
    pose = pose_feature_variants(pose_raw, frames_per_video)
    person = person_feature_variants(person_raw, frames_per_video)
    return {
        pose_name: np.concatenate([pose[pose_name], person["boxes_temporal"]], axis=1)
        for pose_name in ("invariant", "invariant_temporal")
    }


def candidate_thresholds(probabilities):
    boundaries = np.unique(np.concatenate(([0.0], probabilities, [1.0])))
    return (boundaries[:-1] + boundaries[1:]) / 2


def main():
    args = read_arguments()
    if args.frames_per_video < 2:
        raise ValueError("frames-per-video must be at least two")
    if not 0 <= args.min_pose_frames <= args.frames_per_video:
        raise ValueError("min-pose-frames is outside the sequence")
    if not 0 <= args.min_person_frames <= args.frames_per_video:
        raise ValueError("min-person-frames is outside the sequence")
    if args.min_observed_people < 0:
        raise ValueError("min-observed-people must be non-negative")
    person = np.load(args.person_cache)
    pose_raw = aligned_pose_features(person, named_paths(args.pose_dataset))
    variants = fused_feature_variants(pose_raw, person["features"], args.frames_per_video)
    eligible = eligibility(
        pose_raw, person["features"], args.frames_per_video,
        args.min_pose_frames, args.min_person_frames,
    )
    splits = person["splits"]
    labels = person["labels"]
    sources = person["sources"]
    person_frames = person["features"].reshape(len(labels), args.frames_per_video, -1)
    observed_people = person_frames[:, :, BOX_FEATURES.index("people_count")].max(axis=1)
    selected_people = observed_people >= args.min_observed_people
    train, validation, test = (
        (splits == name) & selected_people for name in ("train", "validation", "test")
    )
    if not all(selection.any() for selection in (train, validation, test)):
        raise ValueError("All train, validation, and test splits are required")
    selected = None
    examined = []
    for variant_name, features in variants.items():
        for weight_exponent in (0.0, 0.5, 1.0):
            weights = source_weights(sources[train], weight_exponent)
            for model_name, model in candidates(args.seed).items():
                fit_model(model, features[train], labels[train], weights)
                probabilities = model.predict_proba(features[validation])[:, 1]
                for threshold in candidate_thresholds(probabilities):
                    flags = (probabilities >= threshold) & eligible[validation]
                    metrics = source_metrics(labels[validation], sources[validation], flags.astype(int))
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
    test_probabilities = selected["model"].predict_proba(variants[selected["variant"]][test])[:, 1]
    test_flags = (test_probabilities >= selected["threshold"]) & eligible[test]
    report = {
        "purpose": "offline fused pose and person-box experiment; not deployed",
        "min_observed_people": args.min_observed_people,
        "split_counts": {
            name: int(selection.sum())
            for name, selection in (("train", train), ("validation", validation), ("test", test))
        },
        "selection_rule": "worst validation source recall/specificity, then specificity and combined balance",
        "selected_model": selected["model_name"],
        "selected_feature_variant": selected["variant"],
        "selected_source_weight_exponent": selected["weight_exponent"],
        "selected_threshold": selected["threshold"],
        "examined": examined,
        "validation": selected["validation"],
        "test": source_metrics(labels[test], sources[test], test_flags.astype(int)),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": selected["model"], "feature_variant": selected["variant"],
        "threshold": selected["threshold"], "frames_per_video": args.frames_per_video,
        "min_pose_frames": args.min_pose_frames,
        "min_person_frames": args.min_person_frames,
        "min_observed_people": args.min_observed_people,
    }, args.output_root / "fused-pose-person-experiment.joblib")
    (args.output_root / "fused-pose-person-results.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps({"selected": selected["model_name"], "test": report["test"]}))


if __name__ == "__main__":
    main()
