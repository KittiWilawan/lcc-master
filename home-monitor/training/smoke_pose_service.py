import argparse
import base64
import csv
import json
import urllib.request
from pathlib import Path

import cv2
import numpy as np


def read_arguments():
    parser = argparse.ArgumentParser(description="Smoke test the local pose service")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("service_url")
    return parser.parse_args()


def read_frames(path, count=4):
    capture = cv2.VideoCapture(path)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    margin = min(max(1, frame_count // 20), max(1, frame_count - 1))
    frames = []
    for index in np.linspace(margin, max(margin, frame_count - margin - 1), count, dtype=int):
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError("frame read failed")
        frames.append(frame)
    capture.release()
    return frames


def analyze(name, frames, service_url, show_result=True):
    images = []
    for frame in frames:
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            raise RuntimeError("frame encode failed")
        images.append(base64.b64encode(encoded).decode("ascii"))
    request = urllib.request.Request(
        service_url,
        data=json.dumps({"images": images}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.loads(response.read())
    if show_result:
        print(json.dumps({"case": name, **result}, ensure_ascii=False))
    return result


def main():
    args = read_arguments()
    with args.manifest.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    selected = {
        label: next(row for row in rows if row["split"] == "test" and row["label"] == label)
        for label in ("fall", "normal")
    }
    fall_frames = read_frames(selected["fall"]["video_path"])
    normal_frames = read_frames(selected["normal"]["video_path"])
    analyze("fall", fall_frames, args.service_url)
    analyze("normal", normal_frames, args.service_url)
    combined = []
    for left, right in zip(fall_frames, normal_frames):
        height = min(left.shape[0], right.shape[0])
        left_width = int(left.shape[1] * height / left.shape[0])
        right_width = int(right.shape[1] * height / right.shape[0])
        combined.append(np.concatenate((
            cv2.resize(left, (left_width, height)),
            cv2.resize(right, (right_width, height)),
        ), axis=1))
    analyze("crowded_simulation", combined, args.service_url)


if __name__ == "__main__":
    main()
