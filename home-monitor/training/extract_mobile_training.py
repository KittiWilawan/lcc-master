"""Checkpoint single-actor videos with the shipped task and a fresh VIDEO tracker per clip."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def validate_partitions(rows):
    subjects, videos = {}, {}
    for row in rows:
        case = row["case"]
        if case["split"] not in ("train", "validation", "test") or case["label"] not in ("fall", "normal"):
            raise ValueError("Invalid partition or label")
        for key, seen in (((case["dataset"], case["subject_id"]), subjects), (row["sha256"], videos)):
            if key in seen and seen[key] != case["split"]:
                raise ValueError("Participant or identical video leaks across partitions")
            seen[key] = case["split"]


def is_observed_pose(points, model):
    """Mirror native PoseObservation.create before building any classifier features."""
    threshold = model["visibilityThreshold"]
    if model["landmarkCount"] <= 0 or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("Invalid pose observation profile")
    if len(points) != model["landmarkCount"]:
        return False
    if any(not all(math.isfinite(value) for value in (p.x, p.y, p.z, p.visibility))
        or not 0 <= p.visibility <= 1 for p in points):
        return False
    visible = [point for point in points if point.visibility >= threshold]
    if not visible:
        return False
    clipped = lambda value: max(0, min(1, value))
    return (clipped(max(p.x for p in visible)) > clipped(min(p.x for p in visible))
        and clipped(max(p.y for p in visible)) > clipped(min(p.y for p in visible)))


def extraction_fingerprint(config, runtime, model, rows, task_sha, extractor_sha, versions):
    return hashlib.sha256(json.dumps({"model": model, "runtime": runtime, "task": task_sha,
        "manifest": rows, "config": config, "extractor": extractor_sha, "versions": versions}, sort_keys=True).encode()).hexdigest()


def normalize(points, model, np):
    coords = np.asarray([[point.x, point.y, point.z] for point in points], dtype=np.float32)
    visibility = np.asarray([point.visibility for point in points], dtype=np.float32)
    if len(coords) != model["landmarkCount"] or not np.isfinite(coords).all() or not np.isfinite(visibility).all():
        raise ValueError("Invalid pose observations")
    visible = visibility >= model["visibilityThreshold"]
    selected = coords[visible] if visible.any() else coords
    center = selected.astype(np.float64).mean(axis=0).astype(np.float32)
    dimensions = selected.max(axis=0) - selected.min(axis=0)
    scale = max(dimensions[0], dimensions[1], np.float32(model["normalizationMinScale"]))
    return np.concatenate((((coords-center)/scale).reshape(-1), visibility,
        np.asarray([*center[:2], *dimensions[:2], visible.mean(), 1], dtype=np.float32)))


def extract(row, config, runtime, model, cv2, mp, np):
    source = Path(row["case"]["video_path"])
    if hashlib.sha256(source.read_bytes()).hexdigest() != row["sha256"]:
        raise ValueError("Source video changed after manifest creation")
    capture = cv2.VideoCapture(str(source), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, config["decoderThreads"]])
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not capture.isOpened() or not fps > 0:
        capture.release()
        raise ValueError("Cannot decode source video")
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=config["landmarker"]),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=runtime["maxPoses"],
        min_pose_detection_confidence=runtime["minPoseConfidence"],
        min_pose_presence_confidence=runtime["minPoseConfidence"],
        min_tracking_confidence=runtime["minPoseConfidence"])
    detector = None
    frames, times, counts = [], [], []
    next_sample, index = 0, 0
    started = time.monotonic()
    try:
        detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        # Match the native warm-up, and never reuse VIDEO timestamps from another clip.
        blank = np.zeros((runtime["maxFrameDimension"], runtime["maxFrameDimension"], 3), dtype=np.uint8)
        detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=blank), 0)
        while capture.grab():
            position = index * 1000 / fps
            index += 1
            if position < next_sample:
                continue
            next_sample += runtime["frameIntervalMs"]
            ok, image = capture.retrieve()
            if not ok:
                raise ValueError("Failed to retrieve decoded video frame")
            height, width = image.shape[:2]
            ratio = min(1, runtime["maxFrameDimension"] / max(width, height))
            if ratio < 1:
                image = cv2.resize(image, (max(1, int(width*ratio)), max(1, int(height*ratio))))
            rgb = np.ascontiguousarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            timestamp = round(position) + runtime["frameIntervalMs"]
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp)
            counts.append(len(result.pose_landmarks))
            observed = len(result.pose_landmarks) == 1 and is_observed_pose(result.pose_landmarks[0], model)
            feature = normalize(result.pose_landmarks[0], model, np) if observed else np.zeros(model["landmarkCount"]*4+6, dtype=np.float32)
            frames.append(feature.tolist()); times.append(round(position))
    finally:
        capture.release()
        if detector is not None:
            detector.close()
    if not frames:
        raise ValueError("Source video had no decoded samples")
    return {**row, "frames": frames, "timestampsMs": times, "peopleCounts": counts,
        "durationMs": round(index*1000/fps), "extractSeconds": round(time.monotonic()-started, 3)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = load_json(args.config)
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "TF_NUM_INTEROP_THREADS", "TF_NUM_INTRAOP_THREADS"):
        os.environ[key] = str(config["threads"])
    sys.modules["tensorflow"] = None
    import psutil
    process = psutil.Process()
    process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    process.cpu_affinity(process.cpu_affinity()[-config["threads"]:])
    import cv2
    import mediapipe as mp
    import numpy as np
    cv2.setNumThreads(config["threads"])
    rows = load_json(config["manifest"])
    validate_partitions(rows)
    runtime, model = load_json(config["runtimeAsset"]), load_json(config["modelMetadata"])
    if runtime["poseRunningMode"] != "VIDEO":
        raise ValueError("This extractor implements the native VIDEO profile")
    task_sha = hashlib.sha256(Path(config["landmarker"]).read_bytes()).hexdigest()
    extractor_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    versions = {"mediapipe": mp.__version__, "opencv": cv2.__version__, "numpy": np.__version__}
    fingerprint = extraction_fingerprint(config, runtime, model, rows, task_sha, extractor_sha, versions)
    provenance = Path(config["provenance"])
    if provenance.exists() and load_json(provenance)["fingerprint"] != fingerprint:
        raise ValueError("Checkpoint belongs to a different extraction profile")
    provenance.write_text(json.dumps({"fingerprint": fingerprint, "config": config, "runtime": runtime, "model": model,
        "taskSha256": task_sha, "extractorSha256": extractor_sha,
        "versions": versions}, indent=2), encoding="utf-8")
    checkpoint = Path(config["checkpoint"])
    done = set()
    if checkpoint.exists():
        with checkpoint.open(encoding="utf-8") as stream:
            for line in stream:
                record = json.loads(line)
                key = record["case"]["video_path"]
                if key in done:
                    raise ValueError("Duplicate checkpoint video")
                done.add(key)
    if not done.issubset({row["case"]["video_path"] for row in rows}):
        raise ValueError("Checkpoint contains unknown videos")
    started = time.monotonic()
    with checkpoint.open("a", encoding="utf-8") as stream:
        for row in rows:
            if row["case"]["video_path"] in done:
                continue
            result = extract(row, config, runtime, model, cv2, mp, np)
            stream.write(json.dumps(result)+"\n"); stream.flush()
            done.add(row["case"]["video_path"])
            progress = {"completed": len(done), "total": len(rows), "elapsedSeconds": round(time.monotonic()-started),
                "rssMiB": round(process.memory_info().rss/1024**2)}
            Path(config["progress"]).write_text(json.dumps(progress), encoding="utf-8")
            if len(done) % config["progressEvery"] == 0 or len(done) == len(rows):
                print(json.dumps(progress), flush=True)


if __name__ == "__main__":
    main()
