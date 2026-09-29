import argparse
from pathlib import Path

import numpy as np

from train_pose_classifier import extract_dataset, load_manifest


def read_arguments():
    parser = argparse.ArgumentParser(description="Extract MediaPipe pose features from a video manifest")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_cache", type=Path)
    parser.add_argument("--frames-per-video", type=int, default=4)
    parser.add_argument("--workers", type=int, default=1)
    return parser.parse_args()


def main():
    args = read_arguments()
    if args.frames_per_video <= 1 or args.workers <= 0:
        raise ValueError("frames-per-video must exceed one and workers must be positive")
    rows = load_manifest(args.manifest, None)
    features, labels, splits, _ = extract_dataset(
        rows, args.frames_per_video, args.workers,
    )
    args.output_cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output_cache, features=features, labels=labels, splits=splits,
    )


if __name__ == "__main__":
    main()
