"""Collect only the explicitly named synthetic test artifacts from an Android test package."""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--adb", required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--screen-off-ms", type=int, nargs="*", default=[])
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    files = ["pipeline-clips.json"]
    files += [f"pipeline-{case['id']}.jpg" for case in json.loads(args.cases.read_text(encoding="utf-8"))]
    for duration in args.screen_off_ms:
        files += [f"pipeline-screen-off-{duration}.json", f"pipeline-screen-off-{duration}-result.json", f"pipeline-screen-off-{duration}-fall-trace.json"]
    collected = []
    for filename in files:
        if Path(filename).name != filename:
            raise ValueError("Test artifact must be a filename")
        result = subprocess.run([args.adb, "-s", args.serial, "exec-out", "run-as", args.package,
                                 "cat", f"files/{filename}"], capture_output=True,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode == 0:
            (args.output / filename).write_bytes(result.stdout)
            collected.append(filename)
    print(json.dumps({"collected": collected, "requested": len(files)}))


if __name__ == "__main__":
    main()
