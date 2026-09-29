import argparse
import json
import time
from pathlib import Path

import joblib
import numpy as np

import train_pose_classifier as training
from benchmark_classifiers import feature_variants


def read_arguments():
    parser = argparse.ArgumentParser(description="Run the trained pose fall classifier on videos")
    parser.add_argument("model", type=Path)
    parser.add_argument("videos", nargs="+", type=Path)
    return parser.parse_args()


def main():
    args = read_arguments()
    artifact = joblib.load(args.model)
    training.initialize_worker()
    results = []
    for video in args.videos:
        started_at = time.perf_counter()
        base = training.extract_video_features(
            video,
            training.worker_pose,
            artifact["frames_per_video"],
        ).reshape(1, -1)
        selected = feature_variants(base, artifact["frames_per_video"])[artifact["feature_variant"]]
        probability = float(artifact["model"].predict_proba(selected)[0, 1])
        results.append({
            "video": str(video.resolve()),
            "fall_probability": probability,
            "threshold": artifact["threshold"],
            "prediction": "fall" if probability >= artifact["threshold"] else "normal",
            "elapsed_ms": round((time.perf_counter() - started_at) * 1000),
        })
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
