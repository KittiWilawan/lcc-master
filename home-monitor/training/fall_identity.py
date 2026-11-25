"""Compare only the face associated with a falling pose, locally and in memory."""
import base64
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "android/app/src/main/assets"
RULES = json.loads((ASSETS / "monitoring/identity.json").read_text())
MODEL = json.loads((ROOT / "src/config/faceScan.json").read_text())["security"]["identity"]


def decode_image(encoded):
    data = np.frombuffer(base64.b64decode(encoded, validate=True), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Invalid image")
    return image


class FallIdentity:
    def __init__(self):
        self.mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=2)
        self.recognizer = cv2.FaceRecognizerSF_create(str(ASSETS / MODEL["asset"]), "")

    def vector(self, frame):
        if not frame.size:
            return None
        faces = self.mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).multi_face_landmarks
        if not faces or len(faces) != 1:
            return None
        points = np.array([(p.x * frame.shape[1], p.y * frame.shape[0])
                           for p in faces[0].landmark], dtype=np.float32)
        if np.ptp(points[:, 0]) < RULES["minimumFacePixels"]:
            return None
        anchors = np.array([points[group].mean(axis=0) for group in MODEL["landmarkGroups"]])
        matrix, _ = cv2.estimateAffinePartial2D(anchors, np.float32(MODEL["template"]), method=cv2.LMEDS)
        if matrix is None:
            return None
        aligned = cv2.warpAffine(frame, matrix, (MODEL["size"], MODEL["size"]))
        if cv2.Laplacian(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < RULES["minSharpness"]:
            return None
        vector = self.recognizer.feature(aligned).flatten()
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 else None

    def matches(self, references, images, heads):
        templates = [self.vector(decode_image(ref)) for ref in references]
        templates = [v for v in templates if v is not None]
        if len(templates) < RULES["minTemplateMatches"]:
            return False
        matched = 0
        previous = None
        for image, head in zip(reversed(images), reversed(heads)):
            if head is None:
                break
            if previous == image:
                continue
            previous = image
            frame = decode_image(image)
            x, y, w, h = head
            height, width = frame.shape[:2]
            face = self.vector(frame[int(y*height):int((y+h)*height), int(x*width):int((x+w)*width)])
            if face is None:
                continue
            scores = sorted((float(face @ template) for template in templates), reverse=True)
            if scores[RULES["minTemplateMatches"]-1] < RULES["similarityThreshold"]:
                return False
            matched += 1
            if matched >= RULES["confirmationFrames"]:
                return True
        return False


def face_region(points):
    head = [p for p in points[:9] if p.visibility >= 0.5]
    if len(head) < RULES["minimumHeadJoints"]:
        return None
    xs, ys = [p.x for p in head], [p.y for p in head]
    pad = max(max(xs)-min(xs), max(ys)-min(ys))
    left, top = max(0, min(xs)-pad), max(0, min(ys)-pad)
    right, bottom = min(1, max(xs)+pad), min(1, max(ys)+pad)
    return [left, top, right-left, bottom-top] if right > left and bottom > top else None
