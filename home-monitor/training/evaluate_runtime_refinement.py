"""Evaluate a frozen selection on regression and a separate elderly challenge."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from train_runtime_classifier import clip_metrics, score_records, source_metrics


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    config = read(args.config)
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[name] = str(config["threads"])
    sys.path.insert(0, config["mlLibraries"])
    import joblib
    import numpy as np
    selected = read(Path(config["selection"]))["selected"]
    if hashlib.sha256(Path(selected["model"]).read_bytes()).hexdigest() != selected["sha256"]:
        raise ValueError("Frozen model changed before evaluation")
    if hashlib.sha256(Path(config["baselineModel"]).read_bytes()).hexdigest() != config["baselineSha256"]:
        raise ValueError("Baseline changed before comparison")
    runtime = read(Path(config["runtimeAsset"]))
    base_metadata = read(Path(config["modelMetadata"]))
    records = [json.loads(line) for line in Path(config["checkpoint"]).read_text(encoding="utf-8").splitlines()]
    test = [row for row in records if row["case"]["split"] == "test"]
    elderly = [json.loads(line) for line in Path(config["elderlyCheckpoint"]).read_text(encoding="utf-8").splitlines()]
    old = joblib.load(config["baselineModel"])
    new = joblib.load(selected["model"])
    results = {}
    for name, artifact in (("current", old), ("candidate", new)):
        metadata = {**base_metadata, "framesPerWindow": artifact["frames_per_video"], "featureVariant": artifact["feature_variant"]}
        scores = score_records(artifact["model"], test, runtime, metadata, np)
        elder_scores = score_records(artifact["model"], elderly, runtime, metadata, np)
        results[name] = {"regression499": source_metrics(test, scores, artifact["threshold"], runtime),
            "elderly28": clip_metrics(elderly, elder_scores, artifact["threshold"], runtime),
            "elderlyPoseCoverage": {"clipsWithNoEligibleWindow": sum(not row for row in elder_scores),
                "clipsWithFewerThanConfirmationWindows": sum(len(row) < runtime["confirmations"] for row in elder_scores)},
            "regressionCases": [{"sha256": record["sha256"], "case": record["case"], "result":
                clip_metrics([record], [score], artifact["threshold"], runtime)} for record, score in zip(test, scores)],
            "elderlyCases": [{"sha256": record["sha256"], "file": Path(record["case"]["video_path"]).name,
                "eligibleWindows": len(score), "result": clip_metrics([record], [score], artifact["threshold"], runtime)}
                for record, score in zip(elderly, elder_scores)]}
    old_metrics = results["current"]["regression499"]["combined"]
    new_metrics = results["candidate"]["regression499"]["combined"]
    same_model = hashlib.sha256(Path(config["baselineModel"]).read_bytes()).hexdigest() == selected["sha256"]
    gate = {"newModelSelected": not same_model, "recallDoesNotRegress": new_metrics["recall"] >= old_metrics["recall"],
        "falseAlertsDoNotIncrease": new_metrics["fp"] <= old_metrics["fp"],
        "accuracyDoesNotRegress": new_metrics["accuracy"] >= old_metrics["accuracy"],
        "elderlyRecallDoesNotRegress": results["candidate"]["elderly28"]["recall"] >= results["current"]["elderly28"]["recall"]}
    output = {"scope": "Frozen selection evaluated once; previously inspected 499 clips are regression, elderly challenge has only falls",
        "selected": selected, "results": results, "offlineReleaseGate": gate, "requiresAndroidComparison": all(gate.values()), "config": config}
    Path(config["output"]).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"offlineReleaseGate": gate, "current": old_metrics, "candidate": new_metrics,
        "elderlyCurrent": results["current"]["elderly28"], "elderlyCandidate": results["candidate"]["elderly28"]}))


if __name__ == "__main__":
    main()
