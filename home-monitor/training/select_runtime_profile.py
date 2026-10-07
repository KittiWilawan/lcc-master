"""Freeze a profile using validation only, before exposing held test results."""
import argparse
import hashlib
import json
from pathlib import Path

from train_runtime_classifier import rank


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("configs", nargs="+", type=Path)
    args = parser.parse_args()
    profiles = []
    cohort = None
    for path in args.configs:
        config = json.loads(path.read_text(encoding="utf-8"))
        result = json.loads((Path(config["output"]) / "training-results.json").read_text(encoding="utf-8"))
        current = result["checkpointSha256"], result["partitionClips"]["validation"]
        if cohort is not None and cohort != current:
            raise ValueError("Profiles used different validation collections")
        cohort = current
        selected = result["validationCandidates"][result["selected"]]
        if not selected["fitsMobileBudget"]:
            raise ValueError("Selected model exceeds mobile budget")
        profiles.append({"config": str(path.resolve()), "model": str((Path(config["output"]) / "runtime-pose-classifier.joblib").resolve()),
            "name": result["selected"], "rank": rank(selected["metrics"]), "validation": selected["metrics"],
            "threshold": selected["threshold"], "modelMetadata": config["modelMetadata"], "runtimeAsset": config["runtimeAsset"],
            "nativeBytes": selected["estimatedNativeBytes"]})
    winner = max(profiles, key=lambda profile: profile["rank"])
    winner["sha256"] = hashlib.sha256(Path(winner["model"]).read_bytes()).hexdigest()
    args.output.write_text(json.dumps({"rule": "validation rank only, no held test values used", "profiles": profiles,
        "selected": winner}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(winner, ensure_ascii=False))


if __name__ == "__main__":
    main()
