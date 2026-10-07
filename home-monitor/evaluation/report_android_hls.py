"""Produce a Thai report from real Android test output; never infer a pass from compilation."""
import argparse
import base64
import hashlib
import html
import json
from pathlib import Path


def pipeline_results(path):
    if not path.exists():
        return []
    marker = "INSTRUMENTATION_STATUS: pipelineResult="
    results = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith(marker):
            results.append(json.loads(line[len(marker):]))
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    root = workspace / "test-artifacts/hls-stability"
    clips = json.loads((root / "evidence/pipeline-clips.json").read_text(encoding="utf-8"))
    sources = {case["id"]: case for case in json.loads((root / "media/cases.json").read_text(encoding="utf-8"))}
    runtime = json.loads((workspace / "android/app/src/main/assets/monitoring/runtime.json").read_text(encoding="utf-8"))
    model = json.loads((workspace / "android/app/src/main/assets/monitoring/model.json").read_text(encoding="utf-8"))
    backend = json.loads((root / "backend-status.json").read_text(encoding="utf-8")) if (root / "backend-status.json").exists() else {}
    backend_ready = backend.get("status") == "ACTIVE_HEALTHY" and backend.get("authHealthStatus") == 200
    apk = workspace / "dist-android/LookLanCare-1.0.4-hls-arm64.apk"
    md = ["# รายงาน HLS ลิงก์เดียวและความเสถียร LookLanCare 1.0.4", "", "วันที่ 6 ตุลาคม 2026 · ทดสอบเบื้องหลัง ไม่ใช้เมาส์หรือคีย์บอร์ดของผู้ใช้"]
    body = ['<h1>HLS ลิงก์เดียวและความเสถียร LookLanCare 1.0.4</h1><p>6 ตุลาคม 2026 · ทดสอบเบื้องหลัง</p>']

    def section(title, paragraphs):
        md.extend(["", f"## {title}", ""])
        for paragraph in paragraphs:
            md.extend([paragraph, ""])
        body.append(f"<section><h2>{html.escape(title)}</h2>" + "".join(f"<p>{html.escape(p)}</p>" for p in paragraphs) + "</section>")

    correct = sum(case["predictedFall"] == (case["label"] == "fall") for case in clips)
    falls = [case for case in clips if case["label"] == "fall"]
    normals = [case for case in clips if case["label"] == "normal"]
    tp = sum(case["predictedFall"] for case in falls)
    fp = sum(case["predictedFall"] for case in normals)
    section("ผลสรุป", [
        f"เส้นทางอ่าน HLS → ภาพ → AI ทำงานครบ {len(clips)}/{len(clips)} คลิป รวม {sum(case['frames'] for case in clips)} เฟรมที่วิเคราะห์ ไม่มี crash ในรอบคลิปหลังแก้ไข",
        f"AI ตรวจพบการล้ม {tp}/{len(falls)} คลิป พลาด {len(falls)-tp} คลิป แจ้งผิด {fp}/{len(normals)} คลิปปกติ ผลถูก {correct}/{len(clips)} ({correct/len(clips):.1%}) ความไวต่อการล้มในชุดนี้ {tp/len(falls):.1%}",
        "ระบบรับภาพดีขึ้น แต่ AI ชุดนี้ยังไม่เหมาะกับการเฝ้าระวังที่พึ่งการแจ้งอัตโนมัติเพียงอย่างเดียว ยังรับรองความแม่นยำ 95% หรือความเสถียร 24 ชั่วโมงไม่ได้",
        ("เปิด Supabase โปรเจกต์ Looklancare67 เดิมกลับจาก INACTIVE เป็น ACTIVE_HEALTHY แล้ว ตรวจ SQL และ Auth health HTTP 200 สำเร็จ แต่ยังไม่ได้ทดสอบเข้าสู่ระบบสองครอบครัว ซิงก์ภาพ/เหตุ และแจ้งมือถือผู้ดูแลอีกเครื่อง"
         if backend_ready else f"Supabase มีสถานะ {backend.get('status', 'ยังไม่ตรวจ')} ยังไม่ได้ยืนยันทั้งฐานข้อมูลและ Auth API จึงยังไม่ได้ทดสอบเข้าสู่ระบบสองครอบครัวหรือซิงก์เหตุจริง"),
    ])
    section("การเปิดฐานข้อมูลกลับและผลตรวจ", [
        f"โปรเจกต์เดิม {backend.get('projectId')} · status={backend.get('status')} · ตรวจเมื่อ {backend.get('checkedAt')} · SQL verified={backend.get('sqlConnectionVerified')} · Auth health HTTP={backend.get('authHealthStatus')}",
        "คำสั่ง restore ของ Supabase สำเร็จ ไม่สร้างโปรเจกต์ใหม่ ไม่ย้ายฐานข้อมูล และไม่เปลี่ยน schema หรือข้อมูลผู้ใช้",
        "ช่วงก่อนบริการพร้อมเคยตรวจ Auth health ไม่สำเร็จ หลังบริการกลับมาแล้วตรวจซ้ำได้ HTTP 200",
        "ตรวจ metadata พบช่องข้อมูล cameras, family_members และ fall_events ที่โค้ดใช้ครบ ตาราง public 8 ตารางเปิด RLS และ bucket fall-evidence / identity-references เป็น private ข้อนี้ยังไม่ใช่ผลทดสอบแยกข้อมูลสองครอบครัวหรือสิทธิ์เขียนจริง",
    ])
    section("สิ่งที่เปลี่ยน", [
        "ในโหมด app_background บน Android APK ใช้ HLS เพียงลิงก์เดียว ไม่ต้องมีลิงก์ภาพนิ่ง ตัวถอดวิดีโอและ AI ทำงานในบริการ Android โดยไม่ผูกกับหน้าจอกล้องหรือวงรอบ JavaScript",
        "รวม MediaPipe Pose Lite และตัวจำแนกที่เคยฝึกไว้ใน APK ตรวจด้วย CPU บนอุปกรณ์ ไม่เรียก AI ภายนอกสำหรับเส้นทาง HLS นี้ รอบนี้เป็นการย้ายโมเดลและทดสอบระบบ ไม่ได้ฝึกโมเดลใหม่",
        f"รองรับ {runtime['maxCameras']} กล้องพร้อมกัน สูงสุด {runtime['maxPoses']} ท่าทางต่อภาพ สุ่มภาพทุก {runtime['frameIntervalMs']} มิลลิวินาทีและข้ามเฟรมเมื่อประมวลผลไม่ทัน ภาพแสดงพร้อมกรอบมาจากเฟรมเดียวกับที่ AI วิเคราะห์ ไม่ใช่วิดีโอแสดงผล 30 เฟรมต่อวินาที",
        f"มี timeout การอ่านภาพ ตรวจภาพค้าง {runtime['frameStaleMs']/1000:g} วินาที และเชื่อมต่อใหม่ด้วยเวลารอ {runtime['retryInitialMs']/1000:g}–{runtime['retryMaxMs']/1000:g} วินาที หยุดรายงานภาพสดเมื่อวิดีโอสิ้นสุด",
        "ทดสอบกล้องจากภาพที่ถอดได้จริง ข้อมูลที่อ้างว่าเป็น JPEG แต่ไม่ใช่รูปจะไม่ผ่าน native decoder ป้องกันการเพิ่มกล้องซ้ำจากการกดรัว",
        "เก็บเหตุและรูปในพื้นที่ส่วนตัวของแอปที่ไม่สำรองขึ้นระบบ backup จำกัดคิว 30 เหตุ ใช้เวลา/ID เดิมเมื่อซิงก์ ไม่อ้างว่าส่งแจ้งแล้วเมื่อระบบปิดสิทธิ์ เก็บประวัติที่ยังไม่ซิงก์ร่วมกับประวัติบนฐานข้อมูล",
        "ล้างสถานะภาพเมื่อหยุด/ออกจากระบบ จำกัดการส่งรูปตัวอย่างเฉพาะหน้าที่กำลังดู แยกภาพที่ MediaPipe เป็นเจ้าของเพื่อแก้ crash จากภาพถูก recycle ก่อนแสดงหรือเก็บหลักฐาน",
        "แก้การปิดตัวถอดภาพให้คืนเฉพาะ context/surface ของกล้องนั้น ไม่ terminate EGL display ที่แชร์กับกล้องอื่นและหน้าจอแอป",
        "อัปเดต MediaPipe เป็น 0.10.29 ซึ่งตรวจไฟล์จริงแล้วมี x86_64 และ ARM64 ไฟล์ AI ARM64 มี ELF alignment 16 KB ตรวจ signature และ zip alignment ของ APK ที่ส่งแล้ว",
        "การเลือกชื่อในเส้นทาง AI บนอุปกรณ์ใช้เลือกพื้นที่กล้อง ยังไม่ใช่การยืนยันคนจากใบหน้าหรือรูปอ้างอิง ปรับข้อความในแอปให้บอกข้อจำกัดนี้",
    ])
    recovery = pipeline_results(root / "android-recovery.log")
    section("การเชื่อมต่อหลุด", [
        f"จำลองกล้องตอบ HTTP 503 เป็นเวลา 16 วินาที หลังเปิดกลับได้รับภาพใหม่ภายใน {recovery[-1]['recoveryMs']/1000:.3f} วินาที และพบสถานะ reconnecting จริง" if recovery else "ไม่มีผลการเชื่อมต่อกลับ",
        "ผลนี้เป็นหนึ่งครั้งในเครือข่ายทดสอบบนเครื่องเดียว ยังไม่ใช่การทดสอบ packet loss, Wi-Fi หลุดจริง หรือการทำงานหลายวัน",
    ])
    teardown = [row for row in pipeline_results(root / "release-two-camera.log") if row.get("test") == "two-camera-teardown"]
    section("สองกล้องและการคืนทรัพยากร", [
        (f"เปิดตัวถอด HLS สองตัวพร้อมกัน แล้วปิดตัวแรก ตัวที่สองยังรับภาพต่อจาก {teardown[-1]['secondFramesBeforeClose']} เป็น {teardown[-1]['secondFramesAfterClose']} เฟรม โดย reconnect {teardown[-1]['secondReconnects']} ครั้ง"
         if teardown else "ยังไม่มีผลยืนยัน runtime การปิดหนึ่งกล้องโดยไม่กระทบอีกกล้อง"),
        "กรณีนี้ตรวจการถอดภาพและทรัพยากรสองกล้อง ไม่ใช่การวัดความเร็ว AI สองกล้องหรือการติดตามหลายคนเดินตัดกัน",
    ])
    screen_paragraphs = []
    for duration in (120000, 600000):
        path = root / f"release-screen-off-{duration}.log"
        rows = pipeline_results(path)
        if rows:
            last = rows[-1]
            failed = "FAILURES!!!" in path.read_text(encoding="utf-8-sig")
            screen_paragraphs.append(f"ดับจอ {duration//60000} นาที: state={last.get('state')}, อายุผลล่าสุด {last.get('analysisAgeMs')} ms, ตรวจสถานะ {last.get('checkpoints')} ครั้ง, screenInteractive={last.get('screenInteractive')}")
            screen_paragraphs.append("การสร้างเหตุและโพสต์แจ้งเตือนหลังดับจอผ่าน" if last.get("fallAlertAfterScreenOff") else
                                     "การรับภาพและ AI ต่อเนื่องผ่าน แต่การฉีดคลิปล้มยังไม่สร้างเหตุ: การแจ้งเตือนหลังดับจอไม่ผ่าน" if failed else "ยังไม่มีผลยืนยันการแจ้งเหตุล้มหลังดับจอ")
        else:
            screen_paragraphs.append(f"ดับจอ {duration//60000} นาที: ยังไม่มีผลสำเร็จใน log จึงยังไม่ถือว่าผ่าน")
    section("การดับจอด้วย release build", screen_paragraphs + [
        "รอบ 2 และ 10 นาทีข้างต้นเป็น baseline ก่อนแก้การ terminate display ส่วนผลทวน build ล่าสุดระบุแยกด้านล่าง",
        "ใช้ Android 16 emulator แบบไม่มีหน้าต่าง แยก package ทดสอบจากแอปจริง พร้อมข้อมูล user/family สมมติ เครื่องจำลองแสดง mIsPowered=true จึงไม่ใช่การรับรอง Deep Doze หรือระบบประหยัดแบตเตอรี่ของมือถือจริง",
        "ทดสอบบริการ native ด้วยการใส่ configuration ผ่าน instrumentation ระหว่างรอบแรก backend ยัง INACTIVE หลังเปิด backend กลับยังไม่ได้ทวนการตั้งค่า HLS ผ่านหน้าแอปด้วยบัญชีจริง",
        "การแจ้งบนเครื่องที่ตรวจและการแจ้งไปเครื่องอื่นเป็นคนละเส้นทาง เส้นทาง HLS ใหม่นี้ยังไม่มีการส่งเหตุข้ามเครื่องขณะ JavaScript พัก การซิงก์ทำเมื่อ React กลับมาทำงาน",
    ])
    final_screen = pipeline_results(root / "release-screen-off-120000-final.log")
    if final_screen:
        row = final_screen[-1]
        section("ทวนการดับจอหลังแก้ทรัพยากรภาพ", [
            f"ดับจอ {row['durationMs']//60000} นาที: state={row['state']}, อายุผลล่าสุด {row['analysisAgeMs']} ms, ตรวจสถานะ {row['checkpoints']} ครั้ง, screenInteractive={row['screenInteractive']}",
            "สร้างเหตุและโพสต์แจ้งเตือนผ่าน" if row.get("fallAlertAfterScreenOff") else "การแจ้งเหตุล้มหลังดับจอยังไม่ผ่าน แม้การรับภาพและวิเคราะห์ต่อเนื่องทำงาน",
        ])
    trace_findings = []
    for name, filename in (("05-fall", "service-fall-trace-latest.json"), ("06-fall", "service-06-fall-trace.json")):
        path = root / "evidence" / filename
        if path.exists():
            rows = json.loads(path.read_text(encoding="utf-8"))
            analyses = {row['lastAnalysisAt']: row['analysis'] for row in rows if 'analysis' in row and 'lastAnalysisAt' in row}
            possible = sum(row.get('status') == 'possible_fall' for row in analyses.values())
            missing = sum(row.get('peopleCount') == 0 for row in analyses.values())
            alerts = sum(bool(row.get('fallDetected')) for row in analyses.values())
            trace_findings.append(f"{name}: trace เก็บผลไม่ซ้ำ {len(analyses)} ผล พบ possible_fall {possible} ผล ไม่พบ pose คน {missing} ผล fallDetected {alerts} ผล")
    section("สาเหตุที่การแจ้งล้มยังไม่ผ่าน", trace_findings + [
        "ภาพของคลิปถูกถอดและวิเคราะห์จนจบ แต่ท่าล้มไม่ผ่านการยืนยันต่อเนื่อง ในรอบที่เก็บ trace จึงไม่ถึงขั้นสร้างเหตุหรือโพสต์ notification แม้สิทธิ์ POST_NOTIFICATIONS ของ package ทดสอบเปิดอยู่",
        "ผลต่างจากรอบอ่าน 12 คลิปชี้ว่าผลยังไวต่อจังหวะสุ่มเฟรมและการพบ landmark ไม่ควรลดเกณฑ์ยืนยันเพื่อทำให้ชุดทดสอบเล็กผ่านโดยไม่มีข้อมูลความเสี่ยงการแจ้งผิด",
        "โมเดลเดิมฝึกจาก pose และเฟรมที่เลือกตลอดคลิป แต่ runtime นี้ใช้ MediaPipe Tasks แบบหลาย pose กับหน้าต่าง 4 เฟรมต่อเนื่อง ต้องฝึกและตรวจด้วยเส้นทางเก็บภาพ/landmark เดียวกับแอป แล้วประเมินบนคนและห้องที่ไม่อยู่ในชุดฝึก",
    ])
    section("ปัญหาที่เหลือและการทำซ้ำ", [
        "HLS-AI-01 · สูง: เล่นคลิป fall ทั้ง 6 ผ่าน HLS จริง คาดว่าพบทั้ง 6 แต่พบ 2/6 ต้องปรับชุดฝึกและการตรวจท่าทาง ไม่ใช่ปัญหาการอ่านลิงก์เพียงอย่างเดียว",
        "HLS-AI-02 · สูง: เปิด live HLS จน ready ดับจอ 2/10 นาที แล้วเปลี่ยนเป็น 05/06-fall คาดว่ามีเหตุและ OS notification แต่ไม่มีเหตุภายใน 40 วินาที ดู release-screen-off logs และ service fall traces",
        "HLS-REMOTE-01 · สูง: เครื่องตรวจปิดจอและ React พัก เส้นทาง native ใหม่นี้แจ้งเฉพาะเครื่องตรวจ ยังไม่มีการส่งเหตุถึงเครื่องผู้ดูแลในช่วงนั้น ต้องมีการส่ง backend จาก native ก่อนใช้งานข้ามเครื่อง",
        ("HLS-BACKEND-01 · แก้การพักระบบแล้ว: Supabase ACTIVE_HEALTHY และ Auth health HTTP 200 เหลือทวนตั้งค่ากล้อง/ซิงก์เหตุผ่านบัญชีจริงและการแยกข้อมูลสองครอบครัว"
         if backend_ready else "HLS-BACKEND-01 · สูง: backend ยังไม่พร้อมทั้งฐานข้อมูลและ Auth API เหลือเปิดกลับและทวนตั้งค่ากล้อง/ซิงก์เหตุด้วยบัญชีจริง"),
        "HLS-ID-01 · สูงสำหรับการตรวจเฉพาะคน: เลือกชื่อในห้องหลายคนยังเป็นการเลือกพื้นที่กล้อง ไม่ใช่ยืนยันตัวบุคคล ต้องทำระบบ identity ที่ตรวจได้ก่อนอ้างว่าตรวจเฉพาะผู้สูงอายุคนนั้น",
    ])
    section("หลักฐาน AI รายคลิป", [
        "คลิปเดิมที่มีป้ายกำกับ 6 ล้มและ 6 ไม่ล้ม จาก Figshare, FallVision และ GMD ไม่ใช่ชุดทดสอบใหม่แบบปิดผล ไม่มีป้ายกำกับอายุ เพศ หรือเวลาที่เริ่มล้มครบทุกคลิป และไม่ครอบคลุมบ้านพักคนชราจริงทั้งหมด",
        "บางคลิปยาวประมาณ 1.9 วินาที ถอดได้เพียง 4 เฟรม ขณะที่ระบบใช้หน้าต่าง 4 เฟรมและยืนยันสองครั้ง จึงมีข้อจำกัดการยืนยันก่อนคลิปจบ ส่วนกรณีอื่นที่พลาดยังต้องตรวจ landmark/โดเมนของโมเดลเพิ่มเติม",
        "firstFallMs วัดจากเริ่มเล่นคลิป ไม่ใช่เวลาหลังร่างกายเริ่มล้ม inferenceMedianMs เป็นเวลาคำนวณ AI ต่อเฟรมใน emulator ไม่ใช่เวลาตั้งแต่กล้องถึงการแจ้งเตือนหรือความเร็วบนมือถือ",
    ])
    header = ["คลิป", "ป้ายกำกับ", "ผล AI", "เฟรม", "เริ่มเห็นล้ม (ms)", "AI median (ms)"]
    table = []
    for case in clips:
        table.append([case["id"], case["label"], "ล้ม" if case["predictedFall"] else "ไม่แจ้งล้ม", str(case["frames"]), str(case["firstFallMs"] or "—"), str(case["inferenceMedianMs"])])
    md.extend(["", "| " + " | ".join(header) + " |", "| " + " | ".join(["---"]*len(header)) + " |"] + ["| " + " | ".join(row) + " |" for row in table])
    body.append('<table><thead><tr>' + ''.join(f'<th>{html.escape(cell)}</th>' for cell in header) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{html.escape(cell)}</td>' for cell in row) + '</tr>' for row in table) + '</tbody></table>')
    for case in clips:
        image = root / "evidence" / f"pipeline-{case['id']}.jpg"
        metadata = sources[case["id"]]["sourceMetadata"]
        attribution = json.dumps(metadata, ensure_ascii=False)
        md.extend(["", f"### {case['id']}", "", f"เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {attribution}", "", f"![{case['id']}]({image.as_posix()})"])
        encoded = base64.b64encode(image.read_bytes()).decode("ascii")
        body.append(f'<figure><h3>{html.escape(case["id"])}</h3><img src="data:image/jpeg;base64,{encoded}" alt="{html.escape(case["id"])}"><figcaption>เฟรมจาก HLS จริง · {html.escape(attribution)}</figcaption></figure>')
    section("การตรวจโค้ดและข้อจำกัด", [
        "TypeScript และ ESLint ผ่าน ชุดทดสอบ JavaScript 26/26 ผ่าน JVM unit test 4/4 ผ่าน ตัวจำแนก Android เทียบ Python 64 ตัวอย่างได้ผลตรงกัน (เป็นการตรวจการแปลงโมเดล ไม่ใช่ความแม่นยำ 100%)",
        f"SHA256 โมเดลต้นทาง: {model['sourceSha256']} · threshold={model['fallThreshold']} · featureVariant={model['featureVariant']}",
        "เคยพบ JNI ไม่รองรับ x86_64 และ crash จาก recycled bitmap ทั้งสองแก้และทวนการอ่านคลิปแล้ว พบ debug activity รอ idle ไม่สำเร็จ จึงเปลี่ยนวิธีเปิด activity ใน instrumentation และทวนด้วย release",
        "ยังไม่ตรวจต่อเนื่อง 24 ชั่วโมง ไม่ได้ตรวจอุณหภูมิ/แบตเตอรี่บนมือถือจริง ยังไม่มีผลความเร็ว AI สองกล้องหรือการติดตามหลายคนเดินตัดกัน ไม่ได้ทดสอบ remote push, RLS สองครอบครัว หรือสแกนระบุตัวบุคคลจริง",
    ])
    section("วิธีใช้รุ่นใหม่", [
        ("ติดตั้ง APK Android 64 บิตรุ่น 1.0.4 นี้ ฟีเจอร์ native ใหม่ไม่ทำงานใน Expo Go โปรเจกต์ Supabase เปิดกลับและตรวจ Auth health แล้ว แต่ยังไม่ได้ทวนเข้าสู่ระบบด้วยบัญชีผู้ใช้จริง"
         if backend_ready else "ติดตั้ง APK Android 64 บิตรุ่น 1.0.4 นี้ ฟีเจอร์ native ใหม่ไม่ทำงานใน Expo Go ต้องให้ Supabase พร้อมทั้งฐานข้อมูลและ Auth API จึงเข้าสู่ระบบและบันทึกการตั้งค่าได้"),
        "เข้าสู่ระบบและเลือกครอบครัว เปิดสิทธิ์แจ้งเตือน เพิ่มกล้องภายนอก ใส่ลิงก์ HLS (.m3u8) เพียงช่องเดียว แล้วทดสอบให้รับภาพได้จริง",
        "ถ้า HLS มาจากคอม ให้ใช้ IP ที่มือถือเข้าถึงได้แทน localhost ใน Wi-Fi เดียวกัน ถ้ากล้องมีเพียง RTSP/MJPEG ยังต้องมีต้นทางแปลงเป็น HLS",
        "รอให้สถานะ AI บอกว่าได้รับภาพและวิเคราะห์แล้ว ทดสอบในห้องจริงและตรวจความสำเร็จของเหตุ/การแจ้งเตือนก่อนพึ่งการเฝ้าระวัง แอปถูกบังคับหยุดหรือเครื่องรีบูตต้องเปิดแอปอีกครั้ง",
    ])
    section("APK และไฟล์หลักฐาน", [
        f"APK: {apk.as_posix()} · {apk.stat().st_size/1024/1024:.2f} MiB · versionCode 5 · package com.looklancare.app · ARM64 · ลงนามด้วยคีย์โครงการเดิม",
        f"SHA256 APK: {hashlib.sha256(apk.read_bytes()).hexdigest()}",
        f"Logs และ JSON: {root.as_posix()} · หลักฐานภาพ: {(root/'evidence').as_posix()}",
    ])
    md_path = workspace / "HLS_SINGLE_LINK_REPORT_TH.md"
    md_path.write_text("\n".join(md), encoding="utf-8")
    style = 'body{font:18px/1.65 system-ui,sans-serif;color:#17202a;background:#f4f7fa;margin:0}main{max-width:1050px;margin:auto;padding:32px}h1,h2,h3{line-height:1.25}section,figure{background:white;padding:24px;border-radius:14px;margin:24px 0}table{width:100%;border-collapse:collapse;background:white}th,td{border:1px solid #ccd6df;padding:12px;text-align:left}img{max-width:100%;height:auto}figcaption{font-size:14px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}'
    (root / "REPORT_TH.html").write_text('<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LookLanCare HLS audit</title><style>'+style+'</style><main>'+''.join(body)+'</main></html>', encoding="utf-8")
    print(json.dumps({"markdown": str(md_path), "html": str(root / "REPORT_TH.html"), "images": len(clips), "truePositive": tp, "falsePositive": fp, "falseNegative": len(falls)-tp}))


if __name__ == "__main__":
    main()
