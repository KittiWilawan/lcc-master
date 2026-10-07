import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from person_box_schema import BOX_FEATURES


def read_arguments():
    parser = argparse.ArgumentParser(description="Extract person-box motion features from fall videos")
    parser.add_argument("--dataset", action="append", required=True, help="Dataset name=manifest path")
    parser.add_argument("--person-model", type=Path, required=True)
    parser.add_argument("--person-class-id", type=int, required=True)
    parser.add_argument("--confidence", type=float, required=True)
    parser.add_argument("--image-size", type=int, required=True)
    parser.add_argument("--frames-per-video", type=int, required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def parse_dataset(value):
    name, separator, raw_path = value.partition("=")
    if not separator or not name or not raw_path:
        raise ValueError("Each dataset must use name=manifest-path")
    with Path(raw_path).open("r", newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    return name, rows


def sample_indices(frame_count, samples):
    if frame_count <= 0:
        return list(range(samples))
    margin = min(max(1, frame_count // 20), max(1, frame_count - 1))
    first = margin
    last = max(first, frame_count - margin - 1)
    return np.linspace(first, last, samples, dtype=int).tolist()


def read_frames(video_path, samples):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    indices = sample_indices(int(capture.get(cv2.CAP_PROP_FRAME_COUNT)), samples)
    frames = []
    try:
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            success, frame = capture.read()
            frames.append(frame if success else None)
    finally:
        capture.release()
    return frames


def frame_features(frame, prediction):
    if frame is None or prediction is None:
        return np.zeros(len(BOX_FEATURES), dtype=np.float32)
    boxes = prediction.boxes
    if len(boxes) == 0:
        return np.zeros(len(BOX_FEATURES), dtype=np.float32)
    selected = max(boxes, key=lambda box: float(box.conf[0]))
    x1, y1, x2, y2 = selected.xyxy[0].tolist()
    image_height, image_width = frame.shape[:2]
    width = (x2 - x1) / image_width
    height = (y2 - y1) / image_height
    return np.array([
        (x1 + x2) / (2 * image_width),
        (y1 + y2) / (2 * image_height),
        width,
        height,
        y2 / image_height,
        width * height,
        width / max(height, np.finfo(np.float32).eps),
        float(selected.conf[0]),
        float(len(boxes)),
        1.0,
    ], dtype=np.float32)


def video_features(frames, detector, person_class_id, confidence, image_size, device):
    valid_frames = [frame for frame in frames if frame is not None]
    predictions = detector.predict(
        valid_frames, classes=[person_class_id], conf=confidence, imgsz=image_size,
        verbose=False, device=device, batch=len(valid_frames),
    ) if valid_frames else []
    prediction_iterator = iter(predictions)
    return np.concatenate([
        frame_features(frame, next(prediction_iterator) if frame is not None else None)
        for frame in frames
    ])


def load_checkpoint(path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as source:
        entries = [json.loads(line) for line in source if line.strip()]
    return {entry["key"]: entry for entry in entries}


def main():
    args = read_arguments()
    if (args.person_class_id < 0 or not 0 <= args.confidence <= 1
            or args.image_size <= 0 or args.frames_per_video <= 1):
        raise ValueError("Person detector settings are invalid")
    datasets = [parse_dataset(value) for value in args.dataset]
    cases = [(name, row) for name, rows in datasets for row in rows]
    entries = load_checkpoint(args.checkpoint)
    detector = YOLO(str(args.person_model))
    args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
    with args.checkpoint.open("a", encoding="utf-8") as destination:
        for index, (name, row) in enumerate(cases, start=1):
            key = f"{name}:{row['video_path']}"
            if key not in entries:
                frames = read_frames(Path(row["video_path"]), args.frames_per_video)
                features = video_features(
                    frames, detector, args.person_class_id,
                    args.confidence, args.image_size, args.device,
                )
                entry = {
                    "key": key,
                    "source": name,
                    "label": row["label"],
                    "split": row["split"],
                    "features": features.tolist(),
                }
                destination.write(json.dumps(entry) + "\n")
                destination.flush()
                entries[key] = entry
            if index % 50 == 0 or index == len(cases):
                print(json.dumps({"processed": index, "total": len(cases)}), flush=True)
    ordered = [entries[f"{name}:{row['video_path']}"] for name, row in cases]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        features=np.array([entry["features"] for entry in ordered], dtype=np.float32),
        labels=np.array([1 if entry["label"] == "fall" else 0 for entry in ordered]),
        splits=np.array([entry["split"] for entry in ordered]),
        sources=np.array([entry["source"] for entry in ordered]),
    )
    print(json.dumps({"videos": len(ordered), "output": str(args.output)}))


if __name__ == "__main__":
    main()
