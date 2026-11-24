"""Offline diagnostic of pose bundles with the shipped binary forest. Native replay is the release gate."""
import argparse
import csv
import hashlib
import json
import os
import struct
import sys
import time
from pathlib import Path


class Forest:
    def __init__(self, path):
        data = memoryview(Path(path).read_bytes()); offset = 0
        def take(fmt):
            nonlocal offset
            values = struct.unpack_from('>' + fmt, data, offset); offset += struct.calcsize('>' + fmt)
            return values[0] if len(values) == 1 else values
        self.version, self.features, count = take('iii')
        self.baseline = take('d') if self.version == 2 else 0
        self.trees = [[take('iiidd') for _ in range(take('i'))] for _ in range(count)]
        assert offset == len(data)
    def predict(self, features):
        assert len(features) == self.features
        total = 0
        for tree in self.trees:
            node = 0
            while tree[node][0] != -1:
                left, right, feature, threshold, _ = tree[node]
                node = left if features[feature] <= threshold else right
            total += tree[node][4]
        if self.version == 2:
            import math
            return 1 / (1 + math.exp(-self.baseline - total))
        return total / len(self.trees)


def normalize(points, model, np):
    coords = np.asarray([[p.x, p.y, p.z] for p in points], dtype=np.float32)
    visibility = np.asarray([p.visibility for p in points], dtype=np.float32)
    selected = coords[visibility >= model['visibilityThreshold']]
    if not len(selected): selected = coords
    center = selected.astype(np.float64).mean(axis=0).astype(np.float32)
    dimensions = selected.max(axis=0) - selected.min(axis=0)
    scale = max(dimensions[0], dimensions[1], model['normalizationMinScale'])
    return np.concatenate((((coords - center) / scale).reshape(-1), visibility,
        np.asarray([*center[:2], *dimensions[:2], (visibility >= model['visibilityThreshold']).mean(), 1], dtype=np.float32)))


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('config', type=Path); args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'TF_NUM_INTEROP_THREADS', 'TF_NUM_INTRAOP_THREADS'):
        os.environ[name] = str(config['threads'])
    os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
    import cv2
    import mediapipe as mp
    import numpy as np
    sys.path.insert(0, str(Path('home-monitor/training').resolve()))
    from train_runtime_classifier import transform
    cv2.setNumThreads(config['threads'])
    runtime = json.loads(Path(config['runtime']).read_text()); model = json.loads(Path(config['metadata']).read_text())
    forest = Forest(config['forest'])
    cases = config['cases']; reports = {}
    for bundle in config['bundles']:
        mode = getattr(mp.tasks.vision.RunningMode, bundle.get('mode', 'IMAGE'))
        def make_detector():
            return mp.tasks.vision.PoseLandmarker.create_from_options(mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=bundle['path']), running_mode=mode,
            num_poses=runtime['maxPoses'], min_pose_detection_confidence=runtime['minPoseConfidence'],
            min_pose_presence_confidence=runtime['minPoseConfidence'], min_tracking_confidence=runtime['minPoseConfidence']))
        detector = make_detector()
        output = []; started = time.monotonic()
        try:
            for case in cases:
                if mode == mp.tasks.vision.RunningMode.VIDEO:
                    detector.close(); detector = make_detector()
                cap = cv2.VideoCapture(case['path']); assert cap.isOpened(), case['path']
                fps = cap.get(cv2.CAP_PROP_FPS); assert fps > 0
                tracks = {}; next_id = 0; index = 0; next_sample = 0; trace = []; detected = False
                try:
                    while True:
                        ok, frame = cap.read()
                        if not ok: break
                        stamp = index * 1000 / fps; index += 1
                        if stamp < next_sample: continue
                        next_sample += runtime['frameIntervalMs']
                        h, w = frame.shape[:2]; ratio = min(1, runtime['maxFrameDimension'] / max(h, w))
                        if ratio < 1: frame = cv2.resize(frame, (round(w * ratio), round(h * ratio)))
                        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                        tick = time.monotonic()
                        result = detector.detect_for_video(image, round(stamp)) if mode == mp.tasks.vision.RunningMode.VIDEO else detector.detect(image)
                        infer_ms = (time.monotonic()-tick)*1000
                        tracks = {key: value for key, value in tracks.items() if stamp-value['at'] <= runtime['maxPoseGapMs']}
                        used = set(); scores = []
                        for points in result.pose_landmarks:
                            features = normalize(points, model, np); center = features[-6:-4]
                            distances = sorted((float(np.linalg.norm(center-value['center'])), key) for key,value in tracks.items() if key not in used)
                            match = distances[0][1] if distances and distances[0][0] <= runtime['maxTrackingDistance'] else None
                            if match is None:
                                match = next_id; next_id += 1
                                tracks[match] = {'frames':[], 'at':stamp, 'center':center, 'high':0, 'last_high':None}
                            track = tracks[match]; used.add(match); track['center']=center; track['at']=stamp
                            track['frames'].append((stamp, features))
                            track['frames']=[value for value in track['frames'] if stamp-value[0] <= runtime['maxWindowAgeMs']][-model['framesPerWindow']:]
                            if len(track['frames']) < runtime['minTrackFrames']: continue
                            observed=[value[1] for value in track['frames']]
                            observed=[observed[0]]*(model['framesPerWindow']-len(observed))+observed
                            probability=forest.predict(transform(observed,model,np)); scores.append(probability)
                            if track['last_high'] is not None and stamp-track['last_high'] > runtime['confirmationMaxGapMs']: track['high']=0
                            if probability >= model['fallThreshold']: track['high']+=1; track['last_high']=stamp
                            else: track['high']=0
                            detected |= track['high'] >= runtime['confirmations']
                        trace.append({'timestampMs':round(stamp), 'poses':len(result.pose_landmarks), 'scores':scores, 'inferenceMs':round(infer_ms,2)})
                finally: cap.release()
                record={**case,'predictedFall':bool(detected),'frames':len(trace),'poseFrames':sum(item['poses']>0 for item in trace),'trace':trace}
                output.append(record)
                print(json.dumps({'bundle':bundle['name'],'case':case['id'],'fall':bool(detected),'poseFrames':record['poseFrames']}),flush=True)
                reports[bundle['name']]={'modelSha256':hashlib.sha256(Path(bundle['path']).read_bytes()).hexdigest(),'cases':output,'elapsedSeconds':time.monotonic()-started}
                Path(config['output']).write_text(json.dumps({'scope':'Offline approximate association; no rotation/ROI; unchanged classifier and thresholds; Android comparison required','reports':reports},indent=2),encoding='utf-8')
        finally: detector.close()


if __name__ == '__main__': main()
