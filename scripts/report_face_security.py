"""Thai implementation/evidence report; fixture pictures are explicitly not live captures."""
import argparse
import html
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,required=True); args=parser.parse_args()
    root=args.root
    desktop=json.loads((root/'desktop-results.json').read_text(encoding='utf-8'))['fixtures']
    native_path=root/'android-results.json'
    native=json.loads(native_path.read_text(encoding='utf-8'))['fixtures'] if native_path.exists() else []
    if native:
        native_log=(root/'native-final.log').read_text(encoding='utf-8-sig')
        assert 'OK (9 tests)' in native_log and 'FAILURES!!!' not in native_log, 'Latest Android run did not pass'
    native_by_name={r['name']:r for r in native}
    pipeline_path=root/'android-pipeline-results.json'
    pipeline=json.loads(pipeline_path.read_text(encoding='utf-8'))['fixtures'] if pipeline_path.exists() else []
    suites=[]
    for path in Path('android/app/build/test-results/testReleaseUnitTest').glob('TEST-com.looklancare.app.enrollment.*.xml'):
        suite=ET.parse(path).getroot(); suites.append({k:suite.get(k) for k in ['name','tests','failures','errors']})
    unit_tests=sum(int(s['tests']) for s in suites)
    unit_failed=sum(int(s['failures'])+int(s['errors']) for s in suites)
    apk_path=root/'apk-verification.json'
    apk=json.loads(apk_path.read_text(encoding='utf-8')) if apk_path.exists() else None
    title='เพิ่มการตรวจความต่อเนื่องใบหน้าและเสริมการตรวจภาพปลอม — 13 ตุลาคม 2026'
    summary=[
      'เพิ่ม SFace สำหรับเทียบใบหน้ากับแม่แบบตอนเริ่มรอบ และ MiniFASNet สองโมเดลสำหรับตรวจภาพหน้าตรง ร่วมกับคำสั่งกระพริบตาและหันหน้าที่สุ่มทิศ/ลำดับใหม่ในแต่ละรอบ มีเวลาสูงสุด 30 วินาทีในการทำคำสั่ง',
      'เปลี่ยนรูปผ่านการสแกน Android จะเก็บสามมุมใหม่ในครั้งเดียว เมื่อหน้าไม่ตรง ภาพไม่เหมาะสม หลายคน หรือการติดตามขาดนาน จะล้างภาพร่างและเริ่มใหม่ ข้อมูลโมเดลไม่ครบจะไม่เก็บรูป',
      'ไม่มีค่าบริการ AI รายครั้ง โมเดลอยู่ในแอป เวกเตอร์ใบหน้าไม่ส่งออกไป UI/ฐานข้อมูล และล้างเมื่อเริ่มใหม่/ปิดหน้าสแกน รูป JPEG ใช้ระบบความยินยอมและการเก็บรูปเดิม',
      f'ชุดกฎบน JVM {unit_tests} ข้อ: ผิดพลาด {unit_failed} ข้อ; JavaScript 12 ข้อผ่าน; TypeScript และ ESLint ของไฟล์ที่แก้ผ่าน',
      'การแปลง MiniFASNet ตรวจสามอินพุตต่อโมเดล ผล logits ต่างจาก PyTorch สูงสุดประมาณ 0.00000334 เป็น parity การส่งออก ไม่ใช่ความแม่นยำตรวจภาพปลอม',
      'ชุดภาพวิเคราะห์ 11 ภาพ: เทียบรูปดัดแปลงจากคนเดิม 4 คู่และบุคคลอื่น 3 คู่ ผลตรงตามคาดบน CPU คอม; ตัวอย่างที่ผู้พัฒนาตั้งชื่อ T/F ตรงตามคาด 3 ภาพ ชุดนี้เล็กและไม่ใช่ภาพจากกล้องจริงในรอบนี้',
      ('ตรวจโมเดลบน Android แล้ว: '+str(len(native))+' ภาพ มีผล parity และคะแนนในตารางด้านล่าง') if native else 'ยังไม่มีผลทดสอบโมเดลบน Android ในไฟล์รายงานนี้',
      'Android instrumentation 9 ข้อผ่าน' if native else 'Android instrumentation ยังไม่ครบ',
      ('ทวนผ่าน MediaPipe VIDEO/คุณภาพภาพ/ตัวตรวจใบหน้าในฉาก/โมเดลที่แอปใช้จริง '+str(len(pipeline))+' ภาพด้วย ไม่ใช่ทดสอบด้วยคนสแกนสด') if pipeline else 'ยังไม่มีผลทวนโมเดลผ่าน adapter กล้อง Android ในไฟล์รายงานนี้',
    ]
    limitations=[
      'ยังไม่ได้ให้คนจริงสแกนครบทุกขั้นตอนบนมือถือจริง รวมถึงผู้สูงอายุ คนใส่แว่น มือถือราคาประหยัด และแสงหลายแบบ จึงยังสรุปเวลาใช้งาน อัตราสำเร็จ หรือความแม่นยำทั่วไป 95% ไม่ได้',
      'โมเดล passive ให้คะแนนสูงกับภาพบุคคลดิจิทัลหลายภาพ และให้คะแนนต่ำกับภาพบุคคลจริงหนึ่งภาพในชุดนี้ จึงห้ามใช้คะแนนนี้เพียงอย่างเดียวตัดสินว่าคนจริงหรือปลอม ภาพนิ่งยังต้องผ่านคำสั่งเคลื่อนไหว',
      'ยังไม่ทดสอบโจมตีด้วยกระดาษจริง จอมือถือจริง วิดีโอเล่นซ้ำ Deepfake การแทรกภาพเข้ากล้อง และหน้ากากสามมิติ ไม่มีการรับรอง PAD และยังไม่เทียบเท่า TrueMoney/Face ID ระบบคำสั่งมีสี่ลำดับที่สุ่มได้ ไม่รับรองการป้องกันผู้โจมตีที่เตรียมวิดีโอหลายลำดับ',
      'threshold similarity 0.45 และ passive 0.8 เป็นค่าเริ่มต้นที่ยังต้องประเมินกับกล้อง/คนจริง ไม่ใช่ค่าที่ให้ความแม่นยำที่รับรองแล้ว การครอปใช้กรอบจาก MediaPipe ซึ่งต่างจากตัวหาใบหน้าต้นฉบับของผู้พัฒนา MiniFASNet',
      'ตรวจความต่อเนื่องเฉพาะรอบสแกน ไม่ยืนยันชื่อ บัตรประชาชน หรือความตรงกับรูปเดิมจากรอบอื่น รูปจากคลังและการถ่ายแบบเดิมไม่มีสถานะยืนยันทางชีวมิติ การอัปโหลดแต่ละมุมยังไม่ใช่ธุรกรรมเดียว อาจบันทึกได้บางมุมและต้องลองต่อ',
      'ฟีเจอร์นี้ยังไม่ทำให้ระบบตรวจล้มบนอุปกรณ์รู้ชื่อคนในภาพ CCTV โดยอัตโนมัติ ต้องเชื่อมเส้นทางระบุตัวบุคคลในภาพกล้องและประเมินแยก',
    ]
    sources=[('SFace / OpenCV Zoo','https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface'),
      ('MiniFASNet / Minivision','https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15'),
      ('ที่มาภาพ NASA และ MediaPipe','../face-scan-fix-2026-10-13/REPORT_TH.html')]
    headers=['ภาพ','ชนิด','Cosine CPU','PAD CPU','Cosine Android','PAD Android','Parity cosine']
    table=[]
    for row in desktop:
      actual=native_by_name.get(row['name'],{})
      def metric(r,key): return f"{r[key]:.4f}" if key in r and r[key] is not None else '—'
      table.append([row['name'],row['kind'],metric(row,'cosineToReference'),metric(row,'liveScore'),
                    metric(actual,'cosineToReference'),metric(actual,'liveScore'),metric(actual,'parityCosine')])
    markdown=[f'# {title}','','## สิ่งที่เพิ่ม','']+['- '+s for s in summary]+['','## ข้อจำกัดที่ยังต้องตรวจ','']+['- '+s for s in limitations]
    markdown += ['','## ผลโมเดลรายภาพ','','| '+' | '.join(headers)+' |','|'+'|'.join(['---']*len(headers))+'|']+['| '+' | '.join(r)+' |' for r in table]
    markdown += ['','ค่า cosine ใช้ตรวจความคล้าย ไม่ใช่เปอร์เซ็นต์ความแม่นยำ ค่า PAD เป็นผลจากตัวจำแนกภาพ ไม่ใช่หลักฐานว่าผู้ใช้จริงผ่านการตรวจในรอบนี้','',
                 '## ขั้นตอนทดลองบนมือถือจริง','','1. ติดตั้ง APK รุ่นใหม่และเปิดหน้ารูปอ้างอิง','2. เลือกสแกนใบหน้า ให้คนเดียวทำตามคำสั่งที่เปลี่ยนลำดับได้จนได้หน้าตรง ซ้าย และขวา','3. ลองสลับคนระหว่างสแกน ต้องไม่เก็บรูปคนใหม่ต่อจากคนเดิม','4. ลองรูปพิมพ์และรูป/วิดีโอบนจอด้วยข้อมูลทดสอบ เก็บทั้งผลรับผิดและปฏิเสธผิด','5. บันทึกเวลา จำนวนครั้งที่ลองใหม่ รุ่นมือถือ แสง และสิ่งบัง แยกคน/คลิปที่ใช้ปรับค่าจากชุดประเมินสุดท้าย','',
                 '## APK และการตรวจไฟล์','']
    if apk:
      markdown += [f"- รุ่น 1.0.12 / code 13: {Path(apk['file']).name}",f"- ขนาด {apk['bytes']/1024**2:.1f} MiB",f"- SHA-256: {apk['sha256']}",
        '- ใบรับรองตรงรุ่นเดิม โมเดล/config ตรงกับ build ทดสอบ ไม่พบภาพชุดทดสอบใน APK และ assets ตรวจล้มเดิมตรงกัน',
        f"- native libraries {len(apk['libraries'])} ไฟล์ ตรวจ ELF รองรับ alignment อย่างน้อย 16 KB"]
    else: markdown.append('ยังไม่มี APK ที่ตรวจไฟล์เสร็จในรายงานนี้')
    markdown += ['','## การแก้ปัญหาระหว่างทดสอบ','',
      '- build ทดสอบครั้งแรกส่งเส้นทาง entry สั้นผิดตำแหน่ง แก้เป็นเส้นทางจริงแล้ว',
      '- build ถัดมาหน่วยความจำ Metaspace 384 MB ไม่พอในงาน lint ของไลบรารี ปรับเป็น 512 MB และพัก Android release lint สำหรับ build รอบนี้ ชุด TypeScript/ESLint และการคอมไพล์ยังรัน',
      '- การส่งภาพจาก ADB สร้างโฟลเดอร์เป็นเจ้าของ shell ทำให้สามกรณีอ่านไฟล์ไม่ได้ แก้เจ้าของเฉพาะโฟลเดอร์ fixture ใน emulator แล้วรันทวน',
      '- พบ parity cosine ภาพแรก 0.9693 ก่อนแก้ สาเหตุเกี่ยวข้องกับตำแหน่งศูนย์พิกเซล Canvas/OpenCV ปรับเมทริกซ์และเพิ่ม unit test โดยคงเกณฑ์ parity เดิม 0.98 ไว้',
      '- ตัวอย่าง T/F สามไฟล์มี EXIF หมุน 90 องศา OpenCV อ่านตาม EXIF แต่ BitmapFactory fixture ไม่หมุน จัดภาพทดสอบให้ตรงทิศและเก็บต้นฉบับไว้ใน upstream ส่วนเฟรมกล้องจริงหมุนจาก CameraX อยู่แล้ว',
      '- เก็บ log ของรอบที่ไม่ผ่านไว้เพื่อไม่ปะปนกับผลรอบสุดท้าย ไม่มีการลบหรือแก้ข้อมูลบัญชีจริง']
    markdown += ['','## แหล่งโมเดลและภาพ','']+[f'- [{label}]({url})' for label,url in sources]+['','## ภาพตัวอย่างทุกกรณี','']
    for row in desktop:
      markdown += [f"### {row['name']}",'','ภาพสาธารณะสำหรับทดสอบ ไม่ใช่ภาพที่สแกนสดผ่านครบขั้นตอน',f"![{row['name']}](fixtures/{row['name']}.jpg)",'']
    (root/'REPORT_TH.md').write_text('\n'.join(markdown),encoding='utf-8')
    esc=html.escape
    page=['<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>body{font-family:Tahoma,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;background:#f8fafc;color:#17212b;line-height:1.8}h1{font-size:27px}h2{margin-top:36px}li{margin:12px 0}.table{overflow:auto}table{border-collapse:collapse;background:white;width:100%}td,th{padding:10px;border:1px solid #cbd5e1;font-size:13px}figure{background:white;padding:20px;border-radius:16px}figure img{max-width:100%;max-height:600px;display:block;margin:auto}a{color:#14694e}.notice{background:#fff2ce;padding:20px;border-radius:14px}code{overflow-wrap:anywhere}</style>',
      f'<title>{esc(title)}</title><h1>{esc(title)}</h1><h2>สิ่งที่เพิ่มและผลตรวจ</h2><ul>']+['<li>'+esc(s)+'</li>' for s in summary]+['</ul><div class="notice"><h2>ข้อจำกัด</h2><ul>']+['<li>'+esc(s)+'</li>' for s in limitations]+['</ul></div><h2>ผลโมเดลรายภาพ</h2><div class="table"><table><tr>']
    page += ['<th>'+esc(s)+'</th>' for s in headers]+['</tr>']
    page += ['<tr>'+''.join('<td>'+esc(cell)+'</td>' for cell in r)+'</tr>' for r in table]+['</table></div><p>Cosine และ PAD ไม่ใช่เปอร์เซ็นต์ความแม่นยำทั่วไป</p>']
    if apk: page += [f"<h2>APK 1.0.12</h2><p>{esc(Path(apk['file']).name)} · {apk['bytes']/1024**2:.1f} MiB</p><p>SHA-256: <code>{apk['sha256']}</code></p>"]
    page += ['<h2>แหล่งโมเดลและภาพ</h2><ul>']+[f'<li><a href="{esc(url)}">{esc(label)}</a></li>' for label,url in sources]+['</ul><h2>ภาพตัวอย่างทุกกรณี</h2>']
    for row in desktop:
      path=root/'fixtures'/f"{row['name']}.jpg"; assert path.is_file()
      page += [f"<figure><figcaption><strong>{esc(row['name'])}</strong> — ภาพสาธารณะสำหรับทดสอบ ไม่ใช่สแกนสด</figcaption><img src=\"fixtures/{esc(row['name'])}.jpg\" alt=\"{esc(row['name'])}\"></figure>"]
    page.append('</html>'); (root/'REPORT_TH.html').write_text('\n'.join(page),encoding='utf-8')
    print('Reports written:',unit_tests,'domain tests;',len(desktop),'pictures;',len(native),'Android model fixtures')


if __name__=='__main__': main()
