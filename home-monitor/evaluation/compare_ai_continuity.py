"""Compare paired native runs without fitting a model or changing a threshold."""
import argparse
import csv
import json
import math
import statistics
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def measured(directory, kind, budget):
    folder = directory / f"{kind}-01"
    rows = read(folder / "results.json")
    traces = [frame for row in rows for frame in read(folder / f"pipeline-{row['id']}-trace.json")]
    timings = sorted(frame["inferenceMs"] for frame in traces if "inferenceMs" in frame)
    return {"rows": rows, "frames": len(traces),
        "clipMedianMs": statistics.median(row["inferenceMedianMs"] for row in rows),
        "frameP95Ms": timings[math.ceil(len(timings) * .95) - 1] if timings else None,
        "frameMaxMs": max(timings) if timings else None,
        "overBudgetFrames": sum(value > budget for value in timings) if timings else None,
        "noPoseFrames": sum(frame["analysis"]["peopleCount"] == 0 for frame in traces),
        "recoveryInferences": sum(frame["analysis"].get("diagnostics", {}).get("recoveryInferences", 0) for frame in traces),
        "recoveredOnlyFrames": sum(frame["analysis"].get("diagnostics", {}).get("primaryPoses") == 0
            and frame["analysis"]["peopleCount"] > 0 for frame in traces),
        "duplicateReducedFrames": sum(frame["analysis"].get("diagnostics", {}).get("rawPoses", 0)
            > frame["analysis"].get("diagnostics", {}).get("primaryPoses", 0) for frame in traces)}


def counts(rows):
    tp = sum(row["label"] == "fall" and row["predictedFall"] for row in rows)
    fn = sum(row["label"] == "fall" and not row["predictedFall"] for row in rows)
    fp = sum(row["label"] == "normal" and row["predictedFall"] for row in rows)
    tn = sum(row["label"] == "normal" and not row["predictedFall"] for row in rows)
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "clips": len(rows),
        "accuracy": (tp + tn) / len(rows), "recall": tp / (tp + fn) if tp + fn else None,
        "specificity": tn / (tn + fp) if tn + fp else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--candidate", default="candidate")
    parser.add_argument("--output", default="comparison.json")
    args = parser.parse_args()
    root = args.root.resolve()
    budget = read(root / "candidate-runtime.json")["maxRealtimeInferenceMs"]
    output = {"candidate": args.candidate, "budgetMs": budget, "suites": {}}
    paired = []
    for kind in ("baseline", "additional"):
        old = measured(root / "baseline", kind, budget)
        new = measured(root / args.candidate, kind, budget)
        old_by_id = {row["id"]: row for row in old["rows"]}
        new_by_id = {row["id"]: row for row in new["rows"]}
        if len(old_by_id) != len(old["rows"]) or old_by_id.keys() != new_by_id.keys():
            raise ValueError("Native comparison must contain the same unique cases")
        improved, lost = [], []
        for key, first in old_by_id.items():
            second = new_by_id[key]
            if first["label"] != second["label"]:
                raise ValueError("Paired labels changed")
            expected = first["label"] == "fall"
            old_correct, new_correct = first["predictedFall"] == expected, second["predictedFall"] == expected
            if new_correct and not old_correct:
                improved.append(key)
            if old_correct and not new_correct:
                lost.append(key)
            paired.append({"suite": kind, "id": key, "label": first["label"],
                "baselineFall": first["predictedFall"], "candidateFall": second["predictedFall"],
                "baselineFrames": first["frames"], "candidateFrames": second["frames"],
                "baselineFirstFallMs": first["firstFallMs"], "candidateFirstFallMs": second["firstFallMs"]})
        old["counts"], new["counts"] = counts(old["rows"]), counts(new["rows"])
        output["suites"][kind] = {"baseline": old, "candidate": new, "improvedIds": improved, "lostIds": lost}
    reg = output["suites"]["baseline"]
    elderly = output["suites"]["additional"]
    rows = reg["candidate"]["rows"] + elderly["candidate"]["rows"]
    output["gates"] = {
        "regressionFallsDoNotDecrease": reg["candidate"]["counts"]["tp"] >= reg["baseline"]["counts"]["tp"],
        "regressionFalseAlertsDoNotIncrease": reg["candidate"]["counts"]["fp"] <= reg["baseline"]["counts"]["fp"],
        "olderAdultClipEventsDoNotDecrease": elderly["candidate"]["counts"]["tp"] >= elderly["baseline"]["counts"]["tp"],
        "eventDetectionImproves": reg["candidate"]["counts"]["tp"] > reg["baseline"]["counts"]["tp"]
            or elderly["candidate"]["counts"]["tp"] > elderly["baseline"]["counts"]["tp"],
        "clipMediansBelowBudget": all(row["inferenceMedianMs"] <= budget for row in rows),
        "noInferenceErrors": all(row.get("inferenceErrors") == [] for row in rows),
    }
    output["passed"] = all(output["gates"].values())
    (root / args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    with (root / Path(args.output).with_suffix(".csv")).open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(paired[0]))
        writer.writeheader()
        writer.writerows(paired)
    print(json.dumps({"gates": output["gates"], "passed": output["passed"],
        "regression": reg["candidate"]["counts"], "olderAdultClipEvents": elderly["candidate"]["counts"]["tp"]}))


if __name__ == "__main__":
    main()
