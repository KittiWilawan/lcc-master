import argparse
import base64
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import cv2
import joblib
import mediapipe as mp
import numpy as np

from benchmark_classifiers import feature_variants
from train_pose_classifier import empty_frame_features, normalize_landmarks


def read_arguments():
    parser = argparse.ArgumentParser(description="Serve the trained pose fall detector locally")
    parser.add_argument("model", type=Path)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--max-request-bytes", required=True, type=int)
    parser.add_argument("--landmarker", required=True, type=Path)
    parser.add_argument("--max-poses", required=True, type=int)
    parser.add_argument("--max-tracking-distance", required=True, type=float)
    parser.add_argument("--min-track-frames", required=True, type=int)
    parser.add_argument("--primary-threshold", required=True, type=float)
    parser.add_argument("--multi-threshold", required=True, type=float)
    return parser.parse_args()


class PoseFallDetector:
    def __init__(
        self, model_path, landmarker_path, max_poses, max_tracking_distance, min_track_frames,
        primary_threshold, multi_threshold,
    ):
        artifact = joblib.load(model_path)
        self.model = artifact["model"]
        self.feature_variant = artifact["feature_variant"]
        self.frames_per_video = int(artifact["frames_per_video"])
        self.primary_threshold = primary_threshold
        self.multi_threshold = multi_threshold
        self.max_tracking_distance = max_tracking_distance
        self.min_track_frames = min_track_frames
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(landmarker_path)),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_poses=max_poses,
            min_pose_detection_confidence=0.35,
            min_pose_presence_confidence=0.35,
            min_tracking_confidence=0.35,
        )
        self.pose = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.primary_pose = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=0,
            enable_segmentation=False,
            min_detection_confidence=0.35,
        )

    def frame_poses(self, encoded_image):
        image_bytes = base64.b64decode(encoded_image, validate=True)
        frame = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("image cannot be decoded")
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self.pose.detect(image)
        primary_result = self.primary_pose.process(rgb)
        primary_features = normalize_landmarks(primary_result.pose_landmarks.landmark) \
            if primary_result.pose_landmarks else empty_frame_features()
        poses = [
            {
                "features": normalize_landmarks(landmarks),
                "center": np.mean([[item.x, item.y] for item in landmarks], axis=0),
            }
            for landmarks in result.pose_landmarks
        ]
        return {"poses": poses, "primaryFeatures": primary_features}

    def build_tracks(self, poses_by_frame):
        tracks = []
        for frame_index, poses in enumerate(poses_by_frame):
            pairs = []
            for track_index, track in enumerate(tracks):
                for pose_index, pose in enumerate(poses):
                    distance = float(np.linalg.norm(track["center"] - pose["center"]))
                    if distance <= self.max_tracking_distance:
                        pairs.append((distance, track_index, pose_index))
            assigned_tracks = set()
            assigned_poses = set()
            for _, track_index, pose_index in sorted(pairs):
                if track_index in assigned_tracks or pose_index in assigned_poses:
                    continue
                tracks[track_index]["frames"].append(poses[pose_index]["features"])
                tracks[track_index]["center"] = poses[pose_index]["center"]
                assigned_tracks.add(track_index)
                assigned_poses.add(pose_index)
            for track_index, track in enumerate(tracks):
                if track_index not in assigned_tracks:
                    track["frames"].append(empty_frame_features())
            for pose_index, pose in enumerate(poses):
                if pose_index not in assigned_poses:
                    tracks.append({
                        "center": pose["center"],
                        "frames": [empty_frame_features() for _ in range(frame_index)] + [pose["features"]],
                    })
        for track in tracks:
            while len(track["frames"]) < self.frames_per_video:
                track["frames"].append(empty_frame_features())
        return tracks

    def analyze(self, images):
        if not isinstance(images, list) or len(images) != self.frames_per_video:
            raise ValueError(f"exactly {self.frames_per_video} images are required")
        frame_results = [self.frame_poses(image) for image in images]
        poses_by_frame = [item["poses"] for item in frame_results]
        tracks = self.build_tracks(poses_by_frame)
        predictions = []
        for track in tracks:
            raw_features = np.concatenate(track["frames"])[None, :]
            variants = feature_variants(raw_features, self.frames_per_video)
            probability = float(self.model.predict_proba(variants[self.feature_variant])[:, 1][0])
            detected = sum(1 for features in track["frames"] if features[-1] > 0)
            predictions.append((probability, detected))
        people_count = max((len(poses) for poses in poses_by_frame), default=0)
        detector_mode = "multiple_people" if people_count > 1 else "primary_person"
        if detector_mode == "primary_person":
            primary_frames = [item["primaryFeatures"] for item in frame_results]
            primary_raw = np.concatenate(primary_frames)[None, :]
            primary_variants = feature_variants(primary_raw, self.frames_per_video)
            primary_probability = float(
                self.model.predict_proba(primary_variants[self.feature_variant])[:, 1][0]
            )
            primary_detected = sum(1 for features in primary_frames if features[-1] > 0)
            selected_predictions = [(primary_probability, primary_detected)]
            threshold = self.primary_threshold
        else:
            selected_predictions = predictions
            threshold = self.multi_threshold
        eligible = [item for item in selected_predictions if item[1] >= self.min_track_frames]
        probability, detected = max(eligible, default=(0.0, 0), key=lambda item: item[0])
        status = "uncertain" if not eligible else "fall" if probability >= threshold else "normal"
        return {
            "status": status,
            "confidence": probability,
            "threshold": threshold,
            "detectedPoseFrames": detected,
            "requiredFrames": self.frames_per_video,
            "peopleCount": people_count,
            "evaluatedTracks": len(tracks),
            "detectorMode": detector_mode,
            "trackCandidates": [
                {"confidence": item[0], "detectedPoseFrames": item[1]} for item in predictions
            ],
        }


def build_handler(detector, max_request_bytes):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, payload):
            content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            if self.path != "/health":
                self.send_json(404, {"error": "not found"})
                return
            self.send_json(200, {
                "status": "ready",
                "frames": detector.frames_per_video,
                "primaryThreshold": detector.primary_threshold,
                "multiThreshold": detector.multi_threshold,
                "featureVariant": detector.feature_variant,
            })

        def do_POST(self):
            if self.path != "/analyze":
                self.send_json(404, {"error": "not found"})
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > max_request_bytes:
                self.send_json(413, {"error": "request size is invalid"})
                return
            try:
                payload = json.loads(self.rfile.read(content_length))
                self.send_json(200, detector.analyze(payload.get("images")))
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": str(error)})
            except Exception:
                self.send_json(500, {"error": "pose analysis failed"})

        def log_message(self, message_format, *arguments):
            return

    return Handler


def main():
    args = read_arguments()
    detector = PoseFallDetector(
        args.model,
        args.landmarker,
        args.max_poses,
        args.max_tracking_distance,
        args.min_track_frames,
        args.primary_threshold,
        args.multi_threshold,
    )
    server = HTTPServer((args.host, args.port), build_handler(detector, args.max_request_bytes))
    print(json.dumps({
        "status": "ready",
        "host": args.host,
        "port": args.port,
        "frames": detector.frames_per_video,
        "primaryThreshold": detector.primary_threshold,
        "multiThreshold": detector.multi_threshold,
        "featureVariant": detector.feature_variant,
    }), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
