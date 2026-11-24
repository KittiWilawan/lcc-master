"""Render the continuity experiment, including failed candidates, from saved evidence."""
import argparse
import json
import statistics
from pathlib import Path
from report_ai_improvement import Report, percent


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    root, project = args.root.resolve(), args.project.resolve()
    decision = read(root / "decision.json")
    comparison = read(root / decision["comparison"])
    candidate = comparison["candidate"]
    reg, older = comparison["suites"]["baseline"], comparison["suites"]["additional"]
    report = Report()
    report.heading("รายงานปรับการหาท่าทางและติดตามคน — LookLanCare", 1)
    report.paragraph("วันที่ 7 ตุลาคม 2026 · ทดสอบ Android release บน emulator x86_64 แยกและซ่อนหน้าต่าง ใช้ HLS ที่สร้างจากคลิปติดป้ายกำกับ ผ่าน CameraStreamSession และ LocalPoseAnalyzer จริง ใช้ข้อมูลทดสอบ ไม่มีบัญชีครอบครัวจริงและไม่มีการเรียกผู้ให้บริการ AI ภายนอก")
    report.heading("1. ผลการตัดสินใจ")
    report.paragraph(decision["summary"])
    report.paragraph(decision["reason"])
    report.heading("2. สิ่งที่ปรับและขอบเขต")
    report.table(["ส่วน", "รายละเอียด"], [
        ["ท่าทางซ้ำ", "ลด skeleton ซ้ำเมื่อทั้งกรอบซ้อนและข้อต่อที่มองเห็นตรงกัน ไม่ลบคนเพียงเพราะกรอบซ้อนกัน"],
        ["ติดตาม", "เสริมเรขาคณิตและการเคลื่อนที่ด้วย histogram สีเสื้อ เก็บในหน่วยความจำเฉพาะ track ไม่บันทึกเป็นข้อมูลยืนยันตัวบุคคล"],
        ["ค้นหาเมื่อ pose หาย", "ทดลอง ROI/ภาพหมุนแล้วพบการแจ้งคนที่ยังนั่งและคนอื่นในภาพ จึงปิด poseRecoveryEnabled ใน APK ที่ส่งมอบ เก็บโค้ดและผลที่ล้มเหลวสำหรับศึกษาต่อ"],
        ["การยืนยัน", "ยังใช้ภาพใหม่จริงอย่างน้อย 2 ผลบวกต่อเนื่อง ภาพหายหรือการคาดตำแหน่งอย่างเดียวสร้างเหตุไม่ได้"],
        ["โมเดล", "คง fall classifier และ MediaPipe Lite ของ 1.0.6 ไม่ได้ fit classifier หรือฝึก neural network เพิ่มในรอบนี้ ไม่ลด threshold จากคลิปทดสอบ"],
        ["การส่งมอบ", decision.get("deliveryScope", "ดูการตัดสินใจข้างต้น")]])
    report.paragraph("การติดตาม track ไม่ได้ยืนยันชื่อหรือใบหน้า สีเสื้อคล้ายกัน แสงเปลี่ยน การบังเต็มตัว และคนตัดผ่านกันยังทำให้สับสนได้ ผลรอบนี้ครอบคลุมเส้นทาง HLS บน Android ไม่ได้ทดสอบทุกชนิดกล้องหรือ provider ของเส้นทางอื่น")
    report.link("แผนและเกณฑ์ที่บันทึกก่อนอ่านผลรุ่นทดลอง", root / "protocol.json")
    if decision.get("recoveryRejectedAfterImageReview"):
        rejected = read(root / "comparison.json")
        report.heading("การทดลองที่ไม่เลือกใช้: ค้นหาจากภาพหมุน/ROI")
        report.paragraph("รอบแรกให้ผลล้ม 24/26 regression และ 20/28 คลิปผู้สูงอายุ แต่เมื่อตรวจภาพแรกที่แจ้งพบคนยังนั่งอยู่ใน elderly-06/16 และกรอบไปอยู่คนอื่นใน elderly-28 จึงไม่ถือว่า 20/28 เป็นการตรวจล้มผู้สูงอายุได้ถูกต้อง และไม่เปิดฟีเจอร์นี้ใน APK ส่งมอบ")
        report.paragraph("ผ่านเกณฑ์จำนวนคลิปไม่ใช่หลักฐานว่าแจ้งถูก actor หรือถูกเวลา ตัวจำแนกที่ฝึกด้วยภาพเต็มไม่ได้มี validation ของ pose จากภาพหมุน/ROI ในคนที่นั่งหรือถูกบัง จึงต้องมีข้อมูลกำกับและ normal ของบริบทนี้ก่อนเปิดใช้งาน ข้อความเรื่องการกระจายข้อมูลนี้เป็นข้อสันนิษฐานจากผลที่พบ ยังไม่ได้พิสูจน์สาเหตุด้วยการฝึกทดลองใหม่")
        report.link("ผลการทดลองที่ปฏิเสธ", root / "comparison.json")
        report.link("ผลตรวจภาพและกรอบ", root / "recovery-image-review.json")
        for key in ("elderly-06", "elderly-16", "elderly-28"):
            report.link("ภาพแจ้งผิด/actor ที่ต้องตรวจสอบ — " + key, root / f"candidate/additional-01/pipeline-{key}-fall.jpg")
        report.link("แผนรุ่นที่ปิด recovery", root / "tracking-protocol.json")
    report.heading("3. ผลเทียบ 52 คลิปเดิมแบบจับคู่")
    report.table(["รุ่น", "พบล้ม / 26", "พลาดล้ม", "แจ้งผิด / 26", "ปกติถูก", "Accuracy", "Recall ล้ม"], [
        [name, f"{item['counts']['tp']}/26", item["counts"]["fn"], f"{item['counts']['fp']}/26", item["counts"]["tn"],
            percent(item["counts"]["accuracy"]), percent(item["counts"]["recall"])]
        for name, item in (("APK 1.0.6 ทดสอบใหม่", reg["baseline"]), (candidate, reg["candidate"]))])
    report.paragraph(f"กรณีเปลี่ยนจากผิดเป็นถูก: {', '.join(reg['improvedIds']) or 'ไม่มี'}; จากถูกเป็นผิด: {', '.join(reg['lostIds']) or 'ไม่มี'}")
    report.paragraph("ชุดนี้เป็น regression ที่เคยใช้วิเคราะห์ระบบ ไม่ใช่ชุดใหม่ที่ปิดบังผลเพื่อรับรองความแม่นยำภาคสนาม การรับภาพจริงสุ่มตามเวลาและอาจเปลี่ยนเฟรมที่ได้ ตัวอย่าง baseline 1.0.6 ในงานก่อนหน้าเคยพบ 22/26 แต่การทดสอบใหม่รอบนี้พบ 23/26 จึงใช้ baseline รอบนี้ในการเปรียบเทียบ")
    report.heading("4. คลิปบ้านพักผู้สูงอายุ 28 คลิป")
    report.table(["รุ่น", "คลิปที่ให้ผลว่าล้ม", "คลิปไม่ให้ผลว่าล้ม", "เฟรมที่วิเคราะห์", "เฟรมไม่พบ pose"], [
        [name, f"{item['counts']['tp']}/28", item["counts"]["fn"], item["frames"], item["noPoseFrames"]]
        for name, item in (("APK 1.0.6", older["baseline"]), (candidate, older["candidate"]))])
    report.paragraph(f"คลิปที่เพิ่มผลล้ม: {', '.join(older['improvedIds']) or 'ไม่มี'}; คลิปที่เสียผลเดิม: {', '.join(older['lostIds']) or 'ไม่มี'}")
    report.paragraph("ตัวเลขในส่วนนี้เป็นความครอบคลุมเหตุระดับคลิปเท่านั้น ชุดนี้ติดป้าย fall ทั้งหมด ไม่มีคลิป normal ผู้สูงอายุ ไม่มีเวลาเริ่มล้มและไม่มีคำตอบกำกับว่าคนใดล้ม บางคลิปมีผู้ดูแลเดินผ่านหรือก้มอยู่ด้วย การได้ผลล้มจากคนผิดหรือก่อนเหตุยังอาจถูกนับเป็นคลิปที่พบ จึงไม่ใช้ตัวเลขนี้เป็น accuracy/recall การล้มของผู้สูงอายุ ไม่สรุปว่าแจ้งผิดเป็นศูนย์ และไม่รวมกับ 52 คลิปเพื่อทำคะแนนให้สูงขึ้น")
    report.paragraph("ตรวจภาพเหตุของรุ่นที่ปิด recovery ยังพบ elderly-05 และ elderly-24 เป็นภาพคนที่ยังนั่งอยู่ โดยไม่มีคนล้มให้เห็นในกรอบที่แจ้ง เป็นข้อผิดพลาดของตัวจำแนกเดิมที่ยังต้องแก้ ไม่ถือว่า 13 คลิปนี้คือการล้ม 13 เหตุที่ยืนยันแล้ว elderly-14 เป็นช่วงเปลี่ยนท่าที่ต้องมี onset annotation ก่อนตัดสิน")
    report.link("ผลตรวจภาพของรุ่นปิด recovery", root / "tracking-image-review.json")
    for key in ("elderly-05", "elderly-24"):
        report.link("ตัวอย่างภาพที่ต้องตรวจเหตุ — " + key, root / f"tracking-only/additional-01/pipeline-{key}-fall.jpg")
    report.paragraph("แหล่งคลิป: Databrary long-term-care falls DOI 10.17910/B7.739; regression ใช้ Figshare DOI 10.6084/m9.figshare.28596332.v2, GMDCSA24 DOI 10.5281/zenodo.12921216 และ FallVision DOI 10.7910/DVN/75QPKK ตาม manifests ที่เก็บไว้ Source SHA256 อยู่ใน cases.json ไม่ฝึกหรือเลือก threshold ด้วยคลิปชุดนี้")
    report.heading("5. เวลาและความต่อเนื่องที่วัดจริง")
    report.table(["ชุด / รุ่น", "เฟรม", "median ของ clip medians (ms)", "frame p95 (ms)", "frame max (ms)", "เฟรมเกินงบ", "งาน recovery", "เฟรมได้ pose จาก recovery เท่านั้น"], [
        [f"{suite_name} / {name}", item["frames"], item["clipMedianMs"], item["frameP95Ms"] if item["frameP95Ms"] is not None else "ไม่ได้เก็บ",
            item["frameMaxMs"] if item["frameMaxMs"] is not None else "ไม่ได้เก็บ", item["overBudgetFrames"] if item["overBudgetFrames"] is not None else "ไม่ได้เก็บ",
            item["recoveryInferences"] if name == candidate else "ไม่มี", item["recoveredOnlyFrames"] if name == candidate else "ไม่มี"]
        for suite_name, suite in (("52 regression", reg), ("28 ผู้สูงอายุ", older))
        for name, item in (("1.0.6", suite["baseline"]), (candidate, suite["candidate"]))])
    rows = reg["candidate"]["rows"] + older["candidate"]["rows"]
    alerts = [row["firstFallMs"] for row in reg["candidate"]["rows"] if row["label"] == "fall" and row["firstFallMs"] is not None]
    if alerts:
        report.paragraph(f"52 regression เฉพาะคลิปล้มที่พบ: median เวลาเริ่มเล่นคลิปถึงผลแรก {statistics.median(alerts):.0f} ms ช่วง {min(alerts)}–{max(alerts)} ms เวลาเหล่านี้รวมการเริ่มรับภาพและไม่ใช่ latency จากเวลาเริ่มล้ม เพราะไม่มี onset annotation")
    report.paragraph(f"งบ inference ตาม runtime = {comparison['budgetMs']} ms ภาพที่ใช้ค้นหาซ้ำเป็นงานจริงและอาจทำให้บางเฟรมช้าขึ้น ระบบตรวจอายุผลและเตือนเมื่อช้า ไม่มีการจำลองภาพหายให้เป็นหลักฐานล้ม ทั้งสองรุ่นถูกเล่นบนเครื่องเดียวกันช่วงที่ไม่มีการฝึกหรือสร้าง APK แข่งขัน CPU")
    report.heading("6. เกณฑ์และความเสถียร")
    report.table(["เกณฑ์", "ผล"], [[key, "ผ่าน" if value else "ไม่ผ่าน"] for key, value in comparison["gates"].items()])
    report.paragraph("เกณฑ์เวลาตรวจ median ของแต่ละคลิป ไม่เลือกเฉพาะเฟรมเร็ว ในการทดลอง recovery ที่ไม่เลือกใช้ extra-06-fall มี median 767 ms แม้ไม่ได้ใช้ recovery ในเฟรมที่ช้า ผลซ้ำที่กลับมาเร็วไม่ลบผลช้ารอบแรก สาเหตุของเวลาที่พุ่งยังระบุไม่ได้แน่นอน; median รวมต่ำกว่า 600 ms ไม่ถือว่าไม่มีเฟรมล่าช้า")
    repeat_root = root / decision.get("repeatFolder", "repeats")
    repeats = [read(path) for path in sorted(repeat_root.glob("baseline-*/results.json"))]
    if repeats:
        report.table(["รอบ / จำนวนคลิป", "พบล้ม", "แจ้งผิด", "เฟรม", "พลาด"], [
            [f"{index + 1} / {len(items)}", f"{sum(row['predictedFall'] for row in items if row['label'] == 'fall')}/{sum(row['label'] == 'fall' for row in items)}",
                f"{sum(row['predictedFall'] for row in items if row['label'] == 'normal')}/{sum(row['label'] == 'normal' for row in items)}", sum(row["frames"] for row in items),
                ", ".join(row["id"] for row in items if row["label"] == "fall" and not row["predictedFall"]) or "ไม่มี"]
            for index, items in enumerate(repeats)])
        varying = [row["id"] for row in repeats[0] if len({next(item["predictedFall"] for item in run if item["id"] == row["id"]) for run in repeats}) > 1]
        report.paragraph(f"คลิปที่ผลเปลี่ยนข้ามรอบซ้ำ: {', '.join(varying) or 'ไม่มี'} การทดสอบซ้ำชุดเล็กตรวจจังหวะ decoder เท่านั้น ไม่ใช่หลักฐานการติดตามคนถูกทุกฉาก")
        report.link("เหตุผลเลือกชุดทดสอบซ้ำและกรณีเพิ่มหลังพบปัญหา", root / "repeat-protocol.json")
    screen_path = root / decision.get("screenFolder", "screen-off") / "pipeline-screen-off-120000-result.json"
    if screen_path.exists():
        screen = read(screen_path)
        report.table(["ดับจอ release 2 นาที", "ผล"], [[key, screen.get(key)] for key in
            ("screenInteractive", "checkpoints", "analysisAgeMs", "unexpectedNormalEvents", "fallAlertAfterScreenOff", "clipStartToAlertMs")])
        report.paragraph("ตรวจ timestamp การวิเคราะห์ คิวเหตุ และ OS notification หลังดับจอจริง ไม่ใช้ข้อความ foreground service เป็นหลักฐานเพียงอย่างเดียว เป็น emulator ที่เสียบไฟ ไม่รับรอง deep doze การฆ่าแอปของผู้ผลิต หรือ push ไปมือถือเพื่อน")
        report.image("เฟรมที่บันทึกเป็นเหตุหลังดับจอ — config ของ APK ส่งมอบ", screen_path.parent / "event-evidence.jpg")
    report.table(["การตรวจประกอบ", "ผล"], [[key, value] for key, value in decision.get("checks", {}).items()])
    report.heading("7. ปัญหาที่ยังพบและทำซ้ำได้")
    faults = [["สูง" if row["label"] == "fall" else "กลาง", row["id"], row["label"],
        "พลาดล้ม" if row["label"] == "fall" else "แจ้งผิด", row["frames"]]
        for row in reg["candidate"]["rows"] if row["predictedFall"] != (row["label"] == "fall")]
    report.table(["ระดับ", "กรณี", "คำตอบระดับคลิป", "ผลจริง", "เฟรม"], faults)
    report.paragraph("ทำซ้ำ: ใช้ gateway.json กับ cases ของชุดที่ต้องการ ติดตั้ง APK ทดสอบและ test APK บน emulator แยก เรียก run_android_ai_audit.py ด้วย run-plan.json และ output ใหม่ เทียบ predictedFall กับ label ดู trace และภาพเหตุประกอบ ทุกรอบต้องเก็บผลใหม่เพราะจังหวะภาพมีผล")
    report.paragraph("งานที่ยังต้องทำก่อนอ้างผลทั่วไป ≥95%: กำกับ actor และเวลาเริ่มล้ม เพิ่ม normal ผู้สูงอายุที่นั่ง/นอน/ก้ม ทดสอบแสงน้อยและหลายคนจากแหล่งที่ไม่เคยใช้ปรับระบบ วัดการแจ้งผิดต่อชั่วโมง ระบุผู้ล้มให้ถูก ทดสอบแบตเตอรี่และดับจอบนมือถือจริง ไม่ใช้คะแนน model confidence แทนความแม่นยำ")
    report.paragraph("ข้อผิดพลาดท่านั่งในภาพผู้สูงอายุจัดเป็นความรุนแรงสูงสำหรับการอ้างความพร้อมเฝ้าระวังจริง การปรับการติดตามและลด skeleton ซ้ำไม่ได้แก้การแยกท่านั่งออกจากการล้ม รุ่นนี้จึงเป็นต้นแบบสำหรับศึกษาและนำเสนอ ต้องมีการฝึกจากข้อมูลที่มีคำตอบระดับคน/เวลาและทดสอบใหม่ก่อนยืนยันคุณภาพ AI")
    report.paragraph("ในการทดลอง recovery ที่ปฏิเสธ 05-fall มีคนเสื้อแดงนอนบนพื้นขณะมีคนอื่นยืนอยู่ บางเฟรมให้กรอบท่าทางซ้อนของคนนอนมากกว่าหนึ่งกรอบ การลด skeleton ซ้ำยังไม่ครอบคลุม pose ที่เห็นเพียงบางส่วน ผลว่าล้มเกิดในรอบหลักแต่ไม่เกิดในทั้งสามรอบซ้ำ จึงไม่ใช้ผลสำเร็จรอบเดียวรับรองการติดตามบุคคล")
    report.heading("8. ไฟล์และหลักฐาน")
    for title, path in (("ผลเทียบพร้อมเวลารายเฟรม", root / decision["comparison"]), ("ผลจับคู่ CSV", (root / decision["comparison"]).with_suffix(".csv")),
            ("คลิป regression และ SHA", root / "regression-cases.json"), ("คลิปผู้สูงอายุและ SHA", root / "elderly-cases.json")):
        report.link(title, path)
    if decision.get("apk"):
        report.link("APK สำหรับมือถือ ARM64", Path(decision["apk"]))
    verification = root / "arm64-verification.json"
    if verification.exists():
        apk = read(verification)
        report.paragraph(f"APK: SHA256 {apk['apkSha256']} · {apk['bytes'] / 1048576:.1f} MiB · assets 5 ไฟล์ตรงกับ candidate · ELF {len(apk['libraries'])} ไฟล์รองรับ 16 KB ตรวจลายเซ็นและ ZIP alignment แยกในหลักฐานส่งมอบ")
        report.link("ผลตรวจ APK", verification)
    cleanup = root / "cleanup.json"
    if cleanup.exists():
        report.link("การปิดบริการทดสอบของรอบนี้", cleanup)
    report.paragraph("HTML รวมภาพแรกและภาพแรกที่ระบบให้ผลล้มของทุกกรณีที่เกี่ยวข้องไว้ครบ ภาพเหล่านี้เป็นเฟรมจาก decoder ที่ AI ใช้ ไม่ใช่ภาพหน้าจอการใช้งาน UI รายงานนี้ไม่กำกับชื่อหรือเดาอายุ/เพศของคนในภาพ เครดิตและต้นทางอยู่ใน manifests และ DOI ข้างต้น")
    for kind, suite in (("baseline", reg), ("additional", older)):
        report.heading("52 regression: ภาพและผลรายกรณี" if kind == "baseline" else "28 คลิปผู้สูงอายุ: ผลและภาพหลักฐาน")
        for first in suite["baseline"]["rows"]:
            second = next(row for row in suite["candidate"]["rows"] if row["id"] == first["id"])
            report.heading(f"{first['id']} · label={first['label']} · เดิม={first['predictedFall']} · ทดลอง={second['predictedFall']}", 3)
            for folder, row in (("baseline", first), (candidate, second)):
                evidence = root / folder / f"{kind}-01"
                report.link(folder + " trace", evidence / f"pipeline-{row['id']}-trace.json")
                pictures = [evidence / f"pipeline-{row['id']}.jpg"]
                if row["predictedFall"]:
                    pictures.append(evidence / f"pipeline-{row['id']}-fall.jpg")
                for picture in pictures:
                    report.image(folder + " · " + picture.stem, picture)
    report.save(project / "AI_CONTINUITY_REPORT_TH.md", root / "REPORT_TH.html")
    print(json.dumps({"embeddedImages": report.images, "selectedCandidateClipAttempts": sum(item["frames"] > 0 for item in rows), "report": str(root / "REPORT_TH.html")}))


if __name__ == "__main__":
    main()
