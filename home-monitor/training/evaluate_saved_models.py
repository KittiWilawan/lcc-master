import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from benchmark_classifiers import feature_variants
from benchmark_many_datasets import parse_dataset
from train_pose_classifier import evaluate


def read_arguments():
    parser = argparse.ArgumentParser(description="Compare saved fall models with live pose eligibility")
    parser.add_argument("--model", action="append", required=True, help="Model name=artifact path")
    parser.add_argument("--dataset", action="append", required=True, help="Dataset name=cache path")
    parser.add_argument("--frames-per-video", type=int, required=True)
    parser.add_argument("--min-detected-frames", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def parse_model(value):
    name, separator, raw_path = value.partition("=")
    if not separator or not name or not raw_path:
        raise ValueError("Each model must use name=artifact-path")
    return name, joblib.load(Path(raw_path))


def evaluate_dataset(artifact, dataset, frames_per_video, min_detected_frames):
    if artifact["frames_per_video"] != frames_per_video:
        raise ValueError("Model and dataset frame counts differ")
    selected = dataset["splits"] == "test"
    raw_features = dataset["features"][selected]
    labels = dataset["labels"][selected]
    frame_features = raw_features.reshape(len(raw_features), frames_per_video, -1)
    eligible = (frame_features[:, :, -1] > 0).sum(axis=1) >= min_detected_frames
    variants = feature_variants(raw_features, frames_per_video)
    features = variants[artifact["feature_variant"]]
    metrics = evaluate(artifact["model"], features, labels, artifact["threshold"], eligible)
    return {
        "eligible_videos": int(eligible.sum()),
        "ineligible_videos": int((~eligible).sum()),
        "metrics": metrics,
    }


def main():
    args = read_arguments()
    if args.frames_per_video <= 0 or not 0 <= args.min_detected_frames <= args.frames_per_video:
        raise ValueError("Pose frame requirements are invalid")
    models = [parse_model(value) for value in args.model]
    datasets = [parse_dataset(value) for value in args.dataset]
    report = {
        "frames_per_video": args.frames_per_video,
        "min_detected_frames": args.min_detected_frames,
        "models": {
            name: {
                dataset["name"]: evaluate_dataset(
                    artifact, dataset, args.frames_per_video, args.min_detected_frames,
                )
                for dataset in datasets
            }
            for name, artifact in models
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
