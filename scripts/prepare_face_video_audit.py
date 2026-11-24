"""Decode public clips at the shipped scan cadence; retain source provenance and timestamps."""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageSequence


def iter_video(path, interval, limit):
    if path.suffix.lower()=='.gif':
        with Image.open(path) as gif:
            next_sample=0; elapsed=0
            for frame in ImageSequence.Iterator(gif):
                duration=frame.info.get('duration',gif.info.get('duration',interval))
                while next_sample<elapsed+duration and next_sample<limit:
                    if next_sample>=elapsed:
                        yield next_sample,cv2.cvtColor(np.array(frame.convert('RGB')),cv2.COLOR_RGB2BGR)
                    next_sample+=interval
                elapsed+=duration
                if elapsed>=limit: break
    else:
        capture=cv2.VideoCapture(str(path)); assert capture.isOpened(),path
        fps=capture.get(cv2.CAP_PROP_FPS); assert fps>0,(path,fps)
        next_sample=0; index=0
        try:
            while True:
                ok,frame=capture.read()
                if not ok: break
                at=index*1000/fps; index+=1
                if at+0.001<next_sample: continue
                if next_sample>=limit: break
                yield next_sample,frame
                next_sample+=interval
        finally: capture.release()


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,required=True); args=parser.parse_args()
    root=args.root; config=json.loads((root/'source-config.json').read_text(encoding='utf-8-sig'))
    cv2.setNumThreads(1); cases=[]; sheets=[]
    for source in config['sources']:
        path=root/'sources'/source['file']; frames=[]; directory=root/'frames'/source['id']; directory.mkdir(exist_ok=True)
        thumbnails=[]
        for at,frame in iter_video(path,config['intervalMs'],config['maxClipMs']):
            height,width=frame.shape[:2]; scale=min(1,config['maxDimension']/max(height,width))
            if scale<1: frame=cv2.resize(frame,(round(width*scale),round(height*scale)))
            name=f"frames/{source['id']}/{len(frames):04d}.jpg"
            assert cv2.imwrite(str(root/name),frame,[cv2.IMWRITE_JPEG_QUALITY,config['jpegQuality']])
            frames.append({'file':name,'timeMs':at+1,'sourceTimeMs':at})
        assert frames,source['id']
        for index in [0,len(frames)//2,len(frames)-1]:
            image=Image.open(root/frames[index]['file']); image.thumbnail((280,210))
            thumbnails.append((frames[index]['sourceTimeMs'],image.copy()))
        sheet=Image.new('RGB',(900,265),'#f8fafc'); draw=ImageDraw.Draw(sheet)
        draw.text((12,8),source['id'],fill='#17212b')
        for i,(at,image) in enumerate(thumbnails):
            sheet.paste(image,(i*300+10,30)); draw.text((i*300+10,242),f'{at/1000:.1f} s',fill='#17212b')
        evidence=f"evidence/{source['id']}-contact.jpg"; sheet.save(root/evidence,quality=90); sheets.append(sheet)
        record=dict(source); record.update({'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
          'sourceUrl':f"https://github.com/{source['repo']}/blob/{source['sha']}/{source['path']}",
          'frames':frames,'evidence':evidence,'inputWidth':frame.shape[1],'inputHeight':frame.shape[0],
          'durationMs':frames[-1]['timeMs']+config['intervalMs'],'derived':False})
        cases.append(record)
        print(source['id'],len(frames),'frames',record['inputWidth'],record['inputHeight'])
    by_id={case['id']:case for case in cases}
    def derived(identifier,parents,kind,frames,description):
        cases.append({'id':identifier,'kind':kind,'derived':True,'parents':parents,'description':description,
          'frames':frames,'durationMs':frames[-1]['timeMs']+config['intervalMs']})
    def repeat_frames(source,duration,slow=1):
        return [dict(source[(i//slow)%len(source)],timeMs=i*config['intervalMs']+1)
                for i in range(duration//config['intervalMs'])]
    source=by_id['openface-single']['frames']
    derived('frozen-openface',['openface-single'],'frozen',repeat_frames(source[:1],config['frozenMs']),
      'Hold the first decoded frame; no generated blink or head motion.')
    second=by_id['head-stationary']['frames']
    switch=[]
    for i in range(config['switchDurationMs']//config['intervalMs']):
        at=i*config['intervalMs']; values=source if at<config['switchAtMs'] else second
        offset=at if at<config['switchAtMs'] else at-config['switchAtMs']
        switch.append(dict(values[(offset//config['intervalMs'])%len(values)],timeMs=at+1))
    derived('person-switch',['openface-single','head-stationary'],'identity_switch',switch,
      'Join two public clips of different actors after the configured switch time; not a physical room switch.')
    for slow in [1,config['slowFactor']]:
        derived(f'replay-loop-speed-{slow}',['head-turning'],'replay',
          repeat_frames(by_id['head-turning']['frames'],config['replayMs'],slow),
          f'Repeat the recorded turning clip; source time advances at 1/{slow} speed.')
    derived('fake-loop',['head-turning-fake'],'replay',
      repeat_frames(by_id['head-turning-fake']['frames'],config['replayMs']),
      'Repeat the short author fake example to give the action gate time to run.')
    aligned=[]; aligned_dir=root/'frames/aligned-turning'; aligned_dir.mkdir(exist_ok=True)
    for i,frame in enumerate(by_id['head-turning']['frames']):
        image=cv2.imread(str(root/frame['file'])); height,width=image.shape[:2]
        edge=min(height,width); left=(width-edge)//2; top=(height-edge)//2
        crop=image[top:top+edge,left:left+edge]
        name=f'frames/aligned-turning/{i:04d}.jpg'
        assert cv2.imwrite(str(root/name),crop,[cv2.IMWRITE_JPEG_QUALITY,config['jpegQuality']])
        aligned.append(dict(frame,file=name))
    derived('aligned-slow-replay',['head-turning'],'replay',repeat_frames(aligned,config['replayMs'],config['slowFactor']),
      'Centre-square crop retaining vertical view, replay at half speed; altered FOV, not an independent source.')
    dark=[]; dark_dir=root/'frames/dark-openface'; dark_dir.mkdir(exist_ok=True)
    for i,frame in enumerate(source[:config['frozenMs']//config['intervalMs']]):
        image=cv2.imread(str(root/frame['file'])); image=np.clip(image*config['darkScale'],0,255).astype(np.uint8)
        name=f'frames/dark-openface/{i:04d}.jpg'
        assert cv2.imwrite(str(root/name),image,[cv2.IMWRITE_JPEG_QUALITY,config['jpegQuality']])
        dark.append(dict(frame,file=name))
    derived('dark-openface',['openface-single'],'poor_quality',dark,'Reduce brightness without altering motion.')
    contact=Image.new('RGB',(900,265*len(sheets)),'white')
    for i,sheet in enumerate(sheets): contact.paste(sheet,(0,i*265))
    contact.save(root/'evidence/all-sources.jpg',quality=90)
    manifest={'cases':cases,'config':config,'scanConfigSha256':hashlib.sha256(Path('src/config/faceScan.json').read_bytes()).hexdigest()}
    (root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('Total',sum(len(c['frames']) for c in cases),'case frames;',len(config['sources']),'original sources;',len(cases),'cases including derivatives')


if __name__=='__main__': main()
