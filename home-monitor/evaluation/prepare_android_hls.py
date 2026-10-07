"""Prepare labelled local clips for Android pipeline tests, without training."""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("suite", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--segment-seconds", type=float, required=True)
    parser.add_argument("--frame-rate", type=int, required=True)
    parser.add_argument("--max-dimension", type=int, required=True)
    args = parser.parse_args()
    cases = json.loads(args.suite.read_text(encoding="utf-8"))["cases"]
    manifest = []
    for case in cases:
        case_id = case["caseId"]
        directory = args.output / case_id
        directory.mkdir(parents=True, exist_ok=True)
        playlist = directory / "clip.m3u8"
        subprocess.run([
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", case["sourceVideo"],
            "-an", "-vf", f"scale={args.max_dimension}:{args.max_dimension}:force_original_aspect_ratio=decrease",
            "-r", str(args.frame_rate), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-g", str(round(args.frame_rate * args.segment_seconds)), "-sc_threshold", "0",
            "-f", "hls", "-hls_time", str(args.segment_seconds), "-hls_playlist_type", "vod",
            "-hls_segment_filename", str(directory / "segment-%03d.ts"), str(playlist),
        ], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        manifest.append({
            "id": case_id, "path": f"/{case_id}/clip.m3u8", "label": case["label"],
            "durationMs": round(case["sourceDurationSeconds"] * 1000), "sourceVideo": case["sourceVideo"],
            "sourceSha256": case["sha256"], "sourceMetadata": case["metadata"],
        })
    (args.output / "cases.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"prepared": len(manifest), "output": str(args.output)}))


if __name__ == "__main__":
    main()
