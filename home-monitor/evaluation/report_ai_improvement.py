"""Build Thai evidence reports from frozen training and native test outputs."""
import argparse
import base64
import html
import json
import statistics
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def metrics(rows):
    tp = sum(row["label"] == "fall" and row["predictedFall"] for row in rows)
    fn = sum(row["label"] == "fall" and not row["predictedFall"] for row in rows)
    fp = sum(row["label"] == "normal" and row["predictedFall"] for row in rows)
    tn = sum(row["label"] == "normal" and not row["predictedFall"] for row in rows)
    return {"clips": len(rows), "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "accuracy": (tp + tn) / len(rows), "recall": tp / (tp + fn), "specificity": tn / (tn + fp)}


def percent(value):
    return f"{value * 100:.1f}%"


class Report:
    def __init__(self):
        self.md, self.web, self.images = [], [], 0

    def heading(self, title, level=2):
        self.md.append(f"{'#' * level} {title}\n")
        self.web.append(f"<h{level}>{html.escape(title)}</h{level}>")

    def paragraph(self, text):
        self.md.append(text + "\n")
        self.web.append(f"<p>{html.escape(text)}</p>")

    def table(self, headers, rows):
        safe = lambda value: str(value).replace("|", "／").replace("\n", " ")
        self.md.append("| " + " | ".join(map(safe, headers)) + " |\n| " + " | ".join("---" for _ in headers) + " |\n" +
            "\n".join("| " + " | ".join(map(safe, row)) + " |" for row in rows) + "\n")
        self.web.append("<div class='scroll'><table><thead><tr>" +
            "".join(f"<th>{html.escape(str(value))}</th>" for value in headers) + "</tr></thead><tbody>" +
            "".join("<tr>" + "".join(f"<td>{html.escape(str(value))}</td>" for value in row) + "</tr>" for row in rows) +
            "</tbody></table></div>")

    def link(self, title, path):
        self.md.append(f"[{title}](<{path.resolve().as_posix()}>)\n")
        self.web.append(f"<p><a href='{html.escape(path.resolve().as_uri(), quote=True)}'>{html.escape(title)}</a></p>")

    def image(self, title, path):
        if not path.is_file():
            raise FileNotFoundError(path)
        self.images += 1
        self.md.append(f"![{title}](<{path.resolve().as_posix()}>)\n")
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        self.web.append(f"<figure><img loading='lazy' src='data:image/jpeg;base64,{data}' alt='{html.escape(title, quote=True)}'><figcaption>{html.escape(title)}</figcaption></figure>")

    def save(self, md_path, web_path):
        md_path.write_text("\n".join(self.md), encoding="utf-8")
        web_path.write_text("<!doctype html><html lang='th'><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            "<title>LookLanCare — ผลปรับปรุง AI</title><style>body{font:17px/1.75 system-ui,sans-serif;color:#172b25;background:#f5f8f7;margin:0}"
            "main{max-width:1080px;margin:auto;padding:28px}h1,h2,h3{line-height:1.45;color:#075c40}h2{margin-top:40px}"
            "table{border-collapse:collapse;background:white;width:100%;font-size:15px}th,td{padding:10px;border:1px solid #ccdcd5;text-align:left;vertical-align:top}"
            "th{background:#dcefe7}.scroll{overflow-x:auto}a{color:#005eab}figure{margin:16px 0 32px;background:white;padding:12px;border:1px solid #ccdcd5}"
            "img{max-width:100%;height:auto;display:block;max-height:430px}figcaption{font-size:14px;margin-top:8px}@media print{main{padding:0}figure{break-inside:avoid}}</style><main>" +
            "\n".join(self.web) + "</main></html>", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    root, project = args.root.resolve(), args.project.resolve()
    selected = read(root / "model-selection.json")
    training = read(Path(selected["selected"]["model"]).parent / "training-results.json")
    old_offline = read(root / "training/training-results.json")["baselineTest"]
    plan = read(root / "run-plan.json")
    reg_plan = read(root / "regression-plan.json")
    cases = {}
    for path in (plan["baselineCases"], plan["additionalCases"], reg_plan["additionalCases"]):
        cases.update({row["id"]: row for row in read(Path(path))})
    runs = []
    for folder in ("quiet-baseline", "quiet-baseline-holdout", "quiet-candidate", "holdout-candidate", "tracking"):
        for path in sorted((root / folder).glob("*/results.json")):
            rows = read(path)
            runs.append({"name": folder + "/" + path.parent.name, "directory": path.parent, "rows": rows, "metrics": metrics(rows)})
    by_name = {run["name"]: run for run in runs}
    old_native = by_name["quiet-baseline/baseline-01"]["rows"] + by_name["quiet-baseline/additional-01"]["rows"]
    new_native = by_name["quiet-candidate/baseline-01"]["rows"] + by_name["quiet-candidate/additional-01"]["rows"]
    fresh = by_name["holdout-candidate/additional-01"]["rows"]
    old_fresh = by_name["quiet-baseline-holdout/additional-01"]["rows"]
    repeats = [run for run in runs if run["name"].startswith("quiet-candidate/baseline-")]
    if len(repeats) != plan["repeatRuns"]:
        raise ValueError("Missing repeated native runs")
    varying = [row["id"] for row in repeats[0]["rows"] if len({next(item["predictedFall"] for item in run["rows"] if item["id"] == row["id"]) for run in repeats}) > 1]
    screen = read(root / "screen-off/pipeline-screen-off-120000-result.json")
    checkpoints = read(root / "screen-off/pipeline-screen-off-120000.json")
    parity = read(root / "parity/checks.json")
    apk = read(root / "arm64-verification.json")
    delivery = read(root / "apk-delivery.json")
    checks = read(root / "final-checks.json")
    cleanup = read(root / "cleanup.json")
    diagnosis = read(root / "held-test-diagnosis.json")
    report = Report()
    report.heading("รายงานแก้ไขและฝึก AI LookLanCare 1.0.6", 1)
    report.paragraph("วันที่ 7 ตุลาคม 2026 · เป้าหมาย: ลดการพลาดเมื่อคนล้มเร็วหรือท่าทางหายชั่วคราว และฝึกโมเดลให้ตรงกับภาพที่ Android ใช้งานจริง ผลนี้ใช้สำหรับประเมินต้นแบบธีสิส ยังไม่ใช่หลักฐานรับรองความแม่นยำทั่วไป 95–100%")
    report.heading("1. สิ่งที่แก้และฝึกจริง")
    report.table(["ส่วน", "การปรับปรุง"], [
        ["ติดตามคน", "จับคู่กรอบด้วยทิศทางการเคลื่อนที่ ขนาดตัว และกรอบซ้อนทับ แก้ ID หลุดเมื่อคนล้มเร็ว เก็บ track ข้ามภาพหายได้ไม่เกิน 1.2 วินาที"],
        ["ยืนยันเหตุ", "ใช้ผลบวกจากภาพจริงอย่างน้อย 2 ครั้ง เว้นได้ไม่เกิน 0.9 วินาที ภาพหายอย่างเดียวสร้างเหตุไม่ได้ ยังมี rearm และ cooldown"],
        ["หน้าต่างเวลา", "3 เฟรม มีภาพจริงอย่างน้อย 2 เฟรมก่อนเริ่มให้คะแนน จึงต้องมีอย่างน้อย 3 ภาพจริงเพื่อแจ้งครั้งแรก เก็บตามอายุจริง ไม่ล้างทุกรอบที่ pose หาย"],
        ["ฝึกโมเดล", "ฝึก fall classifier 9 ตัวใน 4 โปรไฟล์ เลือกด้วย validation เท่านั้น ผู้ชนะ HistGradientBoosting 250 iterations, threshold 0.45, 1,242 features"],
        ["โมเดลท่าทาง", "ใช้ MediaPipe Pose Landmarker Lite task เดิม ไม่ได้ฝึก neural network หาจุดข้อต่อใหม่"],
        ["สถานะหน้าจอ", "ถ้ามีภาพแต่ AI ใช้เกิน 600 ms จะแจ้งว่าประมวลผลช้า และไม่นับกล้องนั้นว่าพร้อมตรวจทันเวลา ยังคงแสดงภาพและกรอบ"],
        ["APK", "โมเดลฝังใน release 1.0.6/code 7 ไม่ต้องเปิด Metro เพื่อใช้เส้นทาง HLS บนอุปกรณ์"]])
    report.heading("2. ข้อมูลและวิธีป้องกันผลคะแนนลวง")
    report.paragraph("ดึงท่าทางตามลำดับเวลาจาก 2,174 คลิป ขนาดไม่เกิน 640 px สุ่มทุก 300 ms ด้วย MediaPipe task ที่ใส่ใน APK แยกผู้เข้าร่วมและ SHA256 ไม่ซ้ำข้าม train/validation/test ผู้ชนะใช้เฉพาะ 1,268 คลิปฝึกจาก Figshare และ GMDCSA24 สร้าง 11,875 windows; validation 407 คลิป; test 499 คลิป ไม่ใช้ test เพื่อ fit หรือเลือก threshold")
    report.paragraph("ป้ายกำกับเป็นระดับวิดีโอ ช่วงตั้งแต่ 60% ของระยะคลิปที่ติดป้าย fall ถูกใช้เป็นตัวอย่างบวกแบบ weak supervision ไม่มีป้ายกำกับเวลาที่เริ่มล้มจริง คลิป normal ใช้หลายช่วงเวลา เสริมการข้ามเฟรมด้วย stride 2 สองตำแหน่ง เมื่อพบหลาย pose จะข้ามเฟรมนั้นเพื่อไม่ยกป้ายกำกับของผู้เข้าร่วมไปให้คนอื่น การฝึกนี้จึงยังไม่พิสูจน์ฉากหลายคนหรือการบังกันในห้องจริง")
    report.paragraph("โปรไฟล์แรกลองเสริม FallVision จาก train cache ที่แปลง keypoints 17 เป็น 33 จุด แต่โปรไฟล์ผู้ชนะไม่ได้ใช้ข้อมูลเสริมนี้ แช่แข็งการเลือกโปรไฟล์ก่อนอ่านคะแนน test ของผู้ชนะ ชุด test นี้กันออกจากการ fit รอบนี้ แต่เคยใช้วิเคราะห์ระบบในงานก่อนหน้า จึงไม่เรียกการรับรองแบบ blind ภาคสนาม")
    report.paragraph("แหล่งข้อมูลและเครดิต: Figshare DOI 10.6084/m9.figshare.28596332.v2 และ GMDCSA24 DOI 10.5281/zenodo.12921216 (CC BY 4.0 ตาม manifests); FallVision DOI 10.7910/DVN/75QPKK เฉพาะการทดลอง/คลิป regression อ้างอิง SHA และผู้เข้าร่วมใน cases.json และ extraction-provenance.json")
    report.link("การเลือกโมเดลที่แช่แข็งแล้ว", root / "model-selection.json")
    report.heading("3. ผล offline บน 499 คลิปที่กันไว้")
    comparison = []
    for label, result in (("ตัวจำแนกเดิม / หน้าต่าง 4 เฟรม", old_offline["combined"]), ("ตัวจำแนกใหม่ / หน้าต่าง 3 เฟรม", training["candidateTest"]["combined"])):
        comparison.append([label, result["clips"], result["tp"], result["fn"], result["fp"], result["tn"], percent(result["accuracy"]), percent(result["recall"])])
    report.table(["รุ่น", "คลิป", "ล้มพบ", "ล้มพลาด", "แจ้งผิด", "ปกติถูก", "Accuracy", "Recall ล้ม"], comparison)
    report.paragraph("การเปรียบเทียบ offline ใช้ pose ลำดับเวลาเดียวกันและกฎ gap ของ pipeline ใหม่ ตัวเดิมใช้ตัวจำแนกและความยาวหน้าต่างเดิม ส่วน minTrackFrames เป็น 3 ผลนี้ไม่ใช่การเล่น APK เดิมทั้งระบบ อีก comparator ที่ใช้ minTrackFrames=2 กับโมเดลเดิมให้ 85.97% (พลาด 48/แจ้งผิด 22) ผล APK จริงแสดงแยกในหัวข้อถัดไป")
    report.table(["แหล่งข้อมูล — รุ่นใหม่", "คลิป", "Accuracy", "Recall ล้ม", "Specificity", "พลาด", "แจ้งผิด"],
        [[source, item["clips"], percent(item["accuracy"]), percent(item["recall"]), percent(item["specificity"]), item["fn"], item["fp"]]
         for source, item in training["candidateTest"].items() if source != "combined"])
    report.paragraph("ยังพลาดการล้ม 18 คลิปและเตือนผิด 19 คลิป โดย GMDCSA24 มี accuracy เพียง 78.4% และเตือนผิด 6 จาก 20 คลิปปกติ ต้องแก้การแยกท่านั่ง/นอน/ก้มและฝึกข้อมูลที่มีเวลาล้มกำกับก่อนอ้างความพร้อมใช้งานทั่วไป ผลรวม 92.6% ไม่ได้หมายถึงทุกห้องหรือทุกมุมกล้องได้เท่านี้")
    report.heading("4. ผลผ่าน Android decoder และ AI จริง")
    report.paragraph("ใช้ release x86_64 ตรงกับ emulator LookLanCare_Audit_D_20261006/API 36 ที่แยกไว้และซ่อนหน้าต่าง ไม่ควบคุมเมาส์หรือคีย์บอร์ด Windows เล่น HLS จากคลิปที่มีป้ายกำกับ ผ่าน CameraStreamSession และ LocalPoseAnalyzer ตัวจริง APK เดิม 1.0.5 เทียบกับรุ่นใหม่ 1.0.6 ในช่วงที่ไม่มีการฝึก/Gradle แข่งขัน CPU ใช้ข้อมูลทดสอบและไม่มีบัญชีครอบครัวจริง")
    report.table(["ชุด", "คลิป", "ล้มพบ", "ล้มพลาด", "แจ้งผิด", "Accuracy", "Recall ล้ม"],
        [[label, item["clips"], item["tp"], item["fn"], item["fp"], percent(item["accuracy"]), percent(item["recall"])]
         for label, item in (("APK เดิม: 32 regression", metrics(old_native)), ("APK ใหม่: 32 regression รอบแรก", metrics(new_native)),
                             ("APK เดิม: 20 คลิปสตรีมเพิ่มเติม", metrics(old_fresh)), ("APK ใหม่: 20 คลิปสตรีมเพิ่มเติม", metrics(fresh)),
                             ("APK เดิม: 52 คลิปไม่ซ้ำ", metrics(old_native + old_fresh)), ("APK ใหม่: 52 คลิปไม่ซ้ำ", metrics(new_native + fresh)))])
    report.paragraph("20 คลิปสตรีมเพิ่มเติมถูกเลือกจากผู้เข้าร่วม test และตัด SHA ของ 32 คลิป regression ออกก่อนทราบคะแนนโมเดล ไม่ใช่ข้อมูลฝึก แต่เป็นส่วนหนึ่งของ 499 คลิป offline จึงไม่ควรนับเป็นตัวอย่างอิสระเพิ่มจากผล offline")
    report.table(["รอบซ้ำ 12 คลิป", "ล้มพบ/6", "แจ้งผิด/6", "เฟรม", "คลิปพลาด"],
        [[run["name"], f"{run['metrics']['tp']}/6", f"{run['metrics']['fp']}/6", sum(row["frames"] for row in run["rows"]),
          ", ".join(row["id"] for row in run["rows"] if row["label"] == "fall" and not row["predictedFall"]) or "ไม่มี"] for run in repeats])
    report.paragraph(f"จำนวนคลิปที่ผลเปลี่ยนใน 3 รอบ: {len(varying)}/12 ({', '.join(varying) or 'ไม่มี'}) ผลนี้พิสูจน์ความสม่ำเสมอเฉพาะคลิปและ emulator รอบนี้ ไม่ใช่ความแม่นยำในมือถือทุกเครื่อง")
    new_runs = [run for run in runs if run["name"].startswith(("quiet-candidate/", "holdout-candidate/"))]
    latencies = [row["firstFallMs"] for run in new_runs for row in run["rows"] if row["label"] == "fall" and row["firstFallMs"] is not None]
    durations = [row["inferenceMedianMs"] for run in new_runs for row in run["rows"]]
    report.paragraph(f"รวมรุ่นใหม่ {sum(len(run['rows']) for run in new_runs)} ครั้งรายคลิป, {sum(row['frames'] for run in new_runs for row in run['rows'])} เฟรม; median ของเวลา inference มัธยฐานแต่ละคลิป {statistics.median(durations):.0f} ms; เฉพาะคลิปล้มที่ตรวจพบ ให้ผลครั้งแรก median {statistics.median(latencies):.0f} ms, ช่วง {min(latencies)}–{max(latencies)} ms จากเริ่มเปิดคลิป ไม่ใช่ความหน่วงจากเวลาเริ่มล้ม")
    report.paragraph("JUnit ของชุดคลิปตรวจว่าถอดภาพและวิเคราะห์ได้ ส่วนผลถูก/ผิดคำนวณกับป้ายกำกับแยกต่างหาก ไม่ใช้คำว่า test ผ่านเพื่ออ้างว่าจับทุกเหตุได้")
    report.heading("5. ผลดับจอและความตรงกันของโมเดล")
    report.table(["รายการ", "ผลจริง"], [
        ["ดับจอ release 2 นาที", f"state={screen['state']}, screenInteractive={screen['screenInteractive']}, จุดตรวจ {screen['checkpoints']}, อายุผลล่าสุด {screen['analysisAgeMs']} ms, เหตุผิดระหว่างคลิปปกติ {screen['unexpectedNormalEvents']}"],
        ["เปลี่ยนเป็นคลิปล้มหลังดับจอ", f"เหตุบันทึกจริงและ OS notification={screen.get('fallAlertAfterScreenOff', False)}, เวลา {screen.get('clipStartToAlertMs')} ms จากเปิดคลิป"],
        ["Parity", json.dumps(parity, ensure_ascii=False)],
        ["Unit / TypeScript", json.dumps(checks, ensure_ascii=False)]])
    report.paragraph("การดับจอใช้ emulator ที่เสียบไฟ มี foreground service และตรวจ timestamp ของผล/คิวเหตุ/OS notification จริง ไม่ใช่ดูข้อความ service อย่างเดียว ไม่รับรอง deep doze การฆ่าแอปของผู้ผลิต หรือการรับ push บนมือถืออีกเครื่อง รอบ 10 นาทีที่เคยผ่านเป็นโมเดล 1.0.5 และไม่ถือว่าเป็นผลของโมเดลใหม่")
    report.link("เวลาและสถานะทุกจุดขณะดับจอ", root / "screen-off/pipeline-screen-off-120000.json")
    report.image("ภาพจากเฟรมที่สร้างเหตุหลังดับจอ (ข้อมูลทดสอบ)", root / "screen-off/event-evidence.jpg")
    report.heading("6. ปัญหาที่ยังต้องแก้ — ทำซ้ำได้")
    problems = []
    for run in new_runs:
        for row in run["rows"]:
            if row["predictedFall"] != (row["label"] == "fall"):
                problems.append(["สูง" if row["label"] == "fall" else "กลาง", run["name"], row["id"],
                    "ควรตรวจพบการล้ม" if row["label"] == "fall" else "ไม่ควรแจ้งล้ม", "พลาด" if row["label"] == "fall" else "แจ้งผิด",
                    row["frames"], f"{run['name']}/pipeline-{row['id']}-trace.json"])
    report.table(["ระดับ", "รอบ", "กรณี", "คาดหวัง", "ผลจริง", "เฟรม", "Trace"], problems)
    report.paragraph("กรณี 05-fall (FallVision S_D_0002) พลาดซ้ำทั้ง 3 รอบ ใน trace รอบแรกพบ pose หาย 3 ภาพต่อเนื่องและสร้าง track ใหม่หลังกลับมา คะแนนก่อน/หลังช่วงหายยังต่ำกว่า threshold (สูงสุดประมาณ 0.189) จึงมีทั้งข้อจำกัดการหาท่าทางและตัวจำแนก ไม่แก้ด้วยการลด threshold จากคลิป test นี้ เพราะจะเสี่ยงเพิ่มการแจ้งผิดและทำให้ผล test ใช้เป็นข้อมูลปรับโมเดล")
    report.paragraph("ชุดสตรีมเพิ่มเติมรุ่นใหม่ยังพลาด holdout-01/02/05-fall: 01 มีคะแนนสูงสองภาพแต่ track ต่างกัน (0 → 1) หลังพบหลาย pose; 02 มีคะแนนสูงเพียงภาพเดียวแล้วไม่พบ pose ต่อ; 05 ได้คะแนนสูงเพียงภาพเดียวตอนท้าย กฎยืนยันจึงไม่แจ้ง ทั้งสามมีปัญหาการรับ pose ต่อเนื่อง ส่วน holdout-17/18-normal ได้คะแนนสูงต่อเนื่องแม้ label เป็น normal จึงเป็นข้อจำกัดการจำแนก ไม่ควรเพิ่มความไวด้วยการยกเลิกการยืนยันซ้ำ")
    report.paragraph("ขั้นตอนทำซ้ำ: เปิด gateway ด้วย configuration ที่ตรงชุด → ติดตั้ง candidate-x86_64.apk และ candidate-test.apk ใน emulator แยก → เรียก run_android_ai_audit.py ด้วย regression-plan.json หรือ run-plan.json และ output ใหม่ → เทียบ predictedFall กับ label จาก cases.json ภาพแรกและ trace ของทุกกรณีอยู่หัวข้อหลักฐาน ลำดับเฟรม/จังหวะ decoder อาจทำให้ผลเปลี่ยน ต้องเก็บผลใหม่ทุกครั้ง")
    report.paragraph("พบผลเสียภายใต้โหลดสูงจริง: รอบ tracking ที่ใช้โมเดลเดิมระหว่างดึง pose มีเพียง 54 เฟรมจาก 12 คลิป จับล้มได้ 0/6 แม้ decoder ยังส่งภาพ การ infer หลายคลิปเกิน 600 ms จึงเพิ่มคำเตือนประมวลผลช้าใน UI และทดสอบใหม่ขณะเครื่องว่าง ห้ามรวมรอบ stress นี้เข้ากับ accuracy ของโมเดลใหม่")
    report.heading("7. APK ที่ส่งมอบและข้อจำกัด")
    report.link("ดาวน์โหลด APK 1.0.6 สำหรับมือถือ ARM64", Path(delivery["path"]))
    report.paragraph(f"{delivery['package']} · version {delivery['version']} / code {delivery['versionCode']} · {apk['bytes'] / 1048576:.1f} MiB · SHA256 {apk['apkSha256']}")
    report.paragraph(f"ตรวจลายเซ็นและ ZIP alignment 16 KB ผ่าน assets 5 ไฟล์ตรงกับต้นฉบับ native ELF {len(apk['libraries'])} ไฟล์รองรับ 16 KB cert ตรงกับ APK เดิม ติดตั้งทับได้เมื่อเครื่องอนุญาต APK จากแหล่งนี้ ยังไม่ได้ติดตั้งรุ่นนี้บนมือถือ ARM64 จริง")
    report.paragraph("การแก้รอบนี้อยู่เส้นทาง HLS AI ใน Android APK เส้นทางกล้องมือถือ type=device และโหมดคอมบ้านยังใช้ provider เดิม การติดตามกรอบเป็นความต่อเนื่องทางเรขาคณิต ยังไม่ใช่การยืนยันใบหน้าหรือชื่อบุคคล ตรวจสูงสุด 6 pose และ 2 กล้องตาม config เมื่อเริ่มหรืออัปเดต APK ต้องเปิดแอปและตรวจสถานะกล้องอีกครั้ง")
    report.paragraph("ข้อมูลเพศและอายุของผู้เข้าร่วมไม่ได้มีครบใน manifests ที่ใช้ จึงยังไม่รับรองผลแยกสำหรับเด็ก ผู้สูงอายุ หรือทุกวัย คะแนนที่แสดงจากตัวจำแนกเป็น model score ไม่ใช่การรับรองโอกาสถูกจริงเท่ากับเปอร์เซ็นต์นั้น")
    report.paragraph("ขั้นถัดไปที่มีประโยชน์: เพิ่มคลิป normal ที่นอน/นั่ง/ก้มและคลิปล้มที่มีเวลาเริ่มล้มกำกับ ฝึกเฉพาะ train แล้วทดสอบแหล่งใหม่จากห้องจริงที่ไม่เคยใช้ปรับโมเดล ตรวจแสงน้อย หลายคน การบังกัน และทดสอบแบตเตอรี่/ดับจอกับมือถือจริง รายงาน recall และ false alerts ต่อชั่วโมง ไม่ใช้ accuracy รวมอย่างเดียว")
    report.paragraph("ไม่มีการเรียกผู้ให้บริการ AI ภายนอกเพื่อเทรนหรือทดสอบ HLS รอบนี้ จึงไม่ได้ใช้โควต้า API ไม่ส่งเหตุไปบัญชีครอบครัวจริง ไม่ได้ตรวจ Supabase/Auth/การแจ้งข้ามเครื่องใหม่ในงานนี้")
    report.paragraph("ปิดบริการที่เริ่มเฉพาะรอบทดสอบแล้ว ผลตรวจ cleanup: " + json.dumps(cleanup, ensure_ascii=False))
    report.heading("8. รายการพลาดและแจ้งผิด offline ทั้งหมด")
    report.table(["แหล่ง", "ผู้เข้าร่วม", "กิจกรรม", "มุม", "label", "ผล", "windows", "SHA256"],
        [[row["case"]["dataset"], row["case"]["subject_id"], row["case"].get("action_id", ""), row["case"].get("side", ""),
          row["case"]["label"], row["error"], row["eligibleWindows"], row["sha256"]] for row in diagnosis["cases"] if row["error"]])
    report.link("ผลรายคลิป offline ทั้ง 499 กรณี", root / "held-test-diagnosis.json")
    report.heading("9. ภาพและผลทุกครั้งรายคลิป")
    report.paragraph("ภาพต่อไปนี้เป็นเฟรมแรกที่ AI รับจากคลิป ผลที่ระบุคำนวณจากทั้งคลิป ภาพแรกอาจยังไม่เกิดการล้ม จึงไม่ใส่กรอบผลจากเฟรมภายหลังลงภาพแรก trace เก็บทุกผลที่วิเคราะห์จริง ทั้งผ่าน พลาด และแจ้งผิด HTML ฝังภาพครบ เปิดได้โดยไม่ต้องใช้อินเทอร์เน็ต")
    for run in runs:
        report.heading(run["name"], 3)
        item = run["metrics"]
        report.paragraph(f"ล้มพบ {item['tp']}/{item['tp'] + item['fn']} · แจ้งผิด {item['fp']}/{item['tn'] + item['fp']} · เฟรม {sum(row['frames'] for row in run['rows'])}")
        report.link("ผลดิบของรอบ", run["directory"] / "results.json")
        for row in run["rows"]:
            truth = row["label"] == "fall"
            outcome = "ถูก" if row["predictedFall"] == truth else "พลาดล้ม" if truth else "แจ้งผิด"
            report.paragraph(f"{row['id']} · label {row['label']} · {outcome} · {row['frames']} เฟรม · inference median {row['inferenceMedianMs']} ms · พบครั้งแรก {row['firstFallMs']} ms จากเปิดคลิป · SHA {cases[row['id']]['sourceSha256']}")
            report.image(f"{run['name']} / {row['id']} / {outcome}", run["directory"] / f"pipeline-{row['id']}.jpg")
            trace = read(run["directory"] / f"pipeline-{row['id']}-trace.json")
            if row["predictedFall"] and not any(item["analysis"].get("fallDetected") for item in trace):
                raise ValueError("Fall status has no fresh confirmed event")
            report.link("ผลตามเวลา (trace)", run["directory"] / f"pipeline-{row['id']}-trace.json")
    summary = {"offlineOld": old_offline["combined"], "offlineNew": training["candidateTest"]["combined"],
        "nativeOld32": metrics(old_native), "nativeNew32": metrics(new_native), "nativeNew20": metrics(fresh),
        "nativeOld52": metrics(old_native + old_fresh), "nativeNew52": metrics(new_native + fresh), "repeatVaryingIds": varying, "images": report.images,
        "newClipRuns": sum(len(run["rows"]) for run in new_runs), "allClipRuns": sum(len(run["rows"]) for run in runs),
        "screenOff": screen, "parity": parity, "checks": checks, "apkSha256": apk["apkSha256"]}
    (root / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    report.save(project / "AI_IMPROVEMENT_REPORT_TH.md", root / "REPORT_TH.html")
    print(json.dumps({"images": report.images, "nativeNew52": summary["nativeNew52"], "report": str(root / "REPORT_TH.html")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
