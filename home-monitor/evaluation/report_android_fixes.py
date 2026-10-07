"""Summarise measured fixes; preserve the earlier audit and embed only public test frames."""
import argparse
import base64
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path


def results(path):
    if not path.exists():
        return []
    marker = "INSTRUMENTATION_STATUS: pipelineResult="
    return [json.loads(line[len(marker):]) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.startswith(marker)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("apk", type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    root = workspace / "test-artifacts/hls-stability"
    version = json.loads((workspace / "app.json").read_text(encoding="utf-8"))["expo"]["version"]
    clips = [item["result"] for item in results(root / "final-fast-clips.log") if item.get("test") == "hls-clip"]
    if len(clips) != 12 or "OK (1 test)" not in (root / "final-fast-clips.log").read_text(encoding="utf-8-sig"):
        raise RuntimeError("Complete final clip test required")
    title = f"รายงานแก้ไข LookLanCare {version}"
    md = [f"# {title}", "", f"จัดทำเมื่อ {datetime.now(timezone.utc).isoformat()} · ทดสอบใน emulator แยกแบบซ่อนบนไดรฟ์ D"]
    body = [f"<h1>{html.escape(title)}</h1>"]

    def section(name, paragraphs):
        md.extend(["", f"## {name}", ""])
        body.append(f"<section><h2>{html.escape(name)}</h2>")
        for paragraph in paragraphs:
            md.extend([paragraph, ""])
            body.append(f"<p>{html.escape(paragraph)}</p>")
        body.append("</section>")

    falls = [case for case in clips if case["label"] == "fall"]
    normal = [case for case in clips if case["label"] == "normal"]
    tp = sum(case["predictedFall"] for case in falls)
    fp = sum(case["predictedFall"] for case in normal)
    section("ผลรอบสุดท้าย", [
        f"อ่านและวิเคราะห์ครบ {len(clips)} คลิป รวม {sum(case['frames'] for case in clips)} เฟรม ตรวจล้มได้ {tp}/{len(falls)} พลาด {len(falls)-tp} และแจ้งผิด {fp}/{len(normal)} คลิปไม่ล้ม",
        "ผลนี้เป็นชุดคลิปขนาดเล็กที่ใช้เปรียบเทียบระหว่างพัฒนา ไม่ใช่ผลทดสอบอิสระ ไม่ใช้รับรองความแม่นยำทั่วไป 95% หรือความพร้อมเฝ้าระวังจริงทุกห้อง",
        "แก้การแสดงข้อผิดพลาดล็อกอินและเส้นทางแจ้งเตือนเบื้องหลังแล้ว แต่ยังต้องทดสอบเข้าสู่ระบบด้วยบัญชีผู้ใช้บนมือถือจริง ตั้งค่า Firebase และรับแจ้งเตือนบนมือถือผู้ดูแลจริง",
        "ทดสอบ native pipeline ด้วย Release APK สำหรับ x86_64 ใน emulator แยก ส่วนไฟล์ส่งให้ผู้ใช้เป็น ARM64 จาก source เดียวกัน ยังไม่ได้ติดตั้งไฟล์ ARM64 บนมือถือจริง",
    ])
    section("สิ่งที่แก้", [
        "รักษารหัสและสถานะจากข้อผิดพลาดระบบบัญชี แยกรหัสผ่านผิด ระบบส่วนกลางไม่พร้อม และคำขอตอบช้าออกจากกัน ไม่แจ้งว่าล็อกอินล้มเหลวเมื่อเข้าสู่ระบบแล้วแต่โหลดครอบครัวไม่ได้",
        "ป้องกันการส่งล็อกอินซ้ำ แยกเวลาเครือข่าย Supabase ออกจากเวลาอ่านกล้อง และจำกัดเวลารอทั้งส่วนหัวและเนื้อหาคำตอบโดยไม่ส่งคำขอแก้ข้อมูลซ้ำอัตโนมัติ",
        "เตรียมตัวตรวจจับก่อนรับภาพ ใช้ตัวตรวจจับแยกตามกล้อง ล้างประวัติเมื่อเปลี่ยนแหล่งภาพหรือครอบครัว และจัดการการเริ่ม AI ไม่สำเร็จโดยไม่ปล่อยให้บริการ crash",
        "เริ่มประเมินได้เมื่อมีภาพท่าทางจริงอย่างน้อย 3 ภาพ เติมเฉพาะประวัติเริ่มต้นด้วยภาพแรกของ track ให้ครบหน้าต่างโมเดล 4 ภาพ เกณฑ์ confidence 0.56 และการยืนยันสองครั้งยังคงเดิม",
        "เพิ่มช่องทาง Android ส่งเหตุและภาพจากคิวส่วนตัวไป Supabase ขณะ React Native พัก ใช้ ID เดิมในการลองส่งซ้ำ และเก็บสถานะการตอบรับของ Expo แยกจากการแสดงแจ้งเตือนบนเครื่อง",
        "สิทธิ์ส่งเหตุผูกกับเครื่อง ผู้ใช้ และครอบครัว มีอายุ 30 วัน บนอุปกรณ์เข้ารหัสด้วย Android Keystore และไม่เก็บรหัสผ่านหรือ refresh token ในส่วนนี้ ระบบส่วนกลางเก็บเพียง hash ของสิทธิ์เครื่อง",
        "Logout หยุดการตรวจ ล้างสิทธิ์บนเครื่อง ขอถอนสิทธิ์ที่ระบบส่วนกลาง และล้างโทเคนรับแจ้งเตือนของบัญชี การถอนบนส่วนกลางยังต้องมีเครือข่าย",
        "แสดงความพร้อมแจ้งเตือนบนเครื่องแยกจากรับแจ้งจากเครื่องอื่น ไม่อ้างว่าลงทะเบียนสำเร็จเมื่อบันทึกโทเคนในโปรไฟล์ไม่ได้ และซ่อนรายละเอียดแจ้งเตือนบนหน้าจอล็อก",
    ])
    runtime = json.loads((workspace / "android/app/src/main/assets/monitoring/runtime.json").read_text())
    section("การเลือกวิธี AI", [
        "ทดลอง VIDEO tracking แล้วพบผลแย่กว่าตัวเลือกที่ใช้โมเดลเดิม จึงไม่ได้ใช้ VIDEO เป็นค่าตั้งต้นของ APK นี้",
        f"รุ่นสุดท้ายใช้ {runtime['poseRunningMode']} กับ MediaPipe Pose Lite และตัวจำแนกเดิม อ่านภาพทุก {runtime['frameIntervalMs']} ms สูงสุด {runtime['maxCameras']} กล้อง ข้ามเฟรมเมื่อประมวลผลไม่ทัน",
        "รอบนี้ปรับเส้นทางรับภาพและประวัติของโมเดล ไม่ได้ฝึกโมเดลใหม่ การระบุบุคคลจากรูปอ้างอิงยังไม่รองรับใน AI บนอุปกรณ์ จึงไม่เดาชื่อจากกล้องหรือกรอบ track",
        "ผลมีความไวต่อเฟรมที่อ่านได้จริงจากสตรีม โดยเฉพาะคลิปสั้นและคนถูกบัง ผลรายคลิปมาจากการรันรอบสุดท้ายครั้งเดียว ยังไม่ได้วัดอัตราการผ่านซ้ำหรือความเสถียรระยะยาว",
    ])
    section("ผลดับหน้าจอและความปลอดภัย", [
        "ผลทดสอบต่อไปนี้ตรวจทั้งเวลาเฟรมล่าสุด เหตุที่บันทึกจริง และ OS notification ไม่ถือว่าการมีข้อความ foreground service เพียงอย่างเดียวผ่าน",
        "เครื่องทดสอบเป็น Android Emulator API 36 ที่เสียบไฟ ผลนี้ไม่ครอบคลุม Deep Doze บนแบตเตอรี่ ความร้อน การจำกัดพื้นหลังของแต่ละยี่ห้อ หรือการทดสอบ 24 ชั่วโมง",
        "การทดสอบ 2 นาทีใช้ IMAGE กับช่วงอ่านภาพ 400 ms ระหว่างพัฒนา ส่วนการทดสอบ 10 นาทีใช้ค่ารุ่นสุดท้าย 300 ms ตัวจำแนกและเกณฑ์ยืนยันล้มเหมือนกัน",
    ])
    for name in ("image-screen-off-120000.log", "final-screen-off-600000.log", "final-credential-test.log"):
        path = root / name
        values = results(path)
        complete = path.exists() and "OK (1 test)" in path.read_text(encoding="utf-8-sig")
        if not complete or not values:
            raise RuntimeError(f"Required test did not pass: {name}")
        final = values[-1]
        if final.get("test") == "screen-off":
            summary = [f"ผ่าน: ปิดจอ {final['durationMs'] // 60000} นาที ตรวจ {final['checkpoints']} จุด ภาพวิเคราะห์ล่าสุดมีอายุ {final['analysisAgeMs']} ms สถานะกล้อง {final['state']} จอยังดับระหว่างตรวจ",
                       f"หลังเปลี่ยนเป็นคลิปล้ม บันทึกเหตุและตรวจพบ OS notification จริงภายใน {final['clipStartToAlertMs'] / 1000:.3f} วินาทีจากเริ่มคลิป"]
            if "unexpectedNormalEvents" in final:
                summary.append(f"จำนวนเหตุล้มผิดระหว่างคลิปปกติที่เล่นวน: {final['unexpectedNormalEvents']}")
        else:
            summary = ["ผ่าน: เขียน/อ่านสิทธิ์เครื่องได้ ไฟล์ที่เก็บไม่เปิดเผย token และข้อมูลครอบครัวในข้อความปกติ และอ่านสิทธิ์ไม่ได้หลังล้างออก"]
        section(name, summary + [json.dumps(final, ensure_ascii=False)])

    section("ข้อจำกัดจากหน้าจอ emulator", [
        "หลังจบรอบดับจอ พบหน้าต่าง Pixel Launcher และ System UI ไม่ตอบสนองค้างอยู่บนหน้าจอ Log ของ Android บันทึก ANR เหล่านี้ระหว่างเริ่ม emulator ก่อนรอบดับจอ 10 นาที ดู emulator-anr-events.log และภาพด้านล่าง",
        "เปิด MainActivity ของแอปและเห็นหน้าเข้าสู่ระบบใต้หน้าต่าง Android ได้ แต่หน้าต่างระบบขวางการเดินใช้งาน จึงยังไม่ถือว่ารอบนี้ผ่านการล็อกอินและการทดสอบหน้าจอเต็มเส้นทาง ผล native pipeline และ OS notification ที่รายงานด้านบนตรวจด้วย instrumentation แยกจากการกดหน้าจอ",
    ])
    for filename, caption in (
        ("current-app-screen.png", "หน้าต่าง Pixel Launcher ไม่ตอบสนองหลังจบรอบดับจอ"),
        ("app-launch.png", "เปิด LookLanCare แล้วเห็นหน้าเข้าสู่ระบบใต้หน้าต่าง Pixel Launcher"),
        ("login-screen.png", "หลังปิดเฉพาะ Launcher ในเครื่องทดสอบ ยังมีหน้าต่าง System UI ที่ค้างอยู่"),
    ):
        screenshot = root / "evidence/final-fix" / filename
        md.extend(["", f"![{caption}]({screenshot.as_posix()})", "", caption])
        encoded = base64.b64encode(screenshot.read_bytes()).decode()
        body.append(f"<figure><img src='data:image/png;base64,{encoded}' alt='{html.escape(caption)}'><figcaption>{html.escape(caption)}</figcaption></figure>")
    security = json.loads((root / "native-delivery-security.json").read_text())
    section("ระบบส่วนกลาง", [
        "ติดตั้ง native-camera-events และตารางสิทธิ์เครื่อง/การส่งเหตุแล้ว ตรวจ API จริง 7 กรณี: ปฏิเสธคำขอไม่มีสิทธิ์และ token ปลอม และปฏิเสธอ่านตารางภายในด้วยสิทธิ์ anonymous",
        "ตารางภายในเปิด RLS และไม่ให้ anonymous/authenticated อ่านหรือเขียน ใช้ได้เฉพาะบริการส่วนกลางที่ตรวจสมาชิกครอบครัวและกล้องก่อนทำรายการ ข้อสังเกต RLS ไม่มี policy ของสองตารางนี้เป็นการปิดการเข้าถึงโดยตั้งใจ",
        "Supabase Advisor ยังมีคำเตือนเดิมว่าการตรวจรหัสผ่านรั่วไหลไม่ได้เปิดใช้งาน รอบนี้ไม่ได้เปลี่ยนการตั้งค่านั้น ผลตรวจ API 7 กรณีจึงไม่ใช่การรับรองความปลอดภัยของแอปทั้งหมด",
        f"ตรวจคำขอเมื่อ {security['checkedAt']} ผล: {json.dumps(security['results'], ensure_ascii=False)}",
        "ยังไม่ผ่านการทดสอบบัญชีจริงสองครอบครัว การส่งภาพไปฐานข้อมูลด้วยบัญชีจริง และการรับแจ้งเตือนข้ามมือถือ ไม่มีการส่งแจ้งเตือนไปผู้ใช้จริงระหว่างรอบนี้",
    ])
    header = ["คลิป", "ป้ายกำกับ", "ผล AI", "เฟรม", "เริ่มแจ้งล้มจากเริ่มคลิป (ms)", "AI median (ms)"]
    rows = [[case["id"], case["label"], "ล้ม" if case["predictedFall"] else "ไม่แจ้งล้ม", str(case["frames"]),
             str(case["firstFallMs"] or "—"), str(case["inferenceMedianMs"])] for case in clips]
    section("ผลรายคลิปและภาพ", ["firstFallMs วัดจากเริ่มเล่นคลิป ไม่ใช่เวลาจากจุดเริ่มล้ม ภาพประกอบเป็นเฟรมที่ถอดจริงจาก HLS ไม่ใช่ screenshot หน้าจอแอป"])
    md.extend(["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * len(header)) + " |"] + ["| " + " | ".join(row) + " |" for row in rows])
    body.append("<table><thead><tr>" + "".join(f"<th>{html.escape(cell)}</th>" for cell in header) + "</tr></thead><tbody>" +
                "".join("<tr>" + "".join(f"<td>{html.escape(cell)}</td>" for cell in row) + "</tr>" for row in rows) + "</tbody></table>")
    metadata = {case["id"]: case["sourceMetadata"] for case in json.loads((root / "media/cases.json").read_text())}
    for case in clips:
        image = root / "evidence/final-fix" / f"pipeline-{case['id']}.jpg"
        attribution = json.dumps(metadata[case["id"]], ensure_ascii=False)
        md.extend(["", f"### {case['id']}", "", attribution, "", f"![{case['id']}]({image.as_posix()})"])
        encoded = base64.b64encode(image.read_bytes()).decode()
        body.append(f"<figure><h3>{html.escape(case['id'])}</h3><img src='data:image/jpeg;base64,{encoded}' alt='{html.escape(case['id'])}'><figcaption>{html.escape(attribution)}</figcaption></figure>")
    apk = args.apk.resolve()
    section("ไฟล์ติดตั้งและตรวจสอบ", [
        f"APK {apk.as_posix()} · version {version} · package com.looklancare.app · ARM64 · {apk.stat().st_size/1024/1024:.2f} MiB",
        f"SHA256: {hashlib.sha256(apk.read_bytes()).hexdigest()}",
        "ตรวจ TypeScript และ ESLint ผ่าน ชุด JavaScript 16 รายการและ JVM 4 รายการผ่าน native encrypted credential test ผ่าน ตรวจ asset โมเดล/ค่าตั้ง 5 ไฟล์ตรงกับ source และ native libraries 28 ไฟล์รองรับการจัดแนว 16 KB ตรวจลายเซ็น APK และ ZIP alignment ผ่าน ดู log และ apk-fix-verification.json ในโฟลเดอร์หลักฐาน",
        "APK เป็นแอป Android ติดตั้งได้โดยตรง ฟีเจอร์ native นี้ใช้กับ Expo Go ไม่ได้",
        "สิ่งที่ต้องทำต่อ: ส่ง google-services.json และตั้งค่า FCM V1 ใน EAS ทดสอบล็อกอินและแจ้งเตือนบนมือถือจริง และปรับโมเดลจากข้อมูลที่มีเวลาเหตุและบุคคล/ห้องแยกสำหรับทดสอบก่อนกล่าวอ้างความแม่นยำ",
    ])
    final_state_path = root / "fix-final-state.json"
    if final_state_path.exists():
        final_state = json.loads(final_state_path.read_text(encoding="utf-8"))
        section("หลังจบการทดสอบ", [
            "ปิด emulator กล้องจำลอง และตัวเข้ารหัสวิดีโอที่เริ่มสำหรับรอบนี้แล้ว ตรวจว่าไม่มีบริการดังกล่าวเหลืออยู่ โปรแกรมอื่นของผู้ใช้ไม่ได้ถูกปิด",
            f"ระบบส่วนกลางยังเปิดใช้งาน: {final_state['backendStatus']} ตรวจเมื่อ {final_state['checkedAt']} ดู fix-final-state.json",
        ])
    (workspace / "ANDROID_FIXES_REPORT_TH.md").write_text("\n".join(md), encoding="utf-8")
    document = ("<!doctype html><html lang='th'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        f"<title>{html.escape(title)}</title>" +
        "<style>body{font:18px/1.65 system-ui,sans-serif;max-width:1050px;margin:30px auto;padding:0 20px;color:#173327}h1,h2{line-height:1.3}section{margin:28px 0}table{border-collapse:collapse;width:100%;font-size:15px}td,th{border:1px solid #cbd5d1;padding:8px;text-align:left}figure{margin:24px 0;padding:16px;background:#f3f7f4;border-radius:14px}img{max-width:100%;height:auto}figcaption{font-size:13px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}</style><body>" + "".join(body) + "</body></html>")
    (root / "FIXES_REPORT_TH.html").write_text(document, encoding="utf-8")
    print(json.dumps({"clips": len(clips), "detectedFalls": tp, "falseAlerts": fp, "embeddedImages": len(clips) + 3}))


if __name__ == "__main__":
    main()
