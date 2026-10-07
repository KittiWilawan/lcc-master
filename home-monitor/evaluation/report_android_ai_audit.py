"""Report observed Android AI outcomes, repetitions and evidence without accuracy promises."""
import argparse
import base64
import html
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def metrics(clips):
    falls = [case for case in clips if case["label"] == "fall"]
    normal = [case for case in clips if case["label"] == "normal"]
    tp = sum(case["predictedFall"] for case in falls)
    fp = sum(case["predictedFall"] for case in normal)
    return {"clips": len(clips), "fallClips": len(falls), "normalClips": len(normal),
            "tp": tp, "fn": len(falls) - tp, "tn": len(normal) - fp, "fp": fp,
            "recall": tp / len(falls) if falls else None,
            "specificity": (len(normal) - fp) / len(normal) if normal else None,
            "accuracy": (tp + len(normal) - fp) / len(clips) if clips else None}


def native_results(path):
    if not path.exists():
        return [], False
    log = path.read_text(encoding="utf-8-sig")
    marker = "INSTRUMENTATION_STATUS: pipelineResult="
    return [json.loads(line[len(marker):]) for line in log.splitlines() if line.startswith(marker)], "OK (1 test)" in log


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("artifacts", type=Path)
    args = parser.parse_args()
    workspace, root = args.workspace.resolve(), args.artifacts.resolve()
    plan = read_json(root / "run-plan.json")
    runtime = read_json(Path(plan["runtimeAsset"]))
    model = read_json(Path(plan["runtimeAsset"]).parent / "model.json")
    baseline_cases = {case["id"]: case for case in read_json(Path(plan["baselineCases"]))}
    additional_cases = {case["id"]: case for case in read_json(Path(plan["additionalCases"]))}
    groups = []
    for kind, count in (("baseline", plan["repeatRuns"]), ("additional", 1)):
        for number in range(1, count + 1):
            name = f"{kind}-{number:02d}"
            results = root / name / "results.json"
            if results.exists():
                groups.append({"name": name, "kind": kind, "clips": read_json(results)})
    timestamp = f"วันที่ {datetime.now(timezone(timedelta(hours=7))).isoformat()} · เวอร์ชัน {plan['expectedVersion']} · Android API 36 x86_64 Release"
    md = ["# ผลทดสอบ AI LookLanCare รอบใหม่", "", timestamp]
    body = ["<h1>ผลทดสอบ AI LookLanCare รอบใหม่</h1>", f"<p>{html.escape(timestamp)}</p>"]

    def section(title, paragraphs):
        md.extend(["", "## " + title, ""])
        body.append(f"<h2>{html.escape(title)}</h2>")
        for paragraph in paragraphs:
            md.extend([paragraph, ""])
            body.append(f"<p>{html.escape(paragraph)}</p>")

    def table(headers, rows):
        md.extend(["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"])
        md.extend("| " + " | ".join(str(cell) for cell in row) + " |" for row in rows)
        body.append("<div class='table'><table><thead><tr>" + "".join(f"<th>{html.escape(str(cell))}</th>" for cell in headers) +
                    "</tr></thead><tbody>" + "".join("<tr>" + "".join(f"<td>{html.escape(str(cell))}</td>" for cell in row) + "</tr>" for row in rows) + "</tbody></table></div>")

    summary = {group["name"]: metrics(group["clips"]) for group in groups}
    unique = set(case["id"] for group in groups for case in group["clips"])
    section("ขอบเขตและผลที่อ่านได้", [
        f"เสร็จ {len(groups)} ชุดการรัน รวมการทดสอบรายคลิป {sum(len(group['clips']) for group in groups)} ครั้ง จากคลิปไม่ซ้ำ {len(unique)} คลิป",
        "วัด AI บนอุปกรณ์ Android สำหรับกล้อง HLS ผ่าน Media3 → MediaPipe Pose → ตัวจำแนกล้มและการยืนยันต่อเนื่อง ใช้โค้ด native และ asset เดียวกับ APK ARM64 รุ่น 1.0.5 แต่รันใน emulator x86_64",
        "การทดสอบซ้ำสามรอบใช้คลิปเดิม จึงนับเป็น 12 คลิปไม่ซ้ำ ชุดเพิ่มเติมมี 20 คลิปจากผู้เข้าร่วมคนอื่น 5 คน เลือกก่อนดูผล ไม่มีการฝึกโมเดลหรือปรับ threshold ระหว่างทดสอบ",
        "ผลนี้ไม่ใช่การรับรองความแม่นยำทั่วไป 95% และไม่ครอบคลุมมือถือจริง กล้องมือถือ ระบบคอมบ้าน การระบุชื่อบุคคล หรือการรับ push ข้ามเครื่อง",
        "ผลไม่แจ้งล้มรวมกรณีที่ AI ยัง uncertain ด้วย ตารางนี้วัดว่ามี trigger ล้มหรือไม่ จำนวนเฟรมที่พบ pose และสถานะก่อนยืนยันอ่านได้จาก trace จึงไม่ใช้จำนวนไม่แจ้งผิดอ้างว่ารู้จำท่าปกติสำเร็จทุกเฟรม",
    ])
    rows = []
    for name, item in summary.items():
        rows.append([name, item["clips"], f"{item['tp']}/{item['fallClips']}", item["fn"], f"{item['fp']}/{item['normalClips']}",
                     f"{item['recall']*100:.1f}%" if item["recall"] is not None else "—",
                     f"{item['specificity']*100:.1f}%" if item["specificity"] is not None else "—"])
    table(["รอบ", "คลิป", "ตรวจล้มได้", "พลาด", "แจ้งผิด", "Recall", "Specificity"], rows)

    baseline = [group for group in groups if group["kind"] == "baseline"]
    stable_rows = []
    unstable = []
    for case_id, info in baseline_cases.items():
        outcomes = [next(case for case in group["clips"] if case["id"] == case_id) for group in baseline]
        if not outcomes:
            continue
        predictions = [case["predictedFall"] for case in outcomes]
        if len(set(predictions)) > 1:
            unstable.append(case_id)
        stable_rows.append([case_id, info["label"], *("ล้ม" if item else "ไม่แจ้งล้ม" for item in predictions),
                            ", ".join(str(case["frames"]) for case in outcomes)])
    section("ผลซ้ำและความสม่ำเสมอ", [
        f"คลิปที่ผลล้ม/ไม่แจ้งล้มเปลี่ยนระหว่างรอบ: {', '.join(unstable) if unstable else 'ยังไม่พบในรอบที่เสร็จ'}",
        "จำนวนเฟรมที่วิเคราะห์ขึ้นกับเวลาเริ่มสตรีมและการข้ามเฟรมเมื่อเครื่องไม่ทัน การทดสอบนี้เก็บ trace ของทุกเฟรมที่ AI ได้รับ เพื่อแสดงหลักฐานผล uncertain จำนวนคน และการยืนยันล้ม ความสัมพันธ์ดังกล่าวยังไม่ใช่ข้อพิสูจน์สาเหตุของทุกกรณี",
    ])
    table(["คลิป", "ป้ายกำกับ", *(group["name"] for group in baseline), "เฟรมแต่ละรอบ"], stable_rows)
    if baseline:
        detected = [metrics(group["clips"])["tp"] for group in baseline]
        section("ข้อสรุปความสม่ำเสมอ", [
            f"ในชุดเดิม ตรวจล้มได้ต่ำสุด {min(detected)} และสูงสุด {max(detected)} จาก 6 คลิปต่อรอบ มี {len(unstable)}/12 คลิปที่คำตอบเปลี่ยน จึงยังไม่รับรองผลตรวจที่สม่ำเสมอจากรอบนี้",
            "การที่ instrumentation ขึ้น OK หมายถึงอ่านและวิเคราะห์คลิปครบตามเงื่อนไขของตัวทดสอบ จำนวนเหตุล้มที่พลาดและแจ้งผิดต้องอ่านจากผล AI แยกต่างหาก",
        ])

    section("ชุดเพิ่มเติม", [
        "เลือกจาก manifest split=test ของชุด Figshare ตาม seed และป้ายกำกับ ล้ม 10 คลิปและไม่ล้ม 10 คลิป ผู้เข้าร่วม 2, 3, 8, 17, 19 มี ID ต่างจากชุด Figshare เดิมที่ใช้ผู้เข้าร่วม 1 แต่ split นี้เคยใช้ในการประเมิน offline ก่อนหน้านี้ จึงไม่ใช่ชุดทดสอบ blind ใหม่ทั้งหมด การเทียบ ID ของคนทำได้ภายใน dataset เดียวกัน",
        "metadata ระบุทิศทางกิจกรรม F/B/L/R; อายุ เพศ และเวลาเริ่มล้มไม่ได้ระบุสำหรับชุดนี้ ผู้เข้าร่วม 17 มีเฉพาะคลิปล้มและ 19 มีเฉพาะคลิปปกติ จึงไม่ใช้สรุปความแม่นยำแยกประชากร",
    ])
    for group in [item for item in groups if item["kind"] == "additional"]:
        rows = []
        for case in group["clips"]:
            metadata = additional_cases[case["id"]]["sourceMetadata"]
            rows.append([case["id"], metadata["subject_id"], metadata["side"], metadata["action_id"], case["label"],
                         "ล้ม" if case["predictedFall"] else "ไม่แจ้งล้ม", case["frames"], case["firstFallMs"] or "—"])
        table(["คลิป", "ผู้เข้าร่วม", "ทิศทาง", "กิจกรรม", "ป้ายกำกับ", "ผล", "เฟรม", "เริ่มคลิปถึงผลล้ม (ms)"], rows)

    section("การดับจอและความตรงของโมเดล", [
        "firstFallMs วัดจากเริ่มเล่นคลิป ไม่มี label เวลาที่ร่างกายเริ่มล้ม จึงยังใช้เป็นเวลาตอบสนองจากเริ่มล้มจริงไม่ได้ การทดสอบ clip pipeline วัดผล AI ส่วนการทดสอบ screen-off ตรวจคิวเหตุและ OS notification จริง",
    ])
    checks = {}
    for filename in ("parity.log", "screen-off.log"):
        records, passed = native_results(root / filename)
        checks[filename] = {"passed": passed, "results": records}
        final = records[-1] if records else None
        if passed and final and final.get("test") == "screen-off":
            paragraphs = [f"ผ่าน: ดับจอ {final['durationMs']//60000} นาที กล้องยัง ready และผลวิเคราะห์ล่าสุดมีอายุ {final['analysisAgeMs']} ms ตรวจ {final['checkpoints']} จุด",
                          f"เหตุล้มผิดระหว่างคลิปปกติ {final.get('unexpectedNormalEvents', 'ไม่ได้วัด')} เหตุ หลังเปลี่ยนเป็นคลิปล้ม สร้างเหตุและตรวจ OS notification ภายใน {final['clipStartToAlertMs']/1000:.3f} วินาทีจากเริ่มคลิป"]
        elif passed and final:
            paragraphs = ["ผ่าน: " + json.dumps(final, ensure_ascii=False)]
        else:
            paragraphs = ["ยังไม่ผ่าน/ยังไม่มีผลครบ: ดู " + filename]
        section(filename, paragraphs)
    section("ปัญหาที่พบและขั้นตอนทำซ้ำ", [
        "ใช้ run-plan.json กับ gateway ของชุดที่ต้องการ แล้วรัน run_android_ai_audit.py จะอ่าน HLS และบันทึกผลจากตัวตรวจใน release build ข้อผิดพลาดล้มที่พลาดมีความรุนแรงสูง และการแจ้งผิดมีความรุนแรงปานกลางสำหรับการประเมินนี้",
    ])
    problems = []
    for group in groups:
        for case in group["clips"]:
            wrong = case["predictedFall"] != (case["label"] == "fall")
            trace_path = root / group["name"] / f"pipeline-{case['id']}-trace.json"
            trace = read_json(trace_path) if trace_path.exists() else []
            if not wrong:
                continue
            maximum = max((sample["analysis"]["confidence"] for sample in trace), default=None)
            no_pose = sum(sample["analysis"]["peopleCount"] == 0 for sample in trace)
            uncertain = sum(sample["analysis"]["status"] == "uncertain" for sample in trace)
            alerts = sum(sample["analysis"].get("fallDetected", False) for sample in trace)
            problem = {"run": group["name"], "case": case["id"], "expected": case["label"],
                       "actual": "fall" if case["predictedFall"] else "no_fall_alert", "frames": case["frames"],
                       "noPoseFrames": no_pose, "uncertainFrames": uncertain, "maximumFallScore": maximum, "confirmedTriggers": alerts}
            problems.append(problem)
            section(group["name"] + " / " + case["id"], [
                f"คาดหวัง: {case['label']} ตามป้ายกำกับต้นทาง ผลจริง: {problem['actual']} รับภาพวิเคราะห์ {case['frames']} เฟรม ไม่พบ pose {no_pose} เฟรม uncertain {uncertain} เฟรม จำนวน trigger ที่ยืนยัน {alerts}",
                f"คะแนนล้มสูงสุด {maximum} เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้",
            ])
            table(["เวลาเริ่มคลิป (ms)", "ผล AI", "คะแนนล้ม", "พบคน", "ID track ที่มองเห็น", "trigger"], [
                [sample["elapsedMs"], sample["analysis"]["status"], f"{sample['analysis']['confidence']:.4f}", sample["analysis"]["peopleCount"],
                 ", ".join(str(box["trackId"]) for box in sample["analysis"]["detections"]), sample["analysis"].get("fallDetected", False)]
                for sample in trace])

    section("จุดที่ควรแก้ก่อนกล่าวอ้างความแม่นยำสูง", [
        "รักษาความต่อเนื่องของ track ขณะคนล้มเร็วหรือ pose หาย ตัวอย่าง 04-fall ในรอบแรกได้รับเพียง 3 เฟรม และ ID เปลี่ยนจาก 0 เป็น 1 ทำให้แต่ละ track มีประวัติไม่พอ; 06-fall และ extra-06-fall มีคะแนนสูงบางช่วง แต่ pose ขาดก่อนยืนยันต่อเนื่อง",
        "ตรวจข้อมูลฝึกและการเทียบเกณฑ์กับภาพตามเวลาในสตรีมจริง คลิป 09-normal แจ้งผิดในสองรอบและมีคะแนนประมาณ 0.999 จึงใช้คะแนน confidence สูงเป็นหลักฐานความถูกต้องไม่ได้ ต้องประเมินกิจกรรมปกติที่คล้ายล้มด้วยชุดข้อมูลที่แยกไว้",
        "วัดอัตราเฟรมที่ส่งถึง AI และเวลาเหตุบนมือถือจริง พร้อม label จุดเริ่มล้ม ภายใต้หลายห้องและการบังตัว ผลของ emulator นี้ยังไม่ชี้ว่าปัญหาแต่ละส่วนเกิดบนมือถือจริงเท่าใด",
    ])

    section("หลักฐานรายคลิป", [
        "ภาพด้านล่างเป็นเฟรมแรกที่ถอดและวิเคราะห์จริงจาก HLS ไม่ใช่ภาพ UI หรือภาพ ณ เวลาแจ้งเหตุ แต่ละคลิปมี trace JSON และ log ของรอบนั้นอยู่ในโฟลเดอร์รายงาน",
    ])
    images = 0
    for group in groups:
        info = baseline_cases if group["kind"] == "baseline" else additional_cases
        for case in group["clips"]:
            image_path = root / group["name"] / f"pipeline-{case['id']}.jpg"
            caption = f"{group['name']} / {case['id']} · label={case['label']} · ผล={'ล้ม' if case['predictedFall'] else 'ไม่แจ้งล้ม'}"
            metadata = json.dumps(info[case["id"]]["sourceMetadata"], ensure_ascii=False)
            md.extend(["", "### " + caption, "", metadata, "", f"![{caption}]({image_path.as_posix()})"])
            if not image_path.exists():
                md.append("ยังเก็บภาพนี้ไม่ได้ ดู log ของรอบทดสอบ")
                body.append(f"<p>{html.escape(caption)} — ยังเก็บภาพไม่ได้</p>")
                continue
            encoded = base64.b64encode(image_path.read_bytes()).decode()
            body.append(f"<figure><figcaption>{html.escape(caption)}</figcaption><img src='data:image/jpeg;base64,{encoded}' alt='{html.escape(caption)}'><p>{html.escape(metadata)}</p></figure>")
            images += 1
    section("ค่าที่ใช้และข้อจำกัด", [
        f"IMAGE mode · Pose Lite · อ่านภาพ {runtime['frameIntervalMs']} ms · threshold {model['fallThreshold']} · ยืนยัน {runtime['confirmations']} ครั้ง · ภาพ {runtime['maxFrameDimension']} px · runtime.json และ model.json ตรวจตรงกับ APK ARM64 ที่ส่งให้ผู้ใช้",
        "โมเดลทำงานบนอุปกรณ์ ไม่มีการเรียก AI provider ภายนอกระหว่างรอบนี้ การวิเคราะห์ไม่ใช้โควต้า AI cloud",
        "emulator เสียบไฟและใช้สตรีมในเครือข่ายจำลอง ผลนี้ไม่ครอบคลุม Deep Doze โทรศัพท์จริง ภาพจากห้องจริง หรือการระบุเฉพาะคนในห้องหลายคน ต้องตรวจข้อพลาดกับข้อมูลที่ระบุเวลาเหตุและใช้ชุดประเมินแยกก่อนรับรองความแม่นยำ",
        "log ของ emulator มี ANR ของ Google Play Services ระหว่างเริ่มเครื่อง ดู emulator-anr-events.log ข้อจำกัดของสภาพแวดล้อมอาจมีผลต่อเวลาอ่าน/วิเคราะห์ภาพ และยังไม่ได้แยกวัดผลกระทบดังกล่าว",
        "OS notification ในผลดับจอตรวจจากรายการแจ้งเตือนของ Android ไม่ได้ยืนยันเสียงหรือการเห็นแจ้งเตือนบนมือถือจริง และไม่ได้ทดสอบส่งไปมือถือผู้ดูแลอีกเครื่อง",
    ])
    final_path = root / "cleanup.json"
    if final_path.exists():
        section("หลังจบการทดสอบ", [json.dumps(read_json(final_path), ensure_ascii=False)])
    data = {"metrics": summary, "unstableBaselineIds": unstable, "nativeChecks": checks, "problems": problems,
            "uniqueClips": len(unique), "clipRuns": sum(len(group["clips"]) for group in groups), "images": images}
    (root / "results-summary.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "AI_RETEST_REPORT_TH.md").write_text("\n".join(md), encoding="utf-8")
    document = "<!doctype html><html lang='th'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ผลทดสอบ AI LookLanCare</title><style>body{font:18px/1.65 system-ui,sans-serif;max-width:1050px;margin:30px auto;padding:0 20px;color:#173327}h1,h2{line-height:1.3}h2{margin-top:36px}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}td,th{border:1px solid #cbd5d1;padding:8px;text-align:left}figure{margin:24px 0;padding:16px;background:#f3f7f4;border-radius:14px}img{max-width:100%;height:auto}figure p{font-size:13px}p{overflow-wrap:anywhere}</style></head><body>" + "".join(body) + "</body></html>"
    (root / "REPORT_TH.html").write_text(document, encoding="utf-8")
    print(json.dumps({"uniqueClips": len(unique), "clipRuns": data["clipRuns"], "images": images, "metrics": summary}))


if __name__ == "__main__":
    main()
