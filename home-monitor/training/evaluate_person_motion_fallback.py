"""Measure whether a person-box fallback helps the existing pose classifier."""

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants as pose_feature_variants
from person_box_schema import BOX_FEATURES
from train_person_motion_fallback import confusion
from train_person_motion_fallback import feature_variants as box_feature_variants
from train_person_motion_fallback import source_metrics


def read_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person-cache", type=Path, required=True)
    parser.add_argument("--person-model", type=Path, required=True)
    parser.add_argument("--pose-dataset", action="append", required=True, help="Name=pose cache path")
    parser.add_argument("--pose-model", action="append", required=True, help="Name=pose model path")
    parser.add_argument("--min-pose-frames", type=int, required=True)
    parser.add_argument("--min-person-frames", type=int, required=True)
    parser.add_argument("--split", action="append", choices=("validation", "test"))
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def named_paths(values):
    result = {}
    for value in values:
        name, separator, path = value.partition("=")
        if not separator or not name or not path or name in result:
            raise ValueError("Each named path must use a unique name=path")
        result[name] = Path(path)
    return result


def predictions(artifact, raw, variants_fn):
    variants = variants_fn(raw, artifact["frames_per_video"])
    probabilities = artifact["model"].predict_proba(variants[artifact["feature_variant"]])[:, 1]
    return probabilities >= artifact["threshold"]


def compare_source(name, person_data, pose_data, person_artifact, pose_artifact,
                   min_pose_frames, min_person_frames, split):
    source_indices = np.flatnonzero(person_data["sources"] == name)
    if len(source_indices) != len(pose_data["labels"]):
        raise ValueError(f"{name}: person and pose cache lengths differ")
    if not np.array_equal(person_data["labels"][source_indices], pose_data["labels"]):
        raise ValueError(f"{name}: person and pose labels differ")
    if not np.array_equal(person_data["splits"][source_indices], pose_data["splits"]):
        raise ValueError(f"{name}: person and pose splits differ")
    selected = pose_data["splits"] == split
    if not selected.any():
        raise ValueError(f"{name}: split {split} has no videos")
    pose_raw = pose_data["features"][selected]
    person_raw = person_data["features"][source_indices][selected]
    labels = pose_data["labels"][selected]
    pose_frames = pose_raw.reshape(len(pose_raw), pose_artifact["frames_per_video"], -1)
    person_frames = person_raw.reshape(len(person_raw), person_artifact["frames_per_video"], -1)
    pose_eligible = (pose_frames[:, :, -1] > 0).sum(axis=1) >= min_pose_frames
    person_eligible = (person_frames[:, :, -1] > 0).sum(axis=1) >= min_person_frames
    pose_flags = predictions(pose_artifact, pose_raw, pose_feature_variants) & pose_eligible
    person_flags = predictions(person_artifact, person_raw, box_feature_variants) & person_eligible
    combined_flags = np.where(pose_eligible, pose_flags, person_flags)
    many_people = person_frames[:, :, BOX_FEATURES.index("people_count")].max(axis=1) >= 2
    strata = {
        stratum: {
            "pose_only": confusion(labels[mask], pose_flags[mask].astype(int)),
            "person_only": confusion(labels[mask], person_flags[mask].astype(int)),
            "with_fallback": confusion(labels[mask], combined_flags[mask].astype(int)),
        }
        for stratum, mask in (
            ("multiple_detected_people", many_people),
            ("fewer_detected_people", ~many_people),
        )
        if mask.any()
    }
    return {
        "pose_eligible": int(pose_eligible.sum()),
        "person_eligible": int(person_eligible.sum()),
        "fallback_used": int((~pose_eligible & person_eligible).sum()),
        "pose_only": source_metrics(labels, np.full(len(labels), name), pose_flags.astype(int))[name],
        "person_only": source_metrics(labels, np.full(len(labels), name), person_flags.astype(int))[name],
        "with_fallback": source_metrics(labels, np.full(len(labels), name), combined_flags.astype(int))[name],
        "strata": strata,
    }


def main():
    args = read_arguments()
    person_data = np.load(args.person_cache)
    person_artifact = joblib.load(args.person_model)
    pose_datasets = {name: np.load(path) for name, path in named_paths(args.pose_dataset).items()}
    pose_models = {name: joblib.load(path) for name, path in named_paths(args.pose_model).items()}
    report = {
        "purpose": "offline comparison only; same known test clips as earlier experiments",
        "min_pose_frames": args.min_pose_frames,
        "min_person_frames": args.min_person_frames,
        "models": {},
    }
    for model_name, pose_artifact in pose_models.items():
        report["models"][model_name] = {
            split: {
                name: compare_source(
                    name, person_data, data, person_artifact, pose_artifact,
                    args.min_pose_frames, args.min_person_frames, split,
                )
                for name, data in pose_datasets.items()
            }
            for split in (args.split or ("validation", "test"))
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
