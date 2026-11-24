"""Position a different recorded face at the anchored face's location to isolate identity continuity."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    settings = json.loads((root / 'identity-probe-config.json').read_text())
    manifest = json.loads((root / 'manifest.json').read_text())
    results = json.loads((root / 'results.json').read_text())
    cases = {case['id']: case for case in manifest['cases']}
    rows = {row['id']: row for row in results['cases']}
    reference = rows[settings['reference']]['frames'][settings['referenceFrame']]
    replacement = rows[settings['replacement']]['frames'][settings['replacementFrame']]
    assert reference['faces'] == replacement['faces'] == 1
    assert reference['hasEvidence'] and replacement['hasEvidence']
    first = cv2.imread(str(root / reference['file']))
    second = cv2.imread(str(root / replacement['file']))
    first_height, first_width = first.shape[:2]
    second_height, second_width = second.shape[:2]
    scale = reference['width'] * first_width / (replacement['width'] * second_width)
    target_x = (reference['left'] + reference['width'] / 2) * first_width
    target_y = (reference['top'] + reference['height'] / 2) * first_height
    source_x = (replacement['left'] + replacement['width'] / 2) * second_width
    source_y = (replacement['top'] + replacement['height'] / 2) * second_height
    transform = np.array([[scale, 0, target_x - scale * source_x],
                          [0, scale, target_y - scale * source_y]], dtype=np.float32)
    aligned = cv2.warpAffine(second, transform, (first_width, first_height),
                            borderValue=tuple(reversed(settings['borderRgb'])))
    directory = root / 'frames' / settings['id']
    directory.mkdir(exist_ok=True)
    name = f"frames/{settings['id']}/replacement.jpg"
    assert cv2.imwrite(str(root / name), aligned, [cv2.IMWRITE_JPEG_QUALITY, manifest['config']['jpegQuality']])
    cadence = manifest['config']['intervalMs']
    frames = []
    for at in range(0, settings['beforeMs'] + settings['afterMs'], cadence):
        original = reference if at < settings['beforeMs'] else replacement
        frames.append({'timeMs': at + 1, 'sourceTimeMs': original['sourceTimeMs'],
                       'file': reference['file'] if at < settings['beforeMs'] else name})
    case = {'id': settings['id'], 'kind': 'identity_switch', 'derived': True,
            'parents': [settings['reference'], settings['replacement']], 'frames': frames,
            'durationMs': settings['beforeMs'] + settings['afterMs'],
            'description': 'Hold the first source face, then place a different source face at matching centre/width using an isotropic full-frame affine transform. Grey border; source watermark retained. Direct frame injection, not a physical switch.',
            'affineTransform': transform.tolist(), 'probeConfig': settings}
    (root / 'manifest-initial.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (root / 'results-initial.json').write_text(json.dumps(results), encoding='utf-8')
    probe = dict(manifest, cases=[case])
    (root / 'manifest-probe.json').write_text(json.dumps(probe, indent=2), encoding='utf-8')
    manifest['cases'].append(case)
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'id': case['id'], 'frames': len(frames), 'affineTransform': case['affineTransform']}))


if __name__ == '__main__':
    main()
