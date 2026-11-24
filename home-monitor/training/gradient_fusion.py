"""Weighted gradient margins exported as one existing Android forest, without runtime rules."""
import math
from pathlib import Path
import struct
import sys

from binary_forest import BinaryForest


def sigmoid(margin, np):
    output = np.empty_like(margin, dtype=np.float64)
    positive = margin >= 0
    output[positive] = 1/(1+np.exp(-margin[positive]))
    exponential = np.exp(margin[~positive])
    output[~positive] = exponential/(1+exponential)
    return output


def merge_forests(sources, output, np):
    weights = [weight for _, weight in sources]
    if not sources or any(not math.isfinite(weight) or weight < 0 for weight in weights) or not math.isclose(sum(weights), 1, rel_tol=0, abs_tol=sys.float_info.epsilon*len(weights)):
        raise ValueError("Fusion coefficients must be nonnegative and sum to one")
    models = [(BinaryForest(path, np), weight) for path, weight in sources if weight > 0]
    feature_count = models[0][0].feature_count
    if any(model.version != 2 or model.feature_count != feature_count for model, _ in models):
        raise ValueError("Fusion requires compatible gradient forests")
    with Path(output).open("wb") as stream:
        stream.write(struct.pack(">iiid", 2, feature_count, sum(len(model.trees) for model, _ in models),
            sum(model.baseline*weight for model, weight in models)))
        for model, weight in models:
            for left, right, feature, threshold, value in model.trees:
                stream.write(struct.pack(">i", len(left)))
                for i in range(len(left)):
                    stream.write(struct.pack(">iiidd", int(left[i]), int(right[i]), int(feature[i]), float(threshold[i]), float(value[i]*weight)))


class GradientFusion:
    def __init__(self, sources, np):
        self.sources = sources
        self.np = np

    def decision_function(self, features):
        return sum(weight*model.decision_function(features) for model, weight in self.sources)

    def predict_proba(self, features):
        probability = sigmoid(self.decision_function(features), self.np)
        return self.np.column_stack((1-probability, probability))
