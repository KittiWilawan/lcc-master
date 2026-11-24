"""Compare unchanged video inputs before/after the native scanner fixes, with conservative claims."""
import argparse
from collections import Counter
import html
import json
from pathlib import Path
import shutil
import statistics
import xml.etree.ElementTree as ET
from report_face_video_audit import evidence_sheet, overview, percentile


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,required=True); args=parser.parse_args()
    root=args.root
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    baseline=Path(manifest['baselineRoot'])
    before=json.loads((baseline/'results.json').read_text(encoding='utf-8'))
    after=json.loads((root/'results.json').read_text(encoding='utf-8'))
    assert 'OK (1 test)' in (root/'native-video.log').read_text(encoding='utf-8-sig')
    assert 'OK (5 tests)' in (root/'native-controls.log').read_text(encoding='utf-8-sig')
    old={row['id']:row for row in before['cases']}; new={row['id']:row for row in after['cases']}
    assert set(old)==set(new)=={case['id'] for case in manifest['cases']}
    for case in manifest['cases']:
        assert len(case['frames'])==len(new[case['id']]['frames'])
        assert all(a['file']==b['file'] and a['timeMs']==b['timeMs'] for a,b in zip(old[case['id']]['frames'],new[case['id']]['frames']))
    for section in ['security','quality','features','motion','alignment']:
        assert all(value==after['config'][section][key] for key,value in before['config'][section].items()),section+' changed thresholds'
    controls=json.loads((root/'regression-native.json').read_text(encoding='utf-8'))
    assert next(row['faces'] for row in controls if row['case']=='small-background-person')>=2
    assert next(row['faces'] for row in controls if row['case']=='wall-texture-single-person')==1
    single=new['openface-single']
    assert all(frame['faces']==1 for frame in single['frames']), 'Single-person regression remains'
    soft=[frame for row in new.values() for frame in row['frames'] if frame['decisions'][0]['hint'] in {'eyes_blur','lower_blur'}]
    assert soft and all(not frame['decisions'][0]['reset'] for frame in soft)
    frozen=new['frozen-openface']
    stale=[frame for frame in frozen['frames'] if frame['decisions'][0]['hint']=='camera_stalled']
    assert stale and all(not session['complete'] and not session['captures'] for session in frozen['sessions'])
    assert any(frame['decisions'][0]['hint']=='identity_changed' for frame in new['aligned-person-switch']['frames'])
    assert all(not session['captures'] for session in new['openface-multiple']['sessions'])
    for identifier in ['head-nodding','head-turning']:
        uncertain=[frame for frame in new[identifier]['frames'] if frame['faces']>1]
        assert uncertain and all(frame['decisions'][0]['hint']=='checking_scene' and not frame['decisions'][0]['reset'] for frame in uncertain)
    suites=[]
    for path in Path('android/app/build/test-results/testReleaseUnitTest').glob('TEST-com.looklancare.app.enrollment.*.xml'):
        suite=ET.parse(path).getroot()
        suites.append({key:suite.get(key) for key in ['name','tests','failures','errors']})
        shutil.copy2(path,root/path.name)
    assert all(int(suite['failures'])+int(suite['errors'])==0 for suite in suites)
    count=sum(int(suite['tests']) for suite in suites)
    elapsed=[frame['elapsedMs'] for row in new.values() for frame in row['frames']]
    timing={'medianMs':statistics.median(elapsed),'p95Ms':percentile(elapsed,.95),'maxMs':max(elapsed)}
    apk_path=root/'apk-verification.json'
    apk=json.loads(apk_path.read_text(encoding='utf-8')) if apk_path.exists() else None
    summary={'cases':len(new),'frames':sum(len(row['frames']) for row in new.values()),'unitTests':count,
      'nativeTests':6,'jsTests':13,'singlePersonFalseMultipleBefore':sum(frame['faces']>1 for frame in old['openface-single']['frames']),
      'singlePersonFalseMultipleAfter':sum(frame['faces']>1 for frame in single['frames']),
      'softQualityWaitFrames':len(soft),'frozenStalledFrames':len(stale),'frozenFirstStallMs':stale[0]['timeMs'],
      'transientSinglePersonFrames':sum(frame['decisions'][0]['hint']=='checking_scene' for identifier in ['head-nodding','head-turning'] for frame in new[identifier]['frames']),
      'productionComplete':sum(row['sessions'][0]['complete'] for row in new.values()),'timing':timing,'nativeControls':controls}
    (root/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    title='แก้ระบบสแกนหน้าและทดสอบซ้ำกับคลิปเดิม — LookLanCare 1.0.13'
    statements=[
      'เพิ่ม FaceLandmarker IMAGE ยืนยันใบหน้าเล็กที่ได้จาก tile ก่อนนับเป็นคนที่สอง ใช้กรอบ landmark ยืนยันในการรวมกรอบ แทนการนับ coarse detection ทุกอัน',
      f"กรณีหลายหน้าที่ยังไม่ยืนยัน ให้ checking_scene และหยุดจับรูปทันที ต้องพบต่อเนื่อง {after['config']['motion']['multipleConfirmFrames']} เฟรมก่อนล้างรอบ เมื่อยืนยันแล้วให้คำแนะนำหลายหน้าค้างไว้โดยไม่ล้างซ้ำทุกเฟรม ผลตรวจผิดชั่วคราวใน head-nodding/head-turning {summary['transientSinglePersonFrames']} เฟรมจึงไม่ล้างรอบหรือแจ้งหลายคนทันที แต่ raw model faces ยังคงอยู่ในผลรายเฟรมเพื่อไม่ซ่อนข้อผิดพลาดของโมเดล",
      'แยกบริเวณตา/จมูก/ปากที่ไม่คมออกจากแสงไม่พอ ข้อความสื่อเหตุด้านคุณภาพโดยไม่อ้างว่า pixel quality พิสูจน์สิ่งบังใบหน้า ภาพไม่คมให้รอและเริ่มจับเวลานิ่งใหม่ แม่แบบและรูปก่อนหน้ายังคงอยู่',
      'ช่วงที่ระบบร้องขอการกระพริบตา ยอมวัด eyelid texture ที่นุ่มลงเฉพาะเมื่อทั้งสองตาปิดตามเกณฑ์และมีแม่แบบเดิมแล้ว ยังคงตรวจตัวบุคคลและ passive ต้องผ่าน และภาพช่วงนั้นไม่สามารถถูกบันทึกเป็นรูปอ้างอิง',
      'เพิ่ม fingerprint ของ pixel ตัวอย่างแบบตารางเพื่อวัดกล้องค้าง เมื่อเนื้อหาตำแหน่งตัวอย่างไม่เปลี่ยนเกิน 2 วินาที ให้ camera_stalled ล้างรอบและหยุดเก็บรูป ไม่ส่ง fingerprint ไป UI/ฐานข้อมูล/log',
      f"รันคลิปเดิมครบ {summary['cases']} กรณี / {summary['frames']:,} เฟรม ชุด native เพิ่มภาพคนที่สองขนาดเล็ก ตรวจ ownership และกล้องค้าง; native รวม 6 tests และ domain {count} tests ผ่าน JavaScript 13 tests, TypeScript และ ESLint ของไฟล์ที่แก้ผ่าน",
      f"openface-single แจ้งหลายคนผิดลดจาก {summary['singlePersonFalseMultipleBefore']}/281 เป็น {summary['singlePersonFalseMultipleAfter']}/281 เฟรม ขณะเดียวกัน negative control ยังพบคนที่สองขนาดเล็กอย่างน้อยสองใบหน้า",
      f"กรณี frozen-openface เริ่มหยุดด้วย camera_stalled ที่ {summary['frozenFirstStallMs']/1000:.3f} วินาทีของ simulation รวม {summary['frozenStalledFrames']}/60 เฟรม ไม่มีรูปเก็บทั้งห้า session; การสลับคนในตำแหน่งใกล้กันยังเกิด identity_changed",
      f"กรณี local focus ให้รอโดยไม่ reset {summary['softQualityWaitFrames']} เฟรมในชุดนี้ แต่ทุก capture ยังต้องผ่านความคม เกณฑ์รูปอ้างอิงและคะแนนโมเดลเท่าเดิม ไม่มีการลด threshold เพื่อให้คลิปผ่าน",
      f"ขั้นวิเคราะห์ + ห้า session บน emulator CPU median {timing['medianMs']:.1f} ms / p95 {timing['p95Ms']:.1f} ms / สูงสุด {timing['maxMs']:.1f} ms รวม cold load บางเฟรมและได้รับผลจากภาระเครื่องที่ใช้ร่วมกับผู้ใช้ ไม่ใช่ความเร็วมือถือจริงหรือเวลาจนสแกนเสร็จ",
      f"สแกนครบสามมุมใน production_random {summary['productionComplete']}/{len(new)} กรณี ตัวเลขนี้ไม่ใช่อัตราสำเร็จของผู้ใช้จริง เพราะวิดีโอไม่ได้ทำตามคำสั่งสุ่ม และสี่ลำดับวิเคราะห์ใช้ผลโมเดลร่วมกัน",
    ]
    limits=[
      'ภาพนิ่งยังอาจได้ passive score สูงในช่วงก่อนพบภาพค้าง กลไก freshness ตรวจข้อมูลเฟรมซ้ำ ไม่ใช่โมเดล PAD ใหม่; รูปพิมพ์หรือจอที่ถ่ายด้วยกล้องจริงจะมี noise/การเปลี่ยนภาพ จึงไม่รับรองว่าตรวจด้วย fingerprint ได้',
      'ยังไม่ทดสอบการถ่ายจอจริง วิดีโอตรงคำสั่งทุกลำดับ หน้ากากสามมิติ หรือกล้องที่อาจให้ภาพนิ่งเหมือนกันนาน ต้องทวนบนมือถือจริงและผู้สูงอายุ ถ้าเฟรมจริงค้างให้ผู้ใช้ขยับกล้องหรือเริ่มใหม่',
      'ไม่เทรนหรือเปลี่ยนน้ำหนัก SFace/MiniFASNet ไม่อ้างความแม่นยำทั่วไป 95% และยังไม่เทียบเท่าระบบการเงิน/การยืนยันบัตรประชาชน',
      'ทดสอบป้อนเฟรมตรงเข้าโมเดลและ domain ผ่าน emulator ไม่ใช่การสแกนสดครบเส้นทาง CameraX/UI/บันทึก Supabase รอบนี้ไม่มีบัญชี ไม่มีการอัปโหลด และไม่เปลี่ยนระบบตรวจคนล้ม',
      'การยืนยัน landmark เพิ่มงานเฉพาะ coarse candidate ที่อาจเป็นคนอีกคน ข้อมูลเล็ก/บังอาจยังพลาดหรือยืนยันไม่ได้ ต้องประเมินหลายคน/ระยะไกลแยกและไม่ใช้ชุดนี้เป็น recall',
      'กฎคุณภาพแสงและการถูกบังยังเป็น heuristic ภาพแสงน้อย/ไม่เห็นรายละเอียดจะไม่เก็บรูป แยกจากการรับรองความปลอดภัยด้านภาพปลอม',
      'วิดีโอต้นฉบับและกรณีดัดแปลงเป็นชุดเดิมจากรายงานก่อนหน้า สิทธิ์ OpenFace สำหรับ noncommercial research และลายน้ำ iStock/Getty ยังคงเดิม ไม่รวมสื่อเหล่านี้ใน APK',
      'คำสั่งสร้าง Android รอบแรกส่ง property แบบไม่ quote ทำให้ไม่มี task AndroidTest สำหรับ release แก้รูปแบบการส่ง argument แล้ว ไม่ใช่ข้อผิดพลาดของระบบสแกน; พัก Android release lint เพื่อจำกัด RAM ตามรอบก่อนหน้า',
      'ชุดทดสอบ cameraStall รอบแรกให้เวลาหลังลืมตาสั้นกว่าเกณฑ์ จึงยังไม่ถึงการเก็บรูป front แก้เวลาของ fixture โดยคงเกณฑ์แอปไว้; log รอบที่ไม่ผ่านและผลรอบก่อนเสริม transient guard อยู่ในไฟล์รายงานและ first-run/',
    ]
    md=['# '+title,'']; esc=html.escape
    page=['<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>body{font-family:Tahoma,sans-serif;line-height:1.8;background:#f8fafc;color:#17212b;max-width:1200px;margin:28px auto;padding:0 22px}h1{font-size:27px}h2{margin-top:30px}li{margin:10px 0}.table{overflow:auto}table{border-collapse:collapse;background:white;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;font-size:13px}.notice{background:#fff2ce;padding:18px;border-radius:14px}figure{background:white;padding:14px;border-radius:14px}img{max-width:100%;height:auto}code{overflow-wrap:anywhere}a{color:#14694e}</style>',
      '<title>'+esc(title)+'</title><h1>'+esc(title)+'</h1>']
    def section(heading,items,notice=False):
      md.extend(['','## '+heading,'']+['- '+item for item in items])
      if notice: page.append('<div class="notice">')
      page.extend(['<h2>'+esc(heading)+'</h2><ul>']+['<li>'+esc(item)+'</li>' for item in items]+['</ul>'])
      if notice: page.append('</div>')
    section('สิ่งที่แก้และผลตรวจ',statements)
    transient_image='evidence/other-single-person-flags.jpg'
    if (root/transient_image).is_file():
      md.extend(['','### เฟรมที่โมเดลรายงานหลายหน้าชั่วคราว','','ภาพต้นทางสี่เฟรมนี้ยังมี raw faces มากกว่าหนึ่ง แต่ผลล่าสุดเป็น checking_scene ไม่มี capture และไม่มี reset จึงเก็บข้อผิดพลาดของโมเดลไว้ในข้อมูลอย่างตรงไปตรงมา','',
        '![เฟรมตรวจผิดชั่วคราว]('+transient_image+')',''])
      page.append('<h3>เฟรมที่โมเดลรายงานหลายหน้าชั่วคราว</h3><p>ภาพต้นทางสี่เฟรมนี้ยังมี raw faces มากกว่าหนึ่ง แต่ผลล่าสุดเป็น checking_scene ไม่มี capture และไม่มี reset</p><figure><img src="'+transient_image+'" alt="สี่เฟรมคนเดียวที่โมเดลรายงานมากกว่าหนึ่งใบหน้า"></figure>')
    section('ขอบเขตและสิ่งที่ยังต้องทดสอบ',limits,True)
    if apk:
      section('APK สำหรับติดตั้ง',[
        Path(apk['file']).name, f"ขนาด {apk['bytes']/1024**2:.1f} MiB; SHA-256 {apk['sha256']}",
        'package และใบรับรองเดิม โมเดล/config ตรงกับ build ทดสอบ assets ตรวจล้มเดิมตรงกัน ตรวจ 16 KB ELF และ zip alignment; ไม่รวมรูปทดสอบใน APK'])
    else: section('APK สำหรับติดตั้ง',['กำลังสร้าง/ตรวจ APK ยังไม่ควรใช้รายงานฉบับนี้อ้างว่าได้ไฟล์ใหม่แล้ว'])
    headers=['กรณี','raw หลายหน้า ก่อน→หลัง','ข้อความ multiple ก่อน→หลัง','reset รอบสุ่ม ก่อน→หลัง','คุณภาพพบบ่อยหลังแก้','รูป/ครบ รอบสุ่ม','ลำดับคงที่ที่ครบ']
    table=[]
    for case in manifest['cases']:
      a=old[case['id']]; b=new[case['id']]
      metrics=overview(case,b,after['config']['security']['liveThreshold'])
      table.append([case['id'],str(sum(f['faces']>1 for f in a['frames']))+' → '+str(metrics['multipleFaceFrames']),
        str(sum(f['decisions'][0]['hint']=='multiple' for f in a['frames']))+' → '+str(metrics['hints'].get('multiple',0)),
        str(sum(f['decisions'][0]['reset'] for f in a['frames']))+' → '+str(len(metrics['resetEvents'])),
        ', '.join(f'{key}:{value}' for key,value in Counter(f['quality'] or 'clear' for f in b['frames']).most_common(3)),
        f"{len(metrics['productionCaptures'])} / {'ครบ' if metrics['productionComplete'] else 'ไม่ครบ'}", ', '.join(metrics['fixedComplete']) or 'ไม่มี'])
    md.extend(['','## เปรียบเทียบคลิปเดิม','','| '+' | '.join(headers)+' |','|'+'|'.join(['---']*len(headers))+'|']+['| '+' | '.join(row)+' |' for row in table])
    page.extend(['<h2>เปรียบเทียบคลิปเดิม</h2><div class="table"><table><tr>'+''.join('<th>'+esc(s)+'</th>' for s in headers)+'</tr>']+
      ['<tr>'+''.join('<td>'+esc(s)+'</td>' for s in row)+'</tr>' for row in table]+['</table></div>'])
    section('ไฟล์หลักฐานและทำซ้ำ',[
      'manifest.json เก็บเวลา/ลำดับเฟรม/แหล่งคลิปเดิมและ hash config ใหม่ พร้อมข้อมูล negative control ที่ใช้เพิ่มคนที่สอง',
      'results.json และ per-case results เก็บทุก frame/ห้า session/เหตุ reset/capture แยก retainedCaptures จากภาพที่เคยถูกล้าง ไม่เก็บ embeddings/fingerprint',
      'native-video.log เป็นการรันคลิปครบ; native-controls.log และ regression-native.json ตรวจภาพผนัง/คนเล็ก/ภาพมืด/เบลอ/ไม่มีคน/ownership; TEST-*.xml เป็นผล domain',
      'การสร้างและข้อผิดพลาดครั้งแรกอยู่ใน audit-build.log / audit-build-retry.log ผลสุดท้ายอยู่ใน audit-build-transient.log / production-build-final.log; native tests ใช้ argument auditDirectory=face-scan-regression',
      'ภาพต่อไปเป็นภาพต้นทางพร้อมผล native ที่วาดภายหลัง ไม่ใช่ UI screenshot; ดูรายงานก่อนแก้และที่มาสื่อใน '+str(baseline/'REPORT_TH.html'),
    ])
    for case in manifest['cases']:
      image=evidence_sheet(root,case,new[case['id']])
      md.extend(['','### '+case['id'],'','!['+case['id']+']('+image+')',''])
      page.append('<h3>'+esc(case['id'])+'</h3><figure><img src="'+image+'" alt="'+esc(case['id'])+'"></figure>')
      if not case['derived']:
        md.append('[ต้นทาง]('+case['sourceUrl']+')')
        page.append('<p><a href="'+esc(case['sourceUrl'])+'">ต้นทาง '+esc(case['repo'])+'</a></p>')
    assert (root/'small-background-person.jpg').is_file()
    md.extend(['','### Negative control: คนเล็กในพื้นหลัง','','![คนที่สอง](small-background-person.jpg)'])
    page.append('<h3>Negative control: คนเล็กในพื้นหลัง</h3><figure><img src="small-background-person.jpg" alt="ภาพประกอบคนที่สองขนาดเล็ก"></figure>')
    page.append('</html>')
    (root/'REPORT_TH.md').write_text('\n'.join(md),encoding='utf-8'); (root/'REPORT_TH.html').write_text('\n'.join(page),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__': main()
