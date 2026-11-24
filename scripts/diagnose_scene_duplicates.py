"""Desktop geometry diagnostic only; Android regression results remain the release gate."""
import argparse
import json
import math
from pathlib import Path
import cv2
import mediapipe as mp


def starts(length, tile, overlap):
    return list(dict.fromkeys(list(range(0, length - tile + 1, max(1, int(tile * (1 - overlap))))) + [length - tile]))


def same(first, second, rules):
    x, y, w, h = first
    a, b, c, d = second
    overlap = max(0, min(x+w, a+c)-max(x, a)) * max(0, min(y+h, b+d)-max(y, b))
    union = w*h+c*d-overlap
    if union <= 0 or min(w, c)/max(w, c) < rules['mergeScaleRatio']:
        return False
    distance = math.hypot(x+w/2-a-c/2, y+h/2-b-d/2)
    return overlap/union >= rules['mergeIou'] or distance <= min(w, c)*rules['mergeCenterRatio']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.source_root
    settings = json.loads((source / 'results.json').read_text())['config']
    detector_settings = json.loads(Path('android/app/src/main/assets/enrollment/model.json').read_text())
    manifest = json.loads((source / 'manifest.json').read_text())
    case = next(case for case in manifest['cases'] if case['id']=='openface-single')
    result = json.loads((source / 'openface-single-results.json').read_text())
    selected = {frame['frame'] for frame in result['frames'] if frame['faces'] > 1}
    options = mp.tasks.vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=
        str(Path('android/app/src/main/assets') / settings['model']['asset'])), running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=settings['model']['maxFaces'], min_face_detection_confidence=settings['model']['minDetection'],
        min_face_presence_confidence=settings['model']['minPresence'], min_tracking_confidence=settings['model']['minTracking'])
    face_options = mp.tasks.vision.FaceDetectorOptions(base_options=mp.tasks.BaseOptions(model_asset_path=
        str(Path('android/app/src/main/assets') / detector_settings['modelAsset'])),
        min_detection_confidence=detector_settings['minDetectionConfidence'],
        min_suppression_threshold=detector_settings['minSuppressionThreshold'])
    rows = []
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker, mp.tasks.vision.FaceDetector.create_from_options(face_options) as detector:
        for index, frame in enumerate(case['frames']):
            if index > max(selected): break
            bitmap = cv2.cvtColor(cv2.imread(str(source / frame['file'])), cv2.COLOR_BGR2RGB)
            observed = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=bitmap), frame['timeMs'])
            if index not in selected: continue
            row = {'frame': index, 'landmarkerFaces': len(observed.face_landmarks), 'known': [], 'tileDetections': []}
            if len(observed.face_landmarks) != 1:
                rows.append(row); continue
            face = observed.face_landmarks[0]
            left, top = min(p.x for p in face), min(p.y for p in face)
            known = [left, top, max(p.x for p in face)-left, max(p.y for p in face)-top]
            row['known'] = known
            height, width = bitmap.shape[:2]
            tile_width = math.ceil(width * settings['scene']['tileFraction'])
            tile_height = math.ceil(height * settings['scene']['tileFraction'])
            for y in starts(height, tile_height, settings['scene']['tileOverlap']):
                for x in starts(width, tile_width, settings['scene']['tileOverlap']):
                    tile = bitmap[y:y+tile_height, x:x+tile_width].copy()
                    detection = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=tile))
                    for item in detection.detections:
                        box = item.bounding_box
                        region = [(x+box.origin_x)/width, (y+box.origin_y)/height, box.width/width, box.height/height]
                        row['tileDetections'].append({'tile': [x, y, tile_width, tile_height], 'box': region,
                            'sameAsKnown': same(known, region, settings['scene']),
                            'points': [[(x+p.x*tile_width)/width, (y+p.y*tile_height)/height] for p in item.keypoints]})
            rows.append(row)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, indent=2), encoding='utf-8')
    for row in rows:
        print(row['frame'], 'MP', row['landmarkerFaces'], 'known', row['known'], 'unmerged',
              [item['box'] for item in row['tileDetections'] if not item['sameAsKnown']])


if __name__ == '__main__':
    main()
