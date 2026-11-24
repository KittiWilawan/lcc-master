"""Report measured native clip results without interpreting missing actions as genuine-user failures."""
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import statistics
import zipfile
from PIL import Image, ImageDraw


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def overview(case, row, threshold):
    production = row['sessions'][0]
    hints = Counter(frame['decisions'][0]['hint'] for frame in row['frames'])
    scores = [frame['liveScore'] for frame in row['frames'] if frame['liveScore'] is not None]
    return {
        'id': case['id'], 'derived': case['derived'], 'kind': case['kind'],
        'frames': len(row['frames']), 'anyFaceFrames': sum(frame['faces'] > 0 for frame in row['frames']),
        'multipleFaceFrames': sum(frame['faces'] > 1 for frame in row['frames']),
        'evidenceFrames': sum(frame['hasEvidence'] for frame in row['frames']),
        'passiveMeasured': len(scores), 'passiveAboveThreshold': sum(score >= threshold for score in scores),
        'passiveMedian': statistics.median(scores) if scores else None,
        'productionComplete': production['complete'], 'productionCaptures': production['captures'],
        'retainedCaptures': production['retainedCaptures'],
        'fixedComplete': [session['name'] for session in row['sessions'][1:] if session['complete']],
        'fixedCaptures': {session['name']: session['captures'] for session in row['sessions'][1:]},
        'hints': dict(hints),
        'resetEvents': [dict(timeMs=frame['timeMs'], frame=frame['frame'], hint=frame['decisions'][0]['hint'])
                        for frame in row['frames'] if frame['decisions'][0]['reset']],
    }


