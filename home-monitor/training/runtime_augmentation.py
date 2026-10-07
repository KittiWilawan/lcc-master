"""Coherent pose-window augmentation; parameters and landmark mapping come from config."""


def augment_window(observed, model, specification, rng, np):
    result = np.asarray(observed, dtype=np.float32).copy()
    count = model["landmarkCount"]
    if specification.get("mirror", False):
        permutation = specification["landmarkPermutation"]
        if sorted(permutation) != list(range(count)):
            raise ValueError("Mirror must preserve every landmark exactly once")
        coordinates = result[:, :count * 3].reshape(len(result), count, 3).copy()
        coordinates = coordinates[:, permutation, :]
        coordinates[:, :, 0] *= -1
        result[:, :count * 3] = coordinates.reshape(len(result), count * 3)
        result[:, count * 3:count * 4] = result[:, count * 3:count * 4][:, permutation]
        result[:, count * 4] = 1 - result[:, count * 4]
    if "scaleRange" in specification:
        lower, upper = specification["scaleRange"]
        if not 0 < lower <= upper:
            raise ValueError("Invalid camera scale range")
        scale = rng.uniform(lower, upper)
        anchor = np.asarray(specification["anchor"], dtype=np.float32)
        shift = rng.uniform(-specification["translationRange"], specification["translationRange"], size=2)
        geometry = count * 4
        # One camera transform for all observations; preserve skeleton and temporal direction.
        result[:, geometry:geometry + 2] = (result[:, geometry:geometry + 2] - anchor) * scale + anchor + shift
        result[:, geometry + 2:geometry + 4] *= scale
    return result


def balanced_clip_weights(clip_ids, sources, source_weights, np):
    from collections import Counter
    counts = Counter(clip_ids)
    weights = np.asarray([1 / counts[clip] for clip in clip_ids], dtype=np.float64)
    source_array = np.asarray(sources)
    for source in set(sources):
        selected = source_array == source
        weights[selected] *= source_weights[source] / weights[selected].sum()
    return weights / weights.mean()


def difficulty_multipliers(labels, scores, specification, np):
    labels = np.asarray(labels)
    scores = np.asarray(scores)
    if not np.isfinite(scores).all() or (scores < 0).any() or (scores > 1).any():
        raise ValueError("Invalid held-fold training scores")
    return np.where(labels == 0,
        specification["normalWeight"] * (1 + specification["negativeFactor"] * scores ** specification["power"]),
        1 + specification["positiveFactor"] * (1 - scores) ** specification["power"])
