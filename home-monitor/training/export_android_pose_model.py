"""Export a trusted, locally trained tree ensemble for the Android runtime.

No retraining or accuracy claim is made here. The feature transform and tree
probabilities must match sklearn before the exported assets are accepted.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import joblib
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("landmarker", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--threshold", type=float, required=True)
    parser.add_argument("--metadata-template", type=Path)
    args = parser.parse_args()
    artifact = joblib.load(args.model)
    template = json.loads(args.metadata_template.read_text(encoding="utf-8")) if args.metadata_template else None
    model = artifact["model"]
    if not np.array_equal(model.classes_, [0, 1]):
        raise ValueError("Only binary classifiers can be exported")
    gradient = type(model).__name__ == "HistGradientBoostingClassifier"
    if not gradient and not hasattr(model, "estimators_"):
        raise ValueError("Only tree ensembles can be exported")
    args.output.mkdir(parents=True, exist_ok=True)
    trees = []
    with (args.output / "fall_forest.bin").open("wb") as output:
        estimators = model._predictors if gradient else model.estimators_
        output.write(struct.pack(">iii", 2 if gradient else 1, int(model.n_features_in_), len(estimators)))
        baseline = float(model._baseline_prediction[0, 0]) if gradient else 0.0
        if gradient:
            output.write(struct.pack(">d", baseline))
        for estimator in estimators:
            if gradient:
                nodes = estimator[0].nodes
                if nodes["is_categorical"].any():
                    raise ValueError("Categorical tree splits are not supported")
                left = np.where(nodes["is_leaf"], -1, nodes["left"].astype(np.int64))
                right = np.where(nodes["is_leaf"], -1, nodes["right"].astype(np.int64))
                feature = nodes["feature_idx"]
                thresholds = nodes["num_threshold"]
                probabilities = nodes["value"]
            else:
                tree = estimator.tree_
                left, right, feature, thresholds = tree.children_left, tree.children_right, tree.feature, tree.threshold
                values = tree.value[:, 0, :]
                probabilities = values[:, 1] / values.sum(axis=1)
            output.write(struct.pack(">i", len(left)))
            for index in range(len(left)):
                output.write(struct.pack(">iiidd", int(left[index]), int(right[index]), int(feature[index]),
                                         float(thresholds[index]), float(probabilities[index])))
            trees.append((left, right, feature, thresholds, probabilities))
    samples = np.random.default_rng(0).normal(size=(64, model.n_features_in_)).astype(np.float32)
    actual = []
    for sample in samples:
        scores = []
        for left, right, feature, thresholds, probabilities in trees:
            node = 0
            while left[node] != -1:
                node = left[node] if sample[feature[node]] <= thresholds[node] else right[node]
            scores.append(probabilities[node])
        actual.append(1.0 / (1.0 + np.exp(-(baseline + sum(scores)))) if gradient else np.mean(scores))
    error = float(np.max(np.abs(model.predict_proba(samples)[:, 1] - actual)))
    if error > 1e-12:
        raise ValueError(f"Export parity failed: {error}")
    (args.output / "pose_landmarker_lite.task").write_bytes(args.landmarker.read_bytes())
    metadata = {
        "formatVersion": 2 if gradient else 1,
        "modelAsset": "monitoring/fall_forest.bin",
        "landmarkerAsset": "monitoring/pose_landmarker_lite.task",
        "featureVariant": artifact["feature_variant"],
        "framesPerWindow": int(artifact["frames_per_video"]),
        "featureCount": int(model.n_features_in_),
        "landmarkCount": 33,
        "visibilityThreshold": 0.35,
        "normalizationMinScale": 0.05,
        "fallThreshold": args.threshold,
        "sourceSha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
        "exportParityMaxError": error,
        "validationScope": "Tree export parity only; Android streaming accuracy requires separate validation",
    }
    if template is not None:
        for key in ("landmarkCount", "visibilityThreshold", "normalizationMinScale"):
            metadata[key] = template[key]
        if "normalization" in artifact and any(artifact["normalization"][key] != metadata[key] for key in artifact["normalization"]):
            raise ValueError("Export normalization does not match training")
        metadata["trainingProtocol"] = "chronological_runtime_windows"
    (args.output / "model.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (args.output / "parity.json").write_text(json.dumps({
        "features": samples.tolist(), "probabilities": actual,
    }), encoding="utf-8")
    print(json.dumps({"model": type(model).__name__, "variant": metadata["featureVariant"],
                      "frames": metadata["framesPerWindow"], "parityMaxError": error,
                      "modelBytes": (args.output / "fall_forest.bin").stat().st_size}))


if __name__ == "__main__":
    main()