def evidence_sheet(root, case, row):
    frames = row['frames']
    selected = [0]
    captures = [frame['frame'] for frame in frames if frame['decisions'][0]['capture']]
    security = [frame['frame'] for frame in frames if frame['decisions'][0]['hint'] in
                {'identity_changed', 'suspected_spoof', 'multiple', 'occluded_eyes', 'occluded_lower'}]
    measured = [frame for frame in frames if frame['liveScore'] is not None]
    if captures:
        selected.append(captures[0])
    elif security:
        selected.append(security[len(security) // 2])
    elif measured:
        selected.append(max(measured, key=lambda frame: frame['liveScore'])['frame'])
    else:
        selected.append(len(frames) // 2)
    selected.append(len(frames) - 1)
    selected = list(dict.fromkeys(selected))
    sheet = Image.new('RGB', (960, 400), '#f8fafc')
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 10), case['id'] + (' / DERIVED' if case['derived'] else ' / ORIGINAL'), fill='#17212b')
    for column, index in enumerate(selected):
        frame = frames[index]
        with Image.open(root / frame['file']) as original:
            picture = original.convert('RGB')
        picture.thumbnail((300, 270))
        left = column * 320 + 10
        top = 44
        sheet.paste(picture, (left, top))
        if frame['faces'] == 1:
            box = (left + frame['left'] * picture.width, top + frame['top'] * picture.height,
                   left + (frame['left'] + frame['width']) * picture.width,
                   top + (frame['top'] + frame['height']) * picture.height)
            draw.rectangle(box, outline='#10b981', width=2)
        decision = frame['decisions'][0]
        score = 'not evaluated' if frame['liveScore'] is None else f"{frame['liveScore']:.3f}"
        labels = [f"frame {index} / test {frame['timeMs']/1000:.1f}s / source {frame['sourceTimeMs']/1000:.1f}s",
                  f"faces={frame['faces']} yaw={frame['yaw']:.1f} / PAD={score}",
                  f"hint={decision['hint']}", f"capture={decision['capture']} / reset={decision['reset']}"]
        for line, label in enumerate(labels):
            draw.text((left, 325 + line * 17), label, fill='#17212b')
    path = Path('evidence') / f"{case['id']}-native.jpg"
    sheet.save(root / path, quality=92)
    return path.as_posix()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    results = json.loads((root / 'results.json').read_text(encoding='utf-8'))
    native_log = (root / 'native-video.log').read_text(encoding='utf-8-sig')
    assert 'OK (1 test)' in native_log and 'FAILURES!!!' not in native_log
    probe_log = (root / 'native-video-probe.log').read_text(encoding='utf-8-sig')
    assert 'OK (1 test)' in probe_log and 'FAILURES!!!' not in probe_log
    by_id = {row['id']: row for row in results['cases']}
    assert set(by_id) == {case['id'] for case in manifest['cases']}
    config = results['config']
    cases = manifest['cases']
    summaries = [overview(case, by_id[case['id']], config['security']['liveThreshold']) for case in cases]
    original = [case for case in cases if not case['derived']]
    all_elapsed = [frame['elapsedMs'] for row in results['cases'] for frame in row['frames']]
    timing = {'medianMs': statistics.median(all_elapsed), 'p95Ms': percentile(all_elapsed, .95),
              'maxMs': max(all_elapsed)}
    tested_apk = root.parent / 'face-security-2026-10-13' / 'face-audit-aligned.apk'
    shipped_apk = Path('dist-android/LookLanCare-1.0.12-face-assurance-arm64.apk')
    assets = {}
    with zipfile.ZipFile(tested_apk) as tested, zipfile.ZipFile(shipped_apk) as shipped:
        for name in tested.namelist():
            if name.startswith('assets/enrollment/') and not name.endswith('/'):
                tested_hash = hashlib.sha256(tested.read(name)).hexdigest()
                shipped_hash = hashlib.sha256(shipped.read(name)).hexdigest()
                assert tested_hash == shipped_hash, name
                assets[name] = tested_hash
    metadata = {'cases': summaries, 'timing': timing, 'configSha256': manifest['scanConfigSha256'],
                'testedApkSha256': hashlib.sha256(tested_apk.read_bytes()).hexdigest(),
                'shippedApkSha256': hashlib.sha256(shipped_apk.read_bytes()).hexdigest(), 'matchingAssets': assets}
    (root / 'summary.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding='utf-8')
    title = 'ทดสอบระบบสแกนใบหน้าด้วยวิดีโอสาธารณะ — 13 ตุลาคม 2026'
    summary = [
        f"ทดสอบวิดีโอต้นฉบับ {len(original)} คลิป รวม {sum(len(case['frames']) for case in original):,} เฟรมที่สุ่มทุก 100 ms และกรณีดัดแปลง {len(cases)-len(original)} กรณี รวมทั้งหมด {sum(len(case['frames']) for case in cases):,} เฟรม กรณีดัดแปลงไม่ใช่คนหรือคลิปอิสระเพิ่ม",
        'ใช้ MediaPipe VIDEO, SFace, MiniFASNet และกฎสแกนของแอปบน Android x86_64 API 36 แบบไม่มีหน้าต่าง ไม่มีบัญชี ไม่มีการอัปโหลดใบหน้า และไม่มีการเรียกผู้ให้บริการ AI ภายนอก',
        'หนึ่ง session ต่อกรณีใช้คำสั่งสุ่มเหมือนแอปจริง อีกสี่ session ใช้คำสั่งคงที่ครบสี่ลำดับเพื่อวิเคราะห์ ใช้ผลโมเดลชุดเดียวกัน ไม่ใช่การทดลองอิสระห้าครั้ง',
        f"โมเดลและค่า enrollment ใน APK ทดสอบตรงกับ APK 1.0.12 ที่ส่งให้ผู้ใช้ ตรวจ SHA-256 ของ assets อีกครั้ง ค่า passive ยังคง {config['security']['liveThreshold']:.2f} และ cosine ยังคง {config['security']['similarityThreshold']:.2f} ไม่มีการปรับเพื่อให้คลิปผ่าน",
        f"ชุดทดสอบจบครบ {len(cases)} กรณี แบ่งรันหลัก 17 กรณีและรันทวน identity 1 กรณี JUnit แต่ละรันผ่าน 1 ข้อซึ่งตรวจการรันครบเท่านั้น ไม่ใช่การรับรองความแม่นยำหรือความปลอดภัย",
        f"ขั้นวิเคราะห์เฟรมและกฎห้า session บน CPU emulator: median {timing['medianMs']:.1f} ms, p95 {timing['p95Ms']:.1f} ms, สูงสุด {timing['maxMs']:.1f} ms รวมการโหลดโมเดลครั้งแรกบางเฟรม ไม่รวมกล้อง/UI/อัปโหลด และไม่ใช่ความเร็วมือถือจริง",
        f"รอบสุ่มเหมือนแอปสแกนครบสามมุม {sum(row['productionComplete'] for row in summaries)}/{len(cases)} กรณี ตัวเลขนี้ไม่ใช่อัตราสำเร็จของผู้ใช้ เพราะคลิปไม่ได้ถ่ายเพื่อทำตามคำสั่งแอป",
    ]
    limitations = [
        'เป็นการป้อนเฟรมวิดีโอเข้าตัววิเคราะห์โดยตรง ไม่ใช่การใช้กล้องมือถือถ่ายจอจริง จึงยังไม่ได้วัดผลแสงสะท้อน moiré ความสว่างจอ เลนส์ และการเคลื่อนจอ',
        'วิดีโอต้นฉบับไม่ได้ทำตามคำสั่งที่สุ่ม ไม่มี ground truth ใบหน้ารายเฟรมหรือกลุ่มอายุที่ตรวจสอบได้ ไม่สามารถคำนวณความแม่นยำทั่วไป 95%, อัตราปฏิเสธผู้ใช้จริง หรือมาตรฐาน PAD ได้',
        'การได้รูปหนึ่งมุมหรือสองมุมยังไม่ใช่การสแกนสำเร็จ เก็บรูปที่ถูกล้างจาก reset แยกจากรูปที่ยังอยู่ในรอบปัจจุบัน และไม่ได้บันทึกจริงไปฐานข้อมูลในชุดนี้',
        'คะแนน passive สูงหมายถึงผลตัวจำแนกผ่านเกณฑ์เท่านั้น ไม่พิสูจน์ว่าหน้าจากคลิปเป็นคนสด กรณีถูกหยุดด้วยระยะ/คุณภาพ/คำสั่งไม่ครบไม่ถือว่าทดสอบการกันเล่นซ้ำผ่าน',
        'ตัวอย่าง head_turning_fake ของผู้พัฒนา nodding-pigeon เป็นตัวอย่างสั้นซึ่งการทดสอบของเจ้าของจัดเป็น stationary ไม่ใช่หลักฐานว่าเป็น Deepfake ขั้นสูง',
        'คลิป nodding-pigeon มีลายน้ำ iStock/Getty; เก็บลายน้ำไว้ ใบอนุญาต MIT ของ repository ไม่ใช่หลักฐานว่าวิดีโอ stock เป็น MIT และลายน้ำอาจรบกวนการวิเคราะห์',
        'OpenFace อนุญาตงานวิจัยไม่แสวงกำไรตาม LICENSE; ใช้เพื่อธีสิส/ทดลอง ไม่รวมคลิปใน APK ส่วน OpenCV extra เป็นตัวอย่างทดสอบสาธารณะ ไม่อ้างว่าใบอนุญาตของ code ครอบคลุม media ทุกไฟล์',
        'GIF Minivision เป็นเดโมที่มี UI/คะแนนของเจ้าของและความละเอียดต่ำ ไม่ใช่ benchmark อิสระ คะแนนในตารางนี้เป็นผลของโมเดลแอปเราเท่านั้น',
        'รอบนี้ไม่ได้เทรนโมเดล ไม่เปลี่ยนโค้ดแอป/threshold ไม่ทดสอบการระบุชื่อคนใน CCTV และไม่ทดสอบตรวจคนล้ม',
    ]
    headers = ['กรณี', 'ชนิด', 'เฟรม', 'พบหน้า/หลายหน้า', 'มี evidence', 'PAD ผ่าน/ประเมิน',
               'รูปเก็บ/คงอยู่ รอบสุ่ม', 'ครบสามมุม รอบสุ่ม', 'ลำดับคงที่ที่ครบ', 'ข้อความพบบ่อย']
    table = []
    for row in summaries:
        hints = ', '.join(f'{key}:{value}' for key, value in Counter(row['hints']).most_common(3))
        table.append([row['id'], 'ดัดแปลง' if row['derived'] else 'ต้นฉบับ', str(row['frames']),
                      f"{row['anyFaceFrames']}/{row['multipleFaceFrames']}", str(row['evidenceFrames']),
                      f"{row['passiveAboveThreshold']}/{row['passiveMeasured']}",
                      f"{len(row['productionCaptures'])}/{len(row['retainedCaptures'])}",
                      'ครบ' if row['productionComplete'] else 'ไม่ครบ', ', '.join(row['fixedComplete']) or 'ไม่มี', hints])
    markdown = [f'# {title}', '', '## สรุปการทดสอบ', ''] + ['- '+item for item in summary]
    page = ['<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            '<style>body{font-family:Tahoma,sans-serif;max-width:1280px;margin:28px auto;padding:0 22px;background:#f8fafc;color:#17212b;line-height:1.8}h1{font-size:27px}h2{margin-top:32px}li{margin:10px 0}.table{overflow:auto}table{border-collapse:collapse;background:white;width:100%}td,th{padding:9px;border:1px solid #cbd5e1;font-size:13px}figure{background:white;padding:16px;border-radius:14px}figure img{width:100%;height:auto}a{color:#14694e}.notice{background:#fff2ce;padding:18px;border-radius:14px}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}</style>',
            '<title>'+html.escape(title)+'</title><h1>'+html.escape(title)+'</h1>']
    def section(heading, items, notice=False):
        markdown.extend(['', '## '+heading, '']+['- '+item for item in items])
        if notice: page.append('<div class="notice">')
        page.extend(['<h2>'+html.escape(heading)+'</h2><ul>']+
                    ['<li>'+html.escape(item)+'</li>' for item in items]+['</ul>'])
        if notice: page.append('</div>')
    page.extend(['<h2>สรุปการทดสอบ</h2><ul>']+['<li>'+html.escape(item)+'</li>' for item in summary]+['</ul>'])
    by_summary = {row['id']: row for row in summaries}
    single = by_summary['openface-single']
    frozen = by_summary['frozen-openface']
    identity = by_summary['aligned-person-switch']
    replay = by_summary['aligned-slow-replay']
    issue_rows = json.loads((root / 'reviewed-findings.json').read_text(encoding='utf-8'))
    section('ผลที่สำคัญ', [
        f"พบข้อผิดพลาดการนับหน้าใน openface-single: multiple {single['multipleFaceFrames']}/{single['frames']} เฟรม ภาพรวมทุกเฟรมที่ติดธงแสดงคนเดียว สถานะนี้ล้างรอบสแกน ดูปัญหา FV-01",
        f"ภาพนิ่ง frozen-openface ผ่านคะแนน passive {frozen['passiveAboveThreshold']}/{frozen['passiveMeasured']} เฟรม คะแนน {frozen['passiveMedian']:.4f} แต่ไม่เก็บรูปเพราะยังไม่ทำคำสั่งเคลื่อนไหว จึงพบข้อจำกัดของ passive โดยยังไม่พบการสแกนครบจากภาพนิ่งในรอบนี้",
        f"เมื่อวางหน้าคนใหม่ไว้ตำแหน่ง/ขนาดใกล้เดิม aligned-person-switch แจ้ง identity_changed {identity['hints'].get('identity_changed',0)} ครั้งที่ 1.501 วินาทีของ simulation (เฟรมแรกหลังสลับ) และ reset ทุก session; ไม่มีรูปคงอยู่ เหตุนี้เกิดจากการเทียบตัวบุคคล ส่วน person-switch เดิม reset เพราะตำแหน่งเปลี่ยน จึงแยกผลกัน",
        f"คลิปหันหน้าที่ crop ให้เข้าเกณฑ์และเล่นครึ่งความเร็ว aligned-slow-replay ผ่าน passive {replay['passiveAboveThreshold']}/{replay['passiveMeasured']} เฟรมที่ประเมิน แต่ไม่เก็บรูปครบในทุกลำดับที่ทดสอบ ส่วนคลิป replay ดิบหลายกรณีไม่ถึงชั้น passive เพราะ far/occluded_eyes จึงยังสรุปการป้องกันคลิปเล่นซ้ำทั่วไปไม่ได้",
        'ภาพมืด dark-openface ถูกหยุดด้วย dark ทุก 60 เฟรม; คลิปหลายคนรายงาน multiple 170/234 เฟรม ที่เหลือหยุดด้วยคุณภาพ/ระยะ ยังไม่มีการเก็บรูป แต่ไม่ใช้ตัวเลขนี้เป็น recall เพราะไม่มี ground truth รายเฟรม',
    ])
    markdown.extend(['', '## ปัญหาและข้อจำกัดที่ตรวจพบอย่างละเอียด', ''])
    page.append('<h2>ปัญหาและข้อจำกัดที่ตรวจพบอย่างละเอียด</h2>')
    for issue in issue_rows:
        heading = issue['id']+' · '+issue['severity']+' · '+issue['title']
        markdown.extend(['', '### '+heading, ''])
        page.append('<h3>'+html.escape(heading)+'</h3><ul>')
        for label, key in [('สถานะ', 'status'), ('วิธีทำซ้ำ', 'steps'), ('ผลที่คาดหวัง', 'expected'),
                           ('ผลจริง', 'actual'), ('ผลกระทบ', 'impact'), ('ข้อจำกัด/แนวทางตรวจต่อ', 'next')]:
            sentence = label+': '+issue[key]
            markdown.append('- '+sentence)
            page.append('<li>'+html.escape(sentence)+'</li>')
        page.append('</ul>')
        for path in issue.get('images', []):
            assert (root / path).is_file()
            markdown.extend(['', '!['+issue['id']+']('+path+')', ''])
            page.append('<figure><img src="'+html.escape(path)+'" alt="'+issue['id']+'"><figcaption>'+html.escape(issue['id']+' — เฟรมวิดีโอต้นทาง ไม่ใช่ UI screenshot')+'</figcaption></figure>')
        markdown.append('- ผลรายเฟรม: '+issue['log'])
        page.append('<p>ผลรายเฟรม: <a href="'+html.escape(issue['log'])+'">'+html.escape(issue['log'])+'</a></p>')
    section('ข้อจำกัดในการอ่านผล', limitations, True)
    markdown.extend(['', '## ผลรายกรณี', '', '| '+' | '.join(headers)+' |', '|'+'|'.join(['---']*len(headers))+'|']+
                    ['| '+' | '.join(row)+' |' for row in table])
    page.extend(['<h2>ผลรายกรณี</h2><div class="table"><table><tr>'+''.join('<th>'+html.escape(cell)+'</th>' for cell in headers)+'</tr>']+
                ['<tr>'+''.join('<td>'+html.escape(cell)+'</td>' for cell in row)+'</tr>' for row in table]+['</table></div>'])
    section('วิธีทำซ้ำและหลักฐาน', [
        'source-config.json ระบุ URL/commit/การดัดแปลง; manifest.json ระบุ SHA-256 ต้นฉบับ ลำดับเฟรมและเวลา ส่วน results.json เก็บผลทุกเฟรมและทุก session',
        'เฟรมทุก 100 ms ใช้เวลาในคลิปเป็นเวลา simulation ภาพถูก decode เป็น JPEG quality 95 และลดขนาดสูงสุด 960 px โดยไม่เพิ่มขนาดต้นฉบับ; ภาพดัดแปลงมีคำอธิบายเฉพาะกรณี',
        'ติดตั้ง face-audit-aligned.apk จากรายงาน face-security-2026-10-13 พร้อม face-video-tests.apk แล้วส่ง manifest/frames เข้า external files ของ package com.looklancare.app.faceaudit.release',
        'รัน Android instrumentation class com.looklancare.app.enrollment.FaceVideoAuditTest; native-video.log บันทึกสถานะรัน ส่วน per-case results แยก capture events และ retainedCaptures พร้อม round ID',
        'evidence/*-native.jpg คือเฟรมต้นทางพร้อมกรอบ/ผล native ที่วาดหลังทดสอบ ไม่ใช่ screenshot ของกล้องใน UI แอป; ภาพ contact ต้นฉบับและภาพ crop ที่ session สุ่มเก็บได้แยกไฟล์ไว้',
        'ไม่มี token/password หรือ face embeddings ในผลรายงาน; เอกสารอาจมีใบหน้าจาก media สาธารณะและลายน้ำ ควรใช้ภายในงานวิจัยตามสิทธิ์ของแหล่งต้นทาง',
    ])
    section('สิ่งที่ควรทดสอบต่อ', [
        'ผู้ใช้จริงทำตามคำสั่งแบบสุ่มบนมือถือจริง รวมผู้สูงอายุ ผู้ใส่แว่น และหลายสภาพแสง เก็บอัตราสำเร็จ ความพยายามและเวลาจนครบสามมุม',
        'ถ่ายจอที่เล่นคลิปและกระดาษด้วยกล้องจริง ทดสอบทั้งคำสั่งตรง/ไม่ตรงกับวิดีโอ แยกคนและอุปกรณ์ที่ใช้ปรับค่าจากชุดประเมิน',
        'สลับคนหลังจับแม่แบบได้แล้วด้วยตำแหน่ง/ขนาดหน้าใกล้กัน ตรวจว่า reset เกิดจาก identity_changed และไม่มีรูปสองคนใน retainedCaptures ของรอบเดียว',
        'วัดผลแต่ละกลไกแยกกัน โดยไม่ลดมาตรการใน build ที่ส่งให้ผู้ใช้ พร้อมเก็บ failure reasons และ dataset split เพื่อประเมินความปลอดภัยอย่างตรวจสอบได้',
    ])
    markdown.extend(['', '## ที่มาและภาพหลักฐานทุกกรณี', ''])
    page.append('<h2>ที่มาและภาพหลักฐานทุกกรณี</h2>')
    for case, summary_row in zip(cases, summaries):
        row = by_id[case['id']]
        evidence = evidence_sheet(root, case, row)
        description = case.get('description', 'วิดีโอต้นฉบับจาก '+case.get('repo', ''))
        markdown.extend(['', '### '+case['id'], '', description, ''])
        page.extend(['<h3>'+html.escape(case['id'])+'</h3><p>'+html.escape(description)+'</p>'])
        if not case['derived']:
            markdown.extend([f"[ต้นทาง {case['repo']}]({case['sourceUrl']})", '', 'SHA-256: '+case['sourceSha256'], ''])
            page.append('<p><a href="'+html.escape(case['sourceUrl'])+'">ต้นทาง '+html.escape(case['repo'])+'</a></p><p>SHA-256: <code>'+case['sourceSha256']+'</code></p>')
        events = {'production': row['sessions'][0], 'fixedPlans': row['sessions'][1:], 'resets': summary_row['resetEvents']}
        markdown.extend(['![ผลเฟรม '+case['id']+']('+evidence+')', '', 'ผล session และ reset:', '```json',
                         json.dumps(events, ensure_ascii=False, indent=2), '```', ''])
        page.append('<figure><img src="'+evidence+'" alt="'+html.escape(case['id'])+'"><figcaption>เฟรมต้นทางและผล native; ไม่ใช่ UI screenshot</figcaption></figure>')
        page.append('<details><summary>รายละเอียด capture/reset ทุก session</summary><pre>'+html.escape(json.dumps(events, ensure_ascii=False, indent=2))+'</pre></details>')
    section('ใบอนุญาตและการอ้างอิง', [
        'OpenFace 2.0: Facial Behavior Analysis Toolkit — Tadas Baltrušaitis, Amir Zadeh, Yao Chong Lim, Louis-Philippe Morency, IEEE FG 2018; ดู licenses/OPENFACE.txt สำหรับข้อกำหนด noncommercial research',
        'licenses/NODDING.txt เป็น MIT ของโค้ด; licenses/NODDING_TEST_SOURCE.py แสดงผลที่เจ้าของคาดหวังของ head_turning_fake; ไม่เปลี่ยนสิทธิ์ของ stock media',
        'OpenCV extra source/readme และ URL commit อยู่ใน manifest; ไม่ได้รับรองสิทธิ์เผยแพร่วิดีโอต่อสาธารณะ',
        'Minivision Silent-Face-Anti-Spoofing demo ใช้เป็นตัวอย่างภาพที่มี UI/ภาพจอ/ภาพพิมพ์ ไม่ใช้คะแนนของผู้เผยแพร่แทนผลโมเดลเรา',
    ])
    section('การตรวจไฟล์', ['APK ทดสอบ SHA-256: '+metadata['testedApkSha256'],
                           'APK arm64 ของผู้ใช้ SHA-256: '+metadata['shippedApkSha256'],
                           'Enrollment config SHA-256: '+metadata['configSha256']])
    (root / 'REPORT_TH.md').write_text('\n'.join(markdown), encoding='utf-8')
    page.append('</html>')
    (root / 'REPORT_TH.html').write_text('\n'.join(page), encoding='utf-8')
    print(json.dumps({'cases': len(cases), 'productionComplete': sum(row['productionComplete'] for row in summaries), 'timing': timing}, ensure_ascii=False))


if __name__ == '__main__':
    main()
