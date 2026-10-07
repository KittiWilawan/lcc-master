"""Run labelled native Android streaming tests and collect only synthetic test evidence."""
import argparse
import json
import subprocess
from pathlib import Path


def result_records(log):
    marker = "INSTRUMENTATION_STATUS: pipelineResult="
    return [json.loads(line[len(marker):]) for line in log.splitlines() if line.startswith(marker)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--kind", choices=("baseline", "additional"), required=True)
    parser.add_argument("--runs", type=int, required=True)
    args = parser.parse_args()
    if args.runs <= 0:
        raise ValueError("At least one run required")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    cases = json.loads(Path(plan[args.kind + "Cases"]).read_text(encoding="utf-8"))
    expected = {case["id"]: case["label"] for case in cases}
    args.output.mkdir(parents=True, exist_ok=True)
    command = [plan["adb"], "-s", plan["serial"], "shell", "am", "instrument", "-w", "-r",
               "-e", "baseUrl", plan["baseUrl"], "-e", "class",
               plan["testClass"] + "#hlsDecodingAndLocalAiOnLabelledClips",
               "-e", "captureTrace", "true",
               plan["testPackage"] + "/androidx.test.runner.AndroidJUnitRunner"]
    summaries = []
    for number in range(1, args.runs + 1):
        name = f"{args.kind}-{number:02d}"
        log_path = args.output / f"{name}.log"
        if log_path.exists():
            raise FileExistsError(f"Preserve existing evidence: {log_path}")
        try:
            run = subprocess.run(command, capture_output=True, timeout=plan["testTimeoutSeconds"],
                                 creationflags=subprocess.CREATE_NO_WINDOW)
            log = (run.stdout + run.stderr).decode("utf-8", errors="replace")
        except subprocess.TimeoutExpired as error:
            log = ((error.stdout or b"") + (error.stderr or b"")).decode("utf-8", errors="replace")
            log_path.write_text(log, encoding="utf-8")
            raise RuntimeError(f"Android test timed out; evidence kept: {log_path}") from error
        log_path.write_text(log, encoding="utf-8")
        clips = [record["result"] for record in result_records(log) if record.get("test") == "hls-clip"]
        if "OK (1 test)" not in log or len(clips) != len(expected) or {case["id"] for case in clips} != set(expected):
            raise RuntimeError(f"Incomplete native pipeline test; inspect {log_path}")
        if any(case["frames"] <= 0 or case["label"] != expected[case["id"]] for case in clips):
            raise RuntimeError(f"Invalid labelled result: {log_path}")
        evidence = args.output / name
        evidence.mkdir()
        (evidence / "results.json").write_text(json.dumps(clips, ensure_ascii=False, indent=2), encoding="utf-8")
        for case in clips:
            filenames = [f"pipeline-{case['id']}.jpg", f"pipeline-{case['id']}-trace.json"]
            if case["predictedFall"]:
                filenames.append(f"pipeline-{case['id']}-fall.jpg")
            for filename in filenames:
                if Path(filename).name != filename:
                    raise ValueError("Invalid test evidence filename")
                pulled = subprocess.run([plan["adb"], "-s", plan["serial"], "pull",
                    f"/data/user/0/{plan['package']}/files/{filename}", str(evidence / filename)],
                    capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                if pulled.returncode:
                    raise RuntimeError(f"Could not collect test evidence: {filename}")
        falls = [case for case in clips if case["label"] == "fall"]
        normal = [case for case in clips if case["label"] == "normal"]
        summary = {"run": name, "clips": len(clips), "falls": len(falls),
                   "detectedFalls": sum(case["predictedFall"] for case in falls),
                   "falseAlerts": sum(case["predictedFall"] for case in normal),
                   "normal": len(normal), "frames": sum(case["frames"] for case in clips),
                   "missedIds": [case["id"] for case in falls if not case["predictedFall"]],
                   "falseAlertIds": [case["id"] for case in normal if case["predictedFall"]]}
        summaries.append(summary)
        (args.output / f"{args.kind}-summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")
        print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
