import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import numpy as np

from train_pose_classifier import empty_frame_features, sample_indices


MEDIAPIPE_LANDMARK_COUNT = 33
MIN_VISIBLE_CONFIDENCE = 0.2
SOURCE_NAME = "FallVision"
SOURCE_DOI = "10.7910/DVN/75QPKK"
GROUP_SPLITS = {"N": "train", "M": "validation", "D": "test"}
COCO_TO_MEDIAPIPE = {
    "Nose": (0, 9, 10),
    "Left Eye": (1, 2, 3),
    "Right Eye": (4, 5, 6),
    "Left Ear": (7,),
    "Right Ear": (8,),
    "Left Shoulder": (11,),
    "Right Shoulder": (12,),
    "Left Elbow": (13,),
    "Right Elbow": (14,),
    "Left Wrist": (15, 17, 19, 21),
    "Right Wrist": (16, 18, 20, 22),
    "Left Hip": (23,),
    "Right Hip": (24,),
    "Left Knee": (25,),
    "Right Knee": (26,),
    "Left Ankle": (27, 29, 31),
    "Right Ankle": (28, 30, 32),
}


def read_arguments():
    parser = argparse.ArgumentParser(description="Build a MediaPipe-compatible FallVision feature cache")
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--frames-per-video", type=int, default=4)
    return parser.parse_args()


def describe_case(path):
    folder = path.parent.name
    label = "normal" if folder.startswith("nf_") else "fall"
    parts = path.stem.split("_")
    if len(parts) < 3 or parts[1] not in GROUP_SPLITS:
        raise ValueError(f"Cannot determine FallVision group for {path}")
    group = parts[1]
    return label, group, GROUP_SPLITS[group]


def read_frames(path):
    frames = {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            frame = int(row["Frame"])
            frames.setdefault(frame, {})[row["Keypoint"]] = (
                float(row["X"]), float(row["Y"]), float(row["Confidence"]),
            )
    return frames


def normalize_frame(points):
    coordinates = np.zeros((MEDIAPIPE_LANDMARK_COUNT, 3), dtype=np.float32)
    visibility = np.zeros(MEDIAPIPE_LANDMARK_COUNT, dtype=np.float32)
    for name, indices in COCO_TO_MEDIAPIPE.items():
        if name not in points:
            continue
        x, y, confidence = points[name]
        for index in indices:
            coordinates[index] = (x, y, 0.0)
            visibility[index] = confidence
    visible = visibility >= MIN_VISIBLE_CONFIDENCE
    if not visible.any():
        return empty_frame_features()
    selected = coordinates[visible]
    center = selected.mean(axis=0)
    ranges = selected.max(axis=0) - selected.min(axis=0)
    scale = max(float(ranges[0]), float(ranges[1]), 0.05)
    normalized = (coordinates - center) / scale
    bounds = np.array((0.0, 0.0, ranges[0] / scale, ranges[1] / scale, visible.mean(), 1.0), dtype=np.float32)
    return np.concatenate((normalized.reshape(-1), visibility, bounds))


def extract_case(path, frames_per_video):
    frames = read_frames(path)
    frame_numbers = sorted(frames)
    if not frame_numbers:
        return np.concatenate([empty_frame_features() for _ in range(frames_per_video)])
    selected_indices = sample_indices(len(frame_numbers), frames_per_video)
    selected_frames = [frame_numbers[min(index, len(frame_numbers) - 1)] for index in selected_indices]
    return np.concatenate([normalize_frame(frames[number]) for number in selected_frames])


def build_cache(dataset_root, frames_per_video):
    paths = sorted(dataset_root.rglob("*.csv"))
    if not paths:
        raise RuntimeError("No FallVision keypoint CSV files were found")
    features = []
    labels = []
    splits = []
    cases = []
    for index, path in enumerate(paths, start=1):
        label, group, split = describe_case(path)
        features.append(extract_case(path, frames_per_video))
        labels.append(1 if label == "fall" else 0)
        splits.append(split)
        cases.append({
            "path": str(path.resolve()), "label": label, "group": group,
            "split": split, "source": SOURCE_NAME, "doi": SOURCE_DOI,
        })
        if index % 500 == 0 or index == len(paths):
            print(json.dumps({"processed": index, "total": len(paths)}), flush=True)
    return np.stack(features), np.array(labels), np.array(splits), cases


def summarize(cases):
    counts = Counter((item["split"], item["label"]) for item in cases)
    return {
        split: {
            "videos": sum(counts[(split, label)] for label in ("fall", "normal")),
            "falls": counts[(split, "fall")],
            "normal": counts[(split, "normal")],
        }
        for split in ("train", "validation", "test")
    }


def main():
    args = read_arguments()
    if args.frames_per_video <= 1:
        raise ValueError("frames-per-video must exceed one")
    features, labels, splits, cases = build_cache(args.dataset_root.resolve(), args.frames_per_video)
    args.output_root.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output_root / f"pose-features-{args.frames_per_video}.npz",
        features=features, labels=labels, splits=splits,
    )
    report = {
        "source": SOURCE_NAME,
        "doi": SOURCE_DOI,
        "split_rule": "N=train, M=validation, D=test to separate source-defined groups",
        "summary": summarize(cases),
        "cases": cases,
    }
    (args.output_root / "manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
