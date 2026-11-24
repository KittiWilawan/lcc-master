"""Small public-fixture diagnostics; not a live-user/PAD accuracy benchmark."""
import argparse
import json
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args()
    root=args.root
    # OpenCV honors JPEG EXIF orientation; BitmapFactory fixtures do not. Normalize once for both.
    for name in ['image_T1','image_F1','image_F2']:
        file=root/'fixtures'/f'{name}.jpg'; original=root/'upstream'/f'{name}.jpg'
        if not original.exists(): original.write_bytes(file.read_bytes())
        with Image.open(original) as image:
            if image.getexif().get(274,1)!=1:
                ImageOps.exif_transpose(image).convert('RGB').save(file,quality=100,subsampling=0)
    config=json.loads(Path('src/config/faceScan.json').read_text())
    security=config['security']
    options=ort.SessionOptions(); options.intra_op_num_threads=security['threads']; options.inter_op_num_threads=1
    models={item['asset']:ort.InferenceSession(str(Path('android/app/src/main/assets')/item['asset']),options,
                providers=['CPUExecutionProvider']) for item in [security['identity']]+security['passiveModels']}
    cv2.setNumThreads(1)
    sources=[('aligned-clear','reference'),('normal-dimmer','same'),('normal-brighter','same'),
             ('normal-tilt-eight','same'),('normal-jpeg-low','same'),('control-person-0','different'),
             ('control-person-1','different'),('control-person-2','different')]
    prior=Path('test-artifacts/face-scan-fix-2026-10-13/fixtures')
    for name,_ in sources: (root/'fixtures'/f'{name}.jpg').write_bytes((prior/f'{name}.jpg').read_bytes())
    sources += [('image_T1','author_live'),('image_F1','author_spoof'),('image_F2','author_spoof')]
    landmark_options=mp.tasks.vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(
      model_asset_path='android/app/src/main/assets/enrollment/face_landmarker.task'),num_faces=2)
    results=[]; vectors={}; parity=[]
    with mp.tasks.vision.FaceLandmarker.create_from_options(landmark_options) as detector:
      for name,kind in sources:
        image=cv2.imread(str(root/'fixtures'/f'{name}.jpg'))
        rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB)
        result=detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb))
        if len(result.face_landmarks)!=1:
          results.append({'name':name,'kind':kind,'faces':len(result.face_landmarks)}); continue
        points=np.array([[p.x*image.shape[1],p.y*image.shape[0]] for p in result.face_landmarks[0]])
        settings=security['identity']
        source=np.array([points[group].mean(axis=0) for group in settings['landmarkGroups']])
        target=np.array(settings['template'])
        s=source-source.mean(axis=0); t=target-target.mean(axis=0)
        denominator=np.sum(s*s); a=np.sum(s*t)/denominator
        b=np.sum(s[:,0]*t[:,1]-s[:,1]*t[:,0])/denominator
        rotation=np.array([[a,-b],[b,a]]); shift=target.mean(axis=0)-rotation@source.mean(axis=0)
        matrix=np.concatenate([rotation,shift[:,None]],axis=1)
        aligned=cv2.warpAffine(image,matrix,(settings['size'],settings['size']))
        tensor=cv2.cvtColor(aligned,cv2.COLOR_BGR2RGB).transpose(2,0,1)[None].astype(np.float32)
        feature=models[settings['asset']].run(None,{settings['input']:tensor})[0].ravel().astype(float)
        feature/=np.linalg.norm(feature); vectors[name]=feature
        live_scores=[]
        minimum=points.min(axis=0); maximum=points.max(axis=0); bbox=maximum-minimum
        for model in security['passiveModels']:
          scale=min(model['scale'],(image.shape[1]-1)/bbox[0],(image.shape[0]-1)/bbox[1])
          dimensions=bbox*scale; center=(minimum+maximum)/2
          left,top=np.clip(center-dimensions/2,[0,0],np.array([image.shape[1]-1,image.shape[0]-1])-dimensions).astype(int)
          right,bottom=(np.array([left,top])+dimensions).astype(int)
          crop=cv2.resize(image[top:bottom+1,left:right+1],(model['size'],model['size']))
          tensor=crop.transpose(2,0,1)[None].astype(np.float32)
          logits=models[model['asset']].run(None,{model['input']:tensor})[0].ravel()
          probabilities=np.exp(logits-logits.max()); probabilities/=probabilities.sum()
          live_scores.append(float(probabilities[security['liveClass']]))
        results.append({'name':name,'kind':kind,'faces':1,'liveScore':float(np.mean(live_scores)),
                        'liveScores':live_scores,'sourcePoints':source.tolist(),
                        'faceBounds':(minimum/np.array([image.shape[1],image.shape[0]])).tolist()+
                          (bbox/np.array([image.shape[1],image.shape[0]])).tolist()})
        # Public fixture vectors are test-only parity targets, never collected from app accounts.
        parity.append({'name':name,'sourcePoints':source.tolist(),'embedding':feature.tolist()})
    reference=vectors['aligned-clear']
    for result in results:
      if result['name'] in vectors:
        result['cosineToReference']=float(np.dot(reference,vectors[result['name']]))
        if result['kind'] in ('same','different'):
          result['identityExpectedPassed']=(result['cosineToReference']>=security['similarityThreshold'])==(result['kind']=='same')
        if result['kind'] in ('author_live','author_spoof'):
          result['authorLabelExpectedPassed']=(result['liveScore']>=security['liveThreshold'])==(result['kind']=='author_live')
    manifest={'fixtures':results,'scope':'public image diagnostics, no real camera attacks',
              'source':'https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15/images/sample'}
    (root/'desktop-results.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (root/'fixtures'/'security-parity.json').write_text(json.dumps(parity),encoding='utf-8')
    for row in results: print({k:v for k,v in row.items() if k not in ('sourcePoints','faceBounds','liveScores')})


if __name__=='__main__': main()
