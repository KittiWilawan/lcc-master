"""Describe held test errors after selection, without fitting or tuning a model."""
import argparse
import json
import os
import sys
from pathlib import Path

from train_runtime_classifier import clip_metrics, score_records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("selection", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    selection = json.loads(args.selection.read_text(encoding="utf-8"))["selected"]
    config = json.loads(Path(selection["config"]).read_text(encoding="utf-8"))
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[name] = str(config["threads"])
    sys.path.insert(0, config["mlLibraries"])
    import joblib
    import numpy as np
    artifact = joblib.load(selection["model"])
    runtime = json.loads(Path(selection["runtimeAsset"]).read_text(encoding="utf-8"))
    model = json.loads(Path(selection["modelMetadata"]).read_text(encoding="utf-8"))
    records = [json.loads(line) for line in Path(config["checkpoint"]).read_text(encoding="utf-8").splitlines()]
    records = [record for record in records if record["case"]["split"] == "test"]
    scored = score_records(artifact["model"], records, runtime, model, np)
    results = []
    for record, scores in zip(records, scored):
        first_confirmed, last_high, confirmations = None, None, 0
        for timestamp, probability in scores:
            if last_high is not None and timestamp - last_high > runtime["confirmationMaxGapMs"]:
                confirmations = 0
            if probability >= selection["threshold"]:
                confirmations += 1
                last_high = timestamp
            else:
                confirmations = 0
            if first_confirmed is None and confirmations >= runtime["confirmations"]:
                first_confirmed = timestamp
        case = record["case"]
        predicted = first_confirmed is not None
        results.append({"case": case, "sha256": record["sha256"], "eligibleWindows": len(scores),
            "maxProbability": max((float(score) for _, score in scores), default=None),
            "predictedFall": predicted, "firstConfirmationClipMs": first_confirmed,
            "error": "missed_fall" if case["label"] == "fall" and not predicted else
                     "false_alert" if case["label"] == "normal" and predicted else None})
    metrics = clip_metrics(records, scored, selection["threshold"], runtime)
    expected = artifact["training_report"]["candidateTest"]["combined"]
    if metrics != expected:
        raise ValueError("Diagnosis differs from the frozen held test result")
    args.output.write_text(json.dumps({"scope": "Post-selection diagnosis; no training or threshold changes",
        "metrics": metrics, "cases": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"clips": len(results), "errors": sum(row["error"] is not None for row in results)}))


if __name__ == "__main__":
    main()
