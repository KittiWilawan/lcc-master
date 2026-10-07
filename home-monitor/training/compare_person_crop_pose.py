import argparse
import csv
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from ultralytics import YOLO


def read_arguments():
    parser = argparse.ArgumentParser(description="Compare full-frame pose detection with person crops")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--person-model", type=Path, required=True)
    parser.add_argument("--samples", type=int, required=True)
    parser.add_argument("--min-pose-frames", type=int, required=True)
    parser.add_argument("--person-confidence", type=float, required=True)
    parser.add_argument("--pose-confidence", type=float, required=True)
    parser.add_argument("--person-class-id", type=int, required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--image-size", type=int, required=True)
    parser.add_argument("--crop-margin", type=float, required=True)
    parser.add_argument("--model-complexity", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sample_indices(frame_count, samples):
    if frame_count <= 0:
        return list(range(samples))
    margin = min(max(1, frame_count // 20), max(1, frame_count - 1))
    first = margin
    last = max(first, frame_count - margin - 1)
    return np.linspace(first, last, samples, dtype=int).tolist()


def sample_frames(path, samples):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    indices = sample_indices(int(capture.get(cv2.CAP_PROP_FRAME_COUNT)), samples)
    requested = set(indices)
    frames = {}
    try:
        for index in range(max(indices) + 1):
            success, frame = capture.read()
            if not success:
                break
            if index in requested:
                frames[index] = frame
    finally:
        capture.release()
    return [frames.get(index) for index in indices]


def crop_person(frame, bounds, margin):
    x1, y1, x2, y2 = bounds
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    width = (x2 - x1) * margin
    height = (y2 - y1) * margin
    left = max(0, int(center_x - width / 2))
    top = max(0, int(center_y - height / 2))
    right = min(frame.shape[1], int(center_x + width / 2))
    bottom = min(frame.shape[0], int(center_y + height / 2))
    return frame[top:bottom, left:right]


def compare_frame(frame, detector, pose, confidence, image_size, crop_margin, person_class_id, device):
    if frame is None:
        return False, False, False
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    full_pose = bool(pose.process(rgb).pose_landmarks)
    prediction = detector.predict(
        frame, classes=[person_class_id], conf=confidence, imgsz=image_size,
        verbose=False, device=device,
    )[0]
    boxes = prediction.boxes
    found_person = len(boxes) > 0
    cropped_pose = False
    for box in boxes:
        crop = crop_person(frame, box.xyxy[0].tolist(), crop_margin)
        if crop.size == 0:
            continue
        crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        if pose.process(crop_rgb).pose_landmarks:
            cropped_pose = True
            break
    return full_pose, found_person, cropped_pose


def summarize(records, pose_requirement):
    return {
        split: {
            "videos": sum(item["split"] == split for item in records),
            "full_pose_eligible": sum(
                item["full_pose_frames"] >= pose_requirement
                for item in records if item["split"] == split
            ),
            "person_crop_pose_eligible": sum(
                item["crop_pose_frames"] >= pose_requirement
                for item in records if item["split"] == split
            ),
            "person_detected": sum(
                item["person_frames"] > 0 for item in records if item["split"] == split
            ),
        }
        for split in sorted({item["split"] for item in records})
    }


def main():
    args = read_arguments()
    if args.samples <= 0 or not 0 <= args.min_pose_frames <= args.samples:
        raise ValueError("Pose frame requirements are invalid")
    if (not 0 <= args.person_confidence <= 1 or not 0 <= args.pose_confidence <= 1
            or args.person_class_id < 0 or args.image_size <= 0 or args.crop_margin <= 0):
        raise ValueError("Detector settings are invalid")
    with args.manifest.open("r", newline="", encoding="utf-8-sig") as source:
        manifest = list(csv.DictReader(source))
    person_detector = YOLO(str(args.person_model))
    pose_detector = mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=args.model_complexity,
        min_detection_confidence=args.pose_confidence,
    )
    records = []
    try:
        for index, row in enumerate(manifest, start=1):
            counts = {"full_pose_frames": 0, "person_frames": 0, "crop_pose_frames": 0}
            for frame in sample_frames(Path(row["video_path"]), args.samples):
                full_pose, found_person, cropped_pose = compare_frame(
                    frame, person_detector, pose_detector,
                    args.person_confidence, args.image_size, args.crop_margin,
                    args.person_class_id, args.device,
                )
                counts["full_pose_frames"] += int(full_pose)
                counts["person_frames"] += int(found_person)
                counts["crop_pose_frames"] += int(cropped_pose)
            records.append({"video": Path(row["video_path"]).name,
                            "split": row["split"], **counts})
            if index % 5 == 0 or index == len(manifest):
                print(json.dumps({"processed": index, "total": len(manifest)}), flush=True)
    finally:
        pose_detector.close()
    report = {
        "settings": {
            "samples": args.samples,
            "min_pose_frames": args.min_pose_frames,
            "person_confidence": args.person_confidence,
            "pose_confidence": args.pose_confidence,
            "person_class_id": args.person_class_id,
            "device": args.device,
            "image_size": args.image_size,
            "crop_margin": args.crop_margin,
        },
        "summary": summarize(records, args.min_pose_frames),
        "videos": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
