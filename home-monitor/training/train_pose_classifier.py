import argparse
import csv
import json
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import joblib
import mediapipe as mp
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def read_arguments():
    parser = argparse.ArgumentParser(description="Train a subject-separated pose fall classifier")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--frames-per-video", type=int, default=8)
    parser.add_argument("--trees", type=int, default=400)
    parser.add_argument("--seed", type=int, default=20260926)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=1)
    return parser.parse_args()


def load_manifest(path, limit):
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    if limit:
        by_split = {split: [] for split in ("train", "validation", "test")}
        for row in rows:
            by_split[row["split"]].append(row)
        per_split = max(1, limit // len(by_split))
        selected = []
        for split_rows in by_split.values():
            indices = np.linspace(0, len(split_rows) - 1, min(per_split, len(split_rows)), dtype=int)
            selected.extend(split_rows[index] for index in indices)
        rows = selected
    return rows


def sample_indices(frame_count, samples):
    if frame_count <= 0:
        return list(range(samples))
    margin = min(max(1, frame_count // 20), max(1, frame_count - 1))
    first = margin
    last = max(first, frame_count - margin - 1)
    return np.linspace(first, last, samples, dtype=int).tolist()


def normalize_landmarks(landmarks):
    coordinates = np.array([[item.x, item.y, item.z] for item in landmarks], dtype=np.float32)
    visibility = np.array([item.visibility for item in landmarks], dtype=np.float32)
    visible = visibility >= 0.35
    selected = coordinates[visible] if visible.any() else coordinates
    center = selected.mean(axis=0)
    ranges = selected.max(axis=0) - selected.min(axis=0)
    scale = max(float(ranges[0]), float(ranges[1]), 0.05)
    normalized = (coordinates - center) / scale
    bounds = np.array([
        center[0], center[1], ranges[0], ranges[1],
        float(visible.mean()), 1.0,
    ], dtype=np.float32)
    return np.concatenate((normalized.reshape(-1), visibility, bounds))


def empty_frame_features():
    return np.zeros(33 * 3 + 33 + 6, dtype=np.float32)


worker_pose = None


def initialize_worker():
    global worker_pose
    cv2.setNumThreads(1)
    worker_pose = mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=0,
        enable_segmentation=False,
        min_detection_confidence=0.35,
    )


def extract_case(arguments):
    row, frames_per_video = arguments
    return extract_video_features(Path(row["video_path"]), worker_pose, frames_per_video)


def extract_video_features(video_path, pose, frames_per_video):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    target_indices = sample_indices(frame_count, frames_per_video)
    target_set = set(target_indices)
    extracted = {}
    try:
        for frame_index in range(max(target_indices) + 1):
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index not in target_set:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)
            if result.pose_landmarks:
                extracted[frame_index] = normalize_landmarks(result.pose_landmarks.landmark)
            else:
                extracted[frame_index] = empty_frame_features()
    finally:
        capture.release()
    frame_features = [extracted.get(index, empty_frame_features()) for index in target_indices]
    return np.concatenate(frame_features)


def print_progress(index, total, started_at):
    elapsed = time.time() - started_at
    rate = index / elapsed if elapsed else 0
    remaining = (total - index) / rate if rate else 0
    print(json.dumps({
        "processed": index,
        "total": total,
        "videos_per_second": round(rate, 2),
        "remaining_minutes": round(remaining / 60, 1),
    }), flush=True)


def extract_dataset(rows, frames_per_video, workers, progress_interval=25):
    features = []
    labels = []
    splits = []
    cases = []
    started_at = time.time()
    if workers == 1:
        initialize_worker()
        extracted = map(extract_case, ((row, frames_per_video) for row in rows))
        executor = None
    else:
        executor = ProcessPoolExecutor(max_workers=workers, initializer=initialize_worker)
        extracted = executor.map(extract_case, ((row, frames_per_video) for row in rows), chunksize=1)
    try:
        for index, (row, video_features) in enumerate(zip(rows, extracted), start=1):
            features.append(video_features)
            labels.append(1 if row["label"] == "fall" else 0)
            splits.append(row["split"])
            cases.append(row)
            if index % progress_interval == 0 or index == len(rows):
                print_progress(index, len(rows), started_at)
    finally:
        if executor:
            executor.shutdown()
    return np.stack(features), np.array(labels), np.array(splits), cases


def split_arrays(features, labels, splits, split):
    selected = splits == split
    return features[selected], labels[selected]


def evaluate(model, features, labels, threshold=0.5):
    probabilities = model.predict_proba(features)[:, 1]
    predictions = (probabilities >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(labels, predictions, labels=[0, 1]).ravel()
    return {
        "videos": int(len(labels)),
        "true_positive": int(tp),
        "true_negative": int(tn),
        "false_positive": int(fp),
        "false_negative": int(fn),
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "specificity": float(tn / (tn + fp)) if tn + fp else None,
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
    }


def select_threshold(model, features, labels):
    best = None
    for threshold in np.linspace(0.1, 0.9, 161):
        metrics = evaluate(model, features, labels, float(threshold))
        score = (
            min(metrics["recall"], metrics["specificity"]),
            metrics["f1"],
            metrics["accuracy"],
        )
        if best is None or score > best[0]:
            best = (score, float(threshold))
    return best[1]


def main():
    args = read_arguments()
    if args.frames_per_video <= 1 or args.trees <= 0 or args.workers <= 0:
        raise ValueError("frames-per-video must exceed one; trees and workers must be positive")
    rows = load_manifest(args.manifest, args.limit)
    args.output_root.mkdir(parents=True, exist_ok=True)
    cache_path = args.output_root / f"pose-features-{args.frames_per_video}.npz"
    if cache_path.exists() and not args.limit:
        cache = np.load(cache_path)
        features, labels, splits = cache["features"], cache["labels"], cache["splits"]
    else:
        features, labels, splits, _ = extract_dataset(rows, args.frames_per_video, args.workers)
        if not args.limit:
            np.savez_compressed(cache_path, features=features, labels=labels, splits=splits)

    train_features, train_labels = split_arrays(features, labels, splits, "train")
    validation_features, validation_labels = split_arrays(features, labels, splits, "validation")
    test_features, test_labels = split_arrays(features, labels, splits, "test")
    model = RandomForestClassifier(
        n_estimators=args.trees,
        class_weight="balanced_subsample",
        min_samples_leaf=2,
        max_features="sqrt",
        n_jobs=-1,
        random_state=args.seed,
    )
    model.fit(train_features, train_labels)
    threshold = select_threshold(model, validation_features, validation_labels)
    results = {
        "configuration": {
            "frames_per_video": args.frames_per_video,
            "trees": args.trees,
            "seed": args.seed,
            "feature_count": int(features.shape[1]),
            "selected_threshold": threshold,
        },
        "validation_default_threshold": evaluate(model, validation_features, validation_labels),
        "test_default_threshold": evaluate(model, test_features, test_labels),
        "validation": evaluate(model, validation_features, validation_labels, threshold),
        "test": evaluate(model, test_features, test_labels, threshold),
    }
    joblib.dump(model, args.output_root / "pose-fall-classifier.joblib")
    (args.output_root / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
