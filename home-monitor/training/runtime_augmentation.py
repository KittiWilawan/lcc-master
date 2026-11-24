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
    if "rotationRangeDegrees" in specification:
        lower, upper = specification["rotationRangeDegrees"]
        if not np.isfinite([lower, upper]).all() or not -180 <= lower <= upper <= 180:
            raise ValueError("Invalid camera rotation range")
        angle = np.deg2rad(rng.uniform(lower, upper))
        rotation = np.asarray([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]], dtype=np.float32)
        anchor = np.asarray(specification["anchor"], dtype=np.float32)
        if anchor.shape != (2,) or not np.isfinite(anchor).all():
            raise ValueError("Invalid camera anchor")
        geometry = count * 4
        for frame in result:
            coords = frame[:count * 3].reshape(count, 3)
            previous_scale = max(frame[geometry + 2], frame[geometry + 3], model["normalizationMinScale"])
            positions = coords[:, :2] * previous_scale + frame[geometry:geometry + 2]
            positions = (positions - anchor) @ rotation.T + anchor
            visible = frame[count * 3:count * 4] >= model["visibilityThreshold"]
            selected = positions[visible] if visible.any() else positions
            center = selected.astype(np.float64).mean(axis=0).astype(np.float32)
            dimensions = selected.max(axis=0) - selected.min(axis=0)
            new_scale = max(*dimensions, model["normalizationMinScale"])
            coords[:, :2] = (positions - center) / new_scale
            coords[:, 2] *= previous_scale / new_scale
            frame[geometry:geometry + 2] = center
            frame[geometry + 2:geometry + 4] = dimensions
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
