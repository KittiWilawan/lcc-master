"""Read the Android forest protocol for exact comparisons with shipped weights."""
import struct


class BinaryForest:
    def __init__(self, path, np):
        self.np = np
        with open(path, "rb") as stream:
            def read(format):
                size = struct.calcsize(format)
                value = stream.read(size)
                if len(value) != size:
                    raise ValueError("Truncated forest")
                return struct.unpack(format, value)
            self.version, self.feature_count, count = read(">iii")
            if self.version not in (1, 2) or self.feature_count <= 0 or count <= 0:
                raise ValueError("Invalid forest header")
            self.baseline = read(">d")[0] if self.version == 2 else 0.0
            self.trees = []
            for _ in range(count):
                nodes = read(">i")[0]
                if nodes <= 0:
                    raise ValueError("Empty tree")
                raw = [read(">iiidd") for _ in range(nodes)]
                left, right, feature, threshold, value = map(np.asarray, zip(*raw))
                leaf = left == -1
                if not np.isfinite(threshold).all() or not np.isfinite(value).all():
                    raise ValueError("Nonfinite forest")
                if ((left[~leaf] < 0) | (left[~leaf] >= nodes) | (right[~leaf] < 0) | (right[~leaf] >= nodes)).any():
                    raise ValueError("Invalid tree edges")
                if ((feature[~leaf] < 0) | (feature[~leaf] >= self.feature_count)).any():
                    raise ValueError("Invalid feature indices")
                self.trees.append((left, right, feature, threshold, value))
            if stream.read(1):
                raise ValueError("Unexpected forest trailing bytes")

    def _scores(self, features):
        np = self.np
        features = np.asarray(features, dtype=np.float32)
        if features.ndim != 2 or features.shape[1] != self.feature_count or not np.isfinite(features).all():
            raise ValueError("Invalid classifier input")
        score = np.full(len(features), self.baseline, dtype=np.float64)
        for left, right, feature, threshold, value in self.trees:
            index = np.zeros(len(features), dtype=np.int64)
            active = np.arange(len(features))
            for _ in range(len(left)):
                leaf = left[index[active]] == -1
                finished = active[leaf]
                score[finished] += value[index[finished]]
                active = active[~leaf]
                if not len(active):
                    break
                node = index[active]
                index[active] = np.where(features[active, feature[node]] <= threshold[node], left[node], right[node])
            else:
                raise ValueError("Cyclic forest")
        return score

    def decision_function(self, features):
        if self.version != 2:
            raise ValueError("Decision margins require gradient forests")
        return self._scores(features)

    def predict_proba(self, features):
        np = self.np
        score = self._scores(features)
        if self.version == 2:
            probability = np.empty_like(score)
            positive = score >= 0
            probability[positive] = 1/(1+np.exp(-score[positive]))
            exponential = np.exp(score[~positive])
            probability[~positive] = exponential/(1+exponential)
        else:
            probability = score/len(self.trees)
        return np.column_stack((1-probability, probability))
