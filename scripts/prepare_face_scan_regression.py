"""Copy the unchanged baseline inputs; only the app configuration hash changes for regression."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args()
    manifest=json.loads((args.baseline/'manifest.json').read_text(encoding='utf-8'))
    before=json.loads((args.baseline/'results.json').read_text(encoding='utf-8'))
    rows={row['id']:row for row in before['cases']}
    by_case={case['id']:case for case in manifest['cases']}
    args.root.mkdir(parents=True,exist_ok=True)
    (args.root/'evidence').mkdir(exist_ok=True)
    copied=set()
    for case in manifest['cases']:
        for frame in case['frames']:
            file=frame['file']
            if file in copied: continue
            destination=args.root/file
            destination.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(args.baseline/file,destination); copied.add(file)
    background=rows['head-stationary']['frames'][0]
    manifest['regressionControls']={
        'foreground':by_case['openface-single']['frames'][0]['file'],
        'background':background['file'],
        'backgroundBounds':[background[key] for key in ['left','top','width','height']],
        'fakeTextureFrame':by_case['openface-single']['frames'][51]['file'],
        'outputRect':[10,10,130,130],
    }
    manifest['baselineRoot']=str(args.baseline.resolve())
    manifest['scanConfigSha256']=hashlib.sha256(Path('src/config/faceScan.json').read_bytes()).hexdigest()
    (args.root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('Copied unchanged frames:',len(copied),'cases:',len(manifest['cases']))


if __name__=='__main__': main()
