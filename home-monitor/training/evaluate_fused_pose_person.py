"""Evaluate a saved pose/person fusion model on aligned video caches."""

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from person_box_schema import BOX_FEATURES
from train_fused_pose_person import aligned_pose_features, eligibility, fused_feature_variants
from train_fused_pose_person import named_paths
from train_person_motion_fallback import confusion, source_metrics


def read_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--person-cache", type=Path, required=True)
    parser.add_argument("--pose-dataset", action="append", required=True, help="Name=pose cache path")
    parser.add_argument("--split", choices=("train", "validation", "test"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main():
    args = read_arguments()
    artifact = joblib.load(args.model)
    person = np.load(args.person_cache)
    pose_raw = aligned_pose_features(person, named_paths(args.pose_dataset))
    variants = fused_feature_variants(pose_raw, person["features"], artifact["frames_per_video"])
    eligible = eligibility(
        pose_raw, person["features"], artifact["frames_per_video"],
        artifact["min_pose_frames"], artifact["min_person_frames"],
    )
    all_person_frames = person["features"].reshape(
        len(person["labels"]), artifact["frames_per_video"], -1,
    )
    observed_people = all_person_frames[:, :, BOX_FEATURES.index("people_count")].max(axis=1)
    selected = (person["splits"] == args.split) & (
        observed_people >= artifact.get("min_observed_people", 0)
    )
    if not selected.any():
        raise ValueError("No videos match the requested split and person-count condition")
    probabilities = artifact["model"].predict_proba(
        variants[artifact["feature_variant"]][selected],
    )[:, 1]
    flags = (probabilities >= artifact["threshold"]) & eligible[selected]
    person_frames = person["features"][selected].reshape(
        int(selected.sum()), artifact["frames_per_video"], -1,
    )
    many_people = person_frames[:, :, BOX_FEATURES.index("people_count")].max(axis=1) >= 2
    labels = person["labels"][selected]
    report = {
        "split": args.split,
        "eligible_videos": int(eligible[selected].sum()),
        "source_metrics": source_metrics(
            labels, person["sources"][selected], flags.astype(int),
        ),
        "strata": {
            name: confusion(labels[mask], flags[mask].astype(int))
            for name, mask in (
                ("multiple_detected_people", many_people),
                ("fewer_detected_people", ~many_people),
            )
            if mask.any()
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
