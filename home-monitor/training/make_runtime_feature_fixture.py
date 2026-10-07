"""Generate real training-window parity fixtures without images or identities."""
import argparse
import json
import sys
from pathlib import Path

from train_runtime_classifier import transform, windows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--count", type=int, required=True)
    args = parser.parse_args()
    if args.count <= 0:
        raise ValueError("Positive fixture count required")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    sys.path.insert(0, config["mlLibraries"])
    import joblib
    import numpy as np
    artifact = joblib.load(args.model)
    model = json.loads(Path(config["modelMetadata"]).read_text(encoding="utf-8"))
    runtime = json.loads(Path(config["runtimeAsset"]).read_text(encoding="utf-8"))
    fixtures = []
    for line in Path(config["checkpoint"]).read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record["case"]["split"] != "train":
            continue
        observed = list(windows(record, runtime, model))
        if not observed:
            continue
        _, frames = observed[-1]
        vector = transform(frames, model, np)
        probability = float(artifact["model"].predict_proba(vector.reshape(1, -1))[0, 1])
        fixtures.append({"frames": frames, "features": vector.tolist(), "probability": probability})
        if len(fixtures) == args.count:
            break
    if len(fixtures) != args.count:
        raise ValueError("Insufficient real windows for parity")
    args.output.write_text(json.dumps(fixtures), encoding="utf-8")
    print(json.dumps({"parityWindows": len(fixtures), "bytes": args.output.stat().st_size}))


if __name__ == "__main__":
    main()
