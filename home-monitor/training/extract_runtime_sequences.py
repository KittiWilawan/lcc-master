"""Extract chronological poses with the exact shipped MediaPipe task and input size.

Checkpointed per video; does not infer fall onset from video-level labels.
"""
import argparse
import csv
import hashlib
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path


def read_rows(config):
    rows = []
    subjects = {}
    paths = set()
    for dataset in config["datasets"]:
        with Path(dataset["manifest"]).open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if row["split"] not in ("train", "validation", "test") or row["label"] not in ("fall", "normal"):
                    raise ValueError("Invalid manifest label or partition")
                subject = row[dataset.get("subjectColumn", "subject_id")]
                key = (dataset["name"], subject)
                if key in subjects and subjects[key] != row["split"]:
                    raise ValueError(f"Subject leaks across partitions: {key}")
                subjects[key] = row["split"]
                path = str(Path(row["video_path"]).resolve())
                if path in paths:
                    raise ValueError("Repeated video in manifests")
                paths.add(path)
                rows.append({**row, "subject_id": subject, "video_path": path, "dataset": dataset["name"]})
    return rows


def initialize(config):
    global detector, settings, cv2, mp, np
    sys.path.insert(0, config["poseLibraries"])
    import cv2
    import mediapipe as mp
    import numpy as np
    settings = config
    cv2.setNumThreads(config["opencvThreads"])
    running_mode = getattr(mp.tasks.vision.RunningMode, config["runtime"]["poseRunningMode"])
    if running_mode not in (mp.tasks.vision.RunningMode.IMAGE, mp.tasks.vision.RunningMode.VIDEO):
        raise ValueError("Extraction requires a synchronous pose running mode")
    detector = mp.tasks.vision.PoseLandmarker.create_from_options(
        mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=config["landmarker"]),
            running_mode=running_mode,
            num_poses=config["runtime"]["maxPoses"],
            min_pose_detection_confidence=config["runtime"]["minPoseConfidence"],
            min_pose_presence_confidence=config["runtime"]["minPoseConfidence"],
            min_tracking_confidence=config["runtime"]["minPoseConfidence"],
        ))


def normalize(points):
    coords = np.array([[p.x, p.y, p.z] for p in points], dtype=np.float32)
    visibility = np.array([p.visibility for p in points], dtype=np.float32)
    visible = visibility >= settings["model"]["visibilityThreshold"]
    selected = coords[visible] if visible.any() else coords
    center = selected.mean(axis=0)
    dimensions = selected.max(axis=0) - selected.min(axis=0)
    scale = max(float(dimensions[0]), float(dimensions[1]), settings["model"]["normalizationMinScale"])
    return np.concatenate((((coords - center) / scale).reshape(-1), visibility,
        np.array([*center[:2], *dimensions[:2], visible.mean(), 1], dtype=np.float32)))


def extract(row):
    capture = cv2.VideoCapture(row["video_path"])
    if not capture.isOpened():
        raise ValueError(f"Cannot open {row['video_path']}")
    fps = capture.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        raise ValueError("Video frame rate is unavailable")
    frames, timestamps, counts = [], [], []
    interval = settings["runtime"]["frameIntervalMs"]
    next_sample = settings["sampleOffsetMs"]
    index = 0
    started = time.monotonic()
    try:
        while True:
            ok, image = capture.read()
            if not ok:
                break
            position = index * 1000 / fps
            index += 1
            if position < next_sample:
                continue
            next_sample += interval
            height, width = image.shape[:2]
            ratio = min(1, settings["runtime"]["maxFrameDimension"] / max(height, width))
            if ratio < 1:
                image = cv2.resize(image, (round(width * ratio), round(height * ratio)))
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pose_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = detector.detect_for_video(pose_image, round(position)) if settings["runtime"]["poseRunningMode"] == "VIDEO" else detector.detect(pose_image)
            poses = result.pose_landmarks
            counts.append(len(poses))
            # These subject-labelled training collections contain one target actor.
            # Multiple-person clips are flagged for review rather than labelled automatically.
            feature = normalize(poses[0]) if len(poses) == 1 else np.zeros(
                settings["model"]["landmarkCount"] * 4 + 6, dtype=np.float32)
            frames.append(feature.tolist())
            timestamps.append(round(position))
    finally:
        capture.release()
    if not frames:
        raise ValueError("Empty video")
    return {"case": row, "sha256": hashlib.sha256(Path(row["video_path"]).read_bytes()).hexdigest(),
        "frames": frames, "timestampsMs": timestamps, "peopleCounts": counts,
        "durationMs": round(index * 1000 / fps), "extractSeconds": round(time.monotonic() - started, 3)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    runtime_path = Path(config["runtimeAsset"])
    config["runtime"] = json.loads(runtime_path.read_text(encoding="utf-8"))
    config["model"] = json.loads(Path(config["modelMetadata"]).read_text(encoding="utf-8"))
    output = Path(config["checkpoint"])
    output.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if output.exists():
        for line in output.read_text(encoding="utf-8").splitlines():
            done.add(json.loads(line)["case"]["video_path"])
    rows = [row for row in read_rows(config) if row["video_path"] not in done]
    provenance = {"config": config, "landmarkerSha256": hashlib.sha256(Path(config["landmarker"]).read_bytes()).hexdigest(),
        "runtimeSha256": hashlib.sha256(runtime_path.read_bytes()).hexdigest(), "completedAtStart": len(done), "remaining": len(rows)}
    Path(config["provenance"]).write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    started = time.monotonic()
    with ProcessPoolExecutor(max_workers=config["workers"], initializer=initialize, initargs=(config,)) as executor:
        with output.open("a", encoding="utf-8") as stream:
            for index, result in enumerate(executor.map(extract, rows, chunksize=1), start=1):
                stream.write(json.dumps(result, ensure_ascii=False) + "\n")
                stream.flush()
                if index % config["progressEvery"] == 0 or index == len(rows):
                    print(json.dumps({"completed": index + len(done), "total": len(rows) + len(done),
                        "elapsedSeconds": round(time.monotonic() - started)}), flush=True)


if __name__ == "__main__":
    main()
