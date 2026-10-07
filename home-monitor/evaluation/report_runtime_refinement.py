"""Report a frozen refinement comparison without hiding failed release gates."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

from report_ai_improvement import Report, percent


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def prediction(result):
    return bool(result["tp"] + result["fp"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = read(args.config)
    root = Path(config["root"])
    selection = read(root / "model-selection.json")
    evaluation = read(root / "evaluation.json")
    coverage = read(root / "elderly-coverage.json")
    unique_summary = read(root / "unique-clip-summary.json")
    deployment = read(root / "deployment.json")
    reports = [(Path(path).stem, read(Path(read(path)["output"]) / "training-results.json"))
               for path in read(root / "profiles.json")]
    models_fit = sum(len(item["validationCandidates"]) for _, item in reports)
    runtime = read(evaluation["config"]["runtimeAsset"])
    confirmations = runtime["confirmations"]
    current, candidate = evaluation["results"]["current"], evaluation["results"]["candidate"]
    report = Report()
    report.heading(config["title"], 1)
    report.paragraph(config["date"] + " · ฝึกตัวจำแนกการล้มเพิ่มเติมจากท่าทางที่สกัดด้วย MediaPipe Lite ของ APK จริง ผลนี้เป็นการทดลองต้นแบบธีสิส ไม่รับรองความแม่นยำทั่วไป 95–100%")
    report.heading("1. ผลสรุปและโมเดลที่ใช้งาน")
    report.paragraph(deployment["summary"])
    report.paragraph("เกณฑ์ก่อนเปลี่ยนโมเดลกำหนดก่อนเปิดผล regression: ต้องเลือกโมเดลใหม่จาก validation, recall และ accuracy ไม่ลดลง, แจ้งผิดไม่เพิ่ม และ recall ใน challenge ผู้สูงอายุไม่ลดลง หลังผ่านเกณฑ์ offline ยังต้องเทียบผ่าน Android HLS จริง")
    gate_labels = {"newModelSelected": "เลือกโมเดลใหม่จาก validation", "recallDoesNotRegress": "การพบล้มไม่ลดลง",
        "falseAlertsDoNotIncrease": "จำนวนการแจ้งผิดไม่เพิ่ม", "accuracyDoesNotRegress": "คะแนนรวมไม่ลดลง",
        "elderlyRecallDoesNotRegress": "การพบเหตุในคลิปผู้สูงอายุไม่ลดลง"}
    report.table(["เกณฑ์ offline", "ผล"], [[gate_labels[name], "ผ่าน" if value else "ไม่ผ่าน"]
        for name, value in evaluation["offlineReleaseGate"].items()])
    report.paragraph(deployment["androidStatus"])
    report.link("เกณฑ์ที่บันทึกก่อนประเมิน", root / "protocol.json")
    report.link("โมเดลและ SHA ที่แช่แข็งก่อนประเมิน", root / "model-selection.json")
    report.heading("2. สิ่งที่ฝึกจริง")
    first = reports[0][1]
    report.table(["รายการ", "จำนวน/วิธี"], [
        ["รายการ train / validation / regression", " / ".join(str(first["partitionClips"][key]) for key in ("train", "validation", "test"))],
        ["วิดีโอไม่ซ้ำ train / validation / regression", " / ".join(str(unique_summary["partitionCounts"][key]["uniqueVideos"]) for key in ("train", "validation", "test"))],
        ["หน้าต่างฝึกก่อน / หลังเพิ่มมุมภาพ", f"{first['canonicalWindows']:,} / {first['features'][0]:,}"],
        ["คลิป train ที่สร้างหน้าต่างเข้าเกณฑ์", f"{first['eligibleTrainingClips']:,} / {first['partitionClips']['train']:,}"],
        ["features ต่อหน้าต่าง", first["features"][1]],
        ["โมเดลใหม่ที่ fit", models_fit],
        ["โมเดลสำหรับ mining ภายใน train", len(read(root / "training-fold-scores.json"))],
        ["ข้อมูลฝึกเสริมจากคลิปผู้สูงอายุ challenge", "ไม่มี: กันไว้ตรวจผลเพิ่มเติม"],
        ["การเพิ่มมุมภาพ", "ต้นฉบับ, กลับซ้าย/ขวา, จำลองระยะและตำแหน่งกล้อง, กลับซ้าย/ขวาพร้อมจำลองกล้อง"],
        ["การเน้นตัวอย่างยาก", "ให้คะแนนผู้เข้าร่วม train ที่กันออกจากแต่ละ fold แล้วเพิ่มน้ำหนักกรณีสับสน; ไม่ใช้ข้อผิดพลาด test"],
        ["การถ่วงน้ำหนัก", "สมดุลต่อคลิปและแหล่งข้อมูล ป้องกันคลิปยาวมีน้ำหนักมากเพียงเพราะมีหน้าต่างมาก"],
        ["ตัวหาจุดข้อต่อ", "MediaPipe Lite เดิม ไม่ได้ฝึก neural network หาท่าทางใหม่"]])
    report.paragraph("ตัวอย่างมุมภาพเพิ่มจาก features เป็นข้อมูลสังเคราะห์จากคลิปเดิม ไม่ใช่คลิปใหม่ และไม่จำลองแสง การบังตัว หรือความผิดพลาดของตัวหา pose จากภาพจริง ป้ายกำกับล้มเป็นระดับวิดีโอ ใช้หน้าต่างช่วงท้ายตาม configuration จึงยังไม่มีป้ายกำกับเวลาเริ่มล้มและตัวบุคคลที่ล้ม")
    report.paragraph("แยกผู้เข้าร่วมและ SHA ของวิดีโอระหว่าง train / validation / regression ตรวจความซ้ำก่อน fit ทุกโปรไฟล์ ใช้ validation เดียวกันในการเลือก threshold และโมเดล รวมโมเดล APK ปัจจุบันเป็นตัวเลือกด้วย ชุด regression เคยถูกตรวจในงานก่อนหน้า จึงไม่เรียก blind test")
    report.paragraph("แหล่งข้อมูลฝึกตาม manifests ในเครื่อง: Figshare DOI 10.6084/m9.figshare.28596332.v2 และ GMDCSA24 DOI 10.5281/zenodo.12921216; challenge ผู้สูงอายุจาก Databrary DOI 10.17910/B7.739 ใช้สำหรับตรวจเพิ่มเติมในรอบนี้ ไม่รวมเป็นข้อมูลฝึก และไม่ฝังวิดีโอผู้สูงอายุลงใน APK หรือรายงาน")
    report.link("หลักฐานแบ่งกลุ่ม mining", root / "training-fold-scores.json")
    report.link("การสกัดท่าทางผู้สูงอายุ", root / "elderly-extraction-provenance.json")
    report.heading("3. ผล validation ใช้เลือกโมเดลเท่านั้น")
    rows = []
    for profile, item in reports:
        for name, result in item["validationCandidates"].items():
            metric = result["metrics"]["combined"]
            source_floor = min(min(value["recall"], value["specificity"])
                for source, value in result["metrics"].items() if source != "combined")
            rows.append([profile, name, result["threshold"], percent(metric["accuracy"]),
                percent(metric["recall"]), metric["fp"], metric["fn"], percent(source_floor),
                f"{result['estimatedNativeBytes']:,}", "ผ่าน" if result["fitsMobileBudget"] else "เกินงบ"])
    report.table(["โปรไฟล์", "โมเดล", "Threshold", "Accuracy", "Recall", "FP", "FN", "ค่าต่ำสุดรายแหล่ง", "ขนาด bytes", "งบมือถือ"], rows)
    report.paragraph("เลือกจากค่าต่ำสุดของ recall/specificity รายแหล่งก่อน แล้วพิจารณา F1 รวมและ specificity รวม ไม่ได้เลือกจาก accuracy รวมเพียงอย่างเดียว")
    report.table(["โมเดลในการเลือกสุดท้าย", "Accuracy", "Recall", "FP", "FN", "Threshold"],
        [[Path(item["config"]).stem + ": " + item["name"], percent(item["validation"]["combined"]["accuracy"]),
          percent(item["validation"]["combined"]["recall"]), item["validation"]["combined"]["fp"],
          item["validation"]["combined"]["fn"], item["threshold"]] for item in selection["profiles"]])
    report.paragraph("ผู้ชนะ validation: " + str(selection["selected"]["model"]) + " · SHA256 " + selection["selected"]["sha256"])
    report.heading("4. ชุด regression ที่กันออกจากการ fit")
    rows = []
    for label, results in (("APK ปัจจุบัน", current), ("โมเดลที่เลือกใหม่", candidate)):
        for source, metric in results["regression499"].items():
            rows.append([label, source, metric["clips"], metric["tp"], metric["tn"], metric["fp"], metric["fn"],
                percent(metric["accuracy"]), percent(metric["recall"]), percent(metric["specificity"])])
    report.table(["โมเดล", "แหล่ง", "คลิป", "TP", "TN", "FP", "FN", "Accuracy", "Recall ล้ม", "Specificity"], rows)
    report.paragraph("TP=พบล้ม, TN=ไม่แจ้งในคลิปปกติ, FP=แจ้งผิดในคลิปปกติ, FN=พลาดคลิปล้ม ตารางนี้ประเมินจากหน้าต่างท่าทางที่สกัดไว้ ผลผ่าน decoder และ track หลายคนบน Android ต้องวัดแยก ไม่ปรับโมเดลหรือ threshold หลังดูผลตารางนี้")
    report.paragraph("พบสำเนาวิดีโอล้ม 1 รายการใน regression ภายใน partition เดียวกัน ป้ายกำกับและผลของทั้งสองโมเดลตรงกัน จึงมี 499 รายการแต่ 498 วิดีโอไม่ซ้ำ ไม่มีคลิปซ้ำใน train หรือ validation และไม่มี SHA ซ้ำข้าม partition ตารางด้านล่างนับ SHA แต่ละค่าเพียงครั้งเดียว ไม่เปลี่ยนโมเดลหรือ threshold ผลตัดสินคงรุ่นเดิมเหมือนเดิม")
    report.table(["โมเดล — นับวิดีโอไม่ซ้ำ", "คลิป", "TP", "TN", "FP", "FN", "Accuracy", "Recall ล้ม"],
        [[name, item["combined"]["clips"], item["combined"]["tp"], item["combined"]["tn"],
          item["combined"]["fp"], item["combined"]["fn"], percent(item["combined"]["accuracy"]), percent(item["combined"]["recall"])]
         for name, item in (("ปัจจุบัน", unique_summary["regressionUnique"]["current"]),
                            ("ทดลอง", unique_summary["regressionUnique"]["candidate"]))])
    report.link("ผลนับวิดีโอไม่ซ้ำและหลักฐานสำเนา", root / "unique-clip-summary.json")
    current_cases = {item["sha256"]: item for item in current["regressionCases"]}
    changes = []
    with (root / "regression-cases.csv").open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["sha256", "dataset", "subject_id", "video_path", "label", "current_predicted_fall", "candidate_predicted_fall"])
        for item in candidate["regressionCases"]:
            old = current_cases[item["sha256"]]
            case = item["case"]
            old_fall, new_fall = prediction(old["result"]), prediction(item["result"])
            writer.writerow([item["sha256"], case["dataset"], case["subject_id"], case["video_path"], case["label"], old_fall, new_fall])
            if old_fall != new_fall:
                changes.append([case["dataset"], Path(case["video_path"]).name, case["label"],
                    "แจ้งล้ม" if old_fall else "ไม่แจ้ง", "แจ้งล้ม" if new_fall else "ไม่แจ้ง"])
    report.table(["แหล่ง", "คลิปที่ผลเปลี่ยน", "ป้ายกำกับ", "ปัจจุบัน", "ทดลอง"], changes)
    report.link("ผลทุกคลิป regression (CSV)", root / "regression-cases.csv")
    report.link("ผล regression นับวิดีโอไม่ซ้ำ (CSV)", root / "regression-unique-cases.csv")
    report.heading("5. Challenge ผู้สูงอายุจริง แยกจากการฝึก")
    report.table(["โมเดล", "คลิปล้ม", "พบเหตุในคลิป", "พลาด", "Recall ของคลิป"],
        [[name, result["elderly28"]["clips"], result["elderly28"]["tp"], result["elderly28"]["fn"],
          percent(result["elderly28"]["recall"])] for name, result in (("ปัจจุบัน", current), ("ทดลอง", candidate))])
    report.paragraph(f"คลิปทั้งหมด {coverage['clips']} คลิปเป็น fall เท่านั้น จึงไม่มี specificity หรืออัตราแจ้งผิดในกิจวัตรปกติ มี {coverage['noEligibleWindows']} คลิปไม่มีหน้าต่างที่เข้าเกณฑ์ และ {coverage['lessThanTwoWindows']} คลิปมีหน้าต่างน้อยกว่า {confirmations} ครั้งสำหรับยืนยันเหตุ จำนวน pose เดี่ยว {coverage['singlePoseFrames']} เฟรม; ข้ามเฟรมที่พบหลาย pose {coverage['multiplePoseFramesSkipped']} เฟรม")
    report.paragraph("มีผู้ดูแลปรากฏในบางคลิป แต่ไม่มี annotation ตัวบุคคลที่ล้ม การได้ผลบวกในคลิปจึงไม่ยืนยันว่าระบุตัวผู้สูงอายุถูกต้อง การข้ามเฟรมหลาย pose ช่วยไม่ยกป้าย fall ไปให้ผู้ดูแล แต่ทำให้หลักฐานขาดหาย ตารางนี้เป็น challenge ของระบบสกัดและตัวจำแนก ไม่ใช่ความแม่นยำการระบุตัวบุคคล ไม่ได้เผยแพร่ภาพใบหน้าจากคลิปผู้สูงอายุในรายงานนี้")
    old_elderly = {item["sha256"]: item for item in current["elderlyCases"]}
    report.table(["คลิป", "หน้าต่าง", "ปัจจุบัน", "ทดลอง", "หลักฐานต่อเนื่อง"],
        [[item["file"], item["eligibleWindows"], "พบเหตุ" if prediction(old_elderly[item["sha256"]]["result"]) else "พลาด",
          "พบเหตุ" if prediction(item["result"]) else "พลาด", "ไม่พอ" if item["eligibleWindows"] < confirmations else f"มีหน้าต่าง ≥ {confirmations}"]
         for item in candidate["elderlyCases"]])
    report.heading("6. ข้อจำกัดและงานที่ควรทำต่อ")
    report.paragraph("คอขวดสำคัญคือภาพที่ตัวหา pose ไม่เห็นคนต่อเนื่องหรือสลับ track โดยเฉพาะการบังตัวและฉากหลายคน การฝึกตัวจำแนกบน features เดิมแก้กรณีไม่มี features ไม่ได้ ต้องเตรียม annotation แยกคนและเวลาล้ม แล้วเปรียบเทียบตัวหา pose/การติดตามคนบนวิดีโอจริง ควรเพิ่มคลิปกิจวัตรของผู้สูงอายุที่ไม่ล้มและคลิปจากห้องเป้าหมายโดยได้รับอนุญาต ก่อนใช้รับรองความแม่นยำ")
    report.paragraph("ผล Android รุ่นปัจจุบันจากรอบก่อนยังเป็นหลักฐานเดิม ไม่ใช่ผลใหม่จากการฝึกครั้งนี้ การใช้ในบ้านจริงต้องทดสอบ HLS ของกล้องจริง หลายคน แสงมืด การขาดอินเทอร์เน็ต การดับจอ และมือถือจริง รวมถึงแจ้งเตือนถึงผู้ดูแลจริง")
    report.link("ผล Android และภาพจากรอบก่อน", Path(config["previousReport"]))
    report.heading("7. ตรวจสอบและไฟล์ส่งมอบ")
    checks = read(root / "checks.json")
    report.table(["การตรวจ", "ผล"], [[key, value] for key, value in checks.items()])
    report.link("ผลดิบพร้อมเกณฑ์เปรียบเทียบ", root / "evaluation.json")
    report.link("คำสั่งและพารามิเตอร์แต่ละโปรไฟล์", root / "profiles.json")
    report.link("คู่มือทำซ้ำ", Path(config["trainingGuide"]))
    if deployment.get("apk"):
        apk = Path(deployment["apk"])
        report.link("APK ที่ยังใช้งานอยู่", apk)
        report.paragraph(f"ขนาด {apk.stat().st_size:,} bytes · SHA256 {hashlib.sha256(apk.read_bytes()).hexdigest()}")
    report.save(Path(config["markdown"]), Path(config["html"]))
    print(json.dumps({"markdown": config["markdown"], "html": config["html"], "modelsFit": models_fit,
        "images": report.images, "deploymentStatus": deployment["status"]}))


if __name__ == "__main__":
    main()
