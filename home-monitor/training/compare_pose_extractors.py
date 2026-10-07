import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from train_pose_classifier import sample_indices


def read_arguments():
    parser = argparse.ArgumentParser(description="Measure pose coverage on fall video clips")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--task-model", type=Path, required=True)
    parser.add_argument("--samples", type=int, required=True)
    parser.add_argument("--scale", type=float, required=True)
    parser.add_argument("--min-pose-frames", type=int, required=True)
    parser.add_argument("--min-confidence", type=float, required=True)
    parser.add_argument("--max-poses", type=int, required=True)
    parser.add_argument("--legacy-complexity", type=int, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def read_sample_frames(path, samples, scale):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = sample_indices(frame_count, samples)
    targets = set(indices)
    frames = {}
    try:
        for index in range(max(indices) + 1):
            success, frame = capture.read()
            if not success:
                break
            if index in targets:
                if scale != 1:
                    frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                frames[index] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    finally:
        capture.release()
    return [frames.get(index) for index in indices]


def detector_results(frames, legacy_detectors, task_detector):
    results = {name: 0 for name in legacy_detectors}
    results["task_full"] = 0
    for rgb in frames:
        if rgb is None:
            continue
        for name, detector in legacy_detectors.items():
            if detector.process(rgb).pose_landmarks:
                results[name] += 1
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        if task_detector.detect(image).pose_landmarks:
            results["task_full"] += 1
    return results


def main():
    args = read_arguments()
    if args.samples <= 0 or not 0 <= args.min_pose_frames <= args.samples or args.scale <= 0:
        raise ValueError("Sample and pose frame counts are invalid")
    if args.max_poses <= 0 or not 0 <= args.min_confidence <= 1:
        raise ValueError("Pose detector settings are invalid")
    with args.manifest.open("r", newline="", encoding="utf-8-sig") as source:
        records = list(csv.DictReader(source))
    legacy_detectors = {
        f"legacy_{complexity}": mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=complexity,
            min_detection_confidence=args.min_confidence,
        )
        for complexity in args.legacy_complexity
    }
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=args.task_model.read_bytes()),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=args.max_poses,
        min_pose_detection_confidence=args.min_confidence,
        min_pose_presence_confidence=args.min_confidence,
        min_tracking_confidence=args.min_confidence,
    )
    task_detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
    results = []
    try:
        for index, record in enumerate(records, start=1):
            frames = read_sample_frames(Path(record["video_path"]), args.samples, args.scale)
            counts = detector_results(frames, legacy_detectors, task_detector)
            results.append({
                "video": Path(record["video_path"]).name,
                "split": record["split"],
                "pose_frames": counts,
            })
            if index % 5 == 0 or index == len(records):
                print(json.dumps({"processed": index, "total": len(records)}), flush=True)
    finally:
        task_detector.close()
        for detector in legacy_detectors.values():
            detector.close()
    names = list(results[0]["pose_frames"])
    summary = {
        name: {
            split: {
                "eligible": sum(
                    item["pose_frames"][name] >= args.min_pose_frames
                    for item in results if item["split"] == split
                ),
                "total": sum(item["split"] == split for item in results),
            }
            for split in sorted({item["split"] for item in results})
        }
        for name in names
    }
    report = {"samples": args.samples, "scale": args.scale, "min_pose_frames": args.min_pose_frames,
              "summary": summary, "videos": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
