import argparse
import csv
import json
import time
from pathlib import Path

from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score

from smoke_pose_service import analyze, read_frames


def read_arguments():
    parser = argparse.ArgumentParser(description="Evaluate the running pose service on one manifest split")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("service_url")
    parser.add_argument("output", type=Path)
    parser.add_argument("--split", default="test")
    parser.add_argument("--progress-interval", type=int, default=25)
    return parser.parse_args()


def main():
    args = read_arguments()
    with args.manifest.open(encoding="utf-8-sig", newline="") as source:
        rows = [row for row in csv.DictReader(source) if row["split"] == args.split]
    labels = []
    predictions = []
    uncertain = 0
    failures = []
    cases = []
    started_at = time.time()
    for index, row in enumerate(rows, start=1):
        case_id = Path(row["video_path"]).stem
        try:
            result = analyze(
                case_id, read_frames(row["video_path"]), args.service_url, show_result=False,
            )
            labels.append(1 if row["label"] == "fall" else 0)
            predictions.append(1 if result["status"] == "fall" else 0)
            if result["status"] == "uncertain":
                uncertain += 1
            cases.append({
                "caseId": case_id,
                "label": row["label"],
                "status": result["status"],
                "confidence": result["confidence"],
                "detectedPoseFrames": result["detectedPoseFrames"],
                "trackCandidates": result.get("trackCandidates", []),
                "detectorMode": result.get("detectorMode"),
                "peopleCount": result.get("peopleCount"),
            })
        except Exception as error:
            failures.append({"caseId": case_id, "error": str(error)})
        if index % args.progress_interval == 0 or index == len(rows):
            elapsed = time.time() - started_at
            print(json.dumps({
                "processed": index,
                "total": len(rows),
                "clipsPerSecond": round(index / elapsed, 2),
                "failures": len(failures),
            }), flush=True)
    true_negative, false_positive, false_negative, true_positive = confusion_matrix(
        labels, predictions, labels=[0, 1],
    ).ravel()
    result = {
        "split": args.split,
        "videos": len(rows),
        "evaluated": len(labels),
        "uncertain": uncertain,
        "failures": failures,
        "cases": cases,
        "truePositive": int(true_positive),
        "trueNegative": int(true_negative),
        "falsePositive": int(false_positive),
        "falseNegative": int(false_negative),
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "specificity": float(true_negative / (true_negative + false_positive)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "elapsedSeconds": round(time.time() - started_at, 2),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
