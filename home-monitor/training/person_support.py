"""Optional independent person support for a pose, without inventing absent observations."""
import math


def valid_bounds(bounds):
    return (len(bounds) == 4 and all(math.isfinite(value) for value in bounds)
        and 0 <= bounds[0] < bounds[2] <= 1 and 0 <= bounds[1] < bounds[3] <= 1)


def overlap_fraction(first, second):
    if not valid_bounds(first) or not valid_bounds(second):
        raise ValueError("Invalid normalized person bounds")
    intersection = max(0, min(first[2], second[2])-max(first[0], second[0])) * max(
        0, min(first[3], second[3])-max(first[1], second[1]))
    area = min((first[2]-first[0])*(first[3]-first[1]), (second[2]-second[0])*(second[3]-second[1]))
    return intersection / area


def pose_bounds(frame, model):
    count = model["landmarkCount"]
    if len(frame) != count*4+6 or not all(math.isfinite(value) for value in frame):
        return None
    if frame[-1] <= 0:
        return None
    offset = count*4
    scale = max(frame[offset+2], frame[offset+3], model["normalizationMinScale"])
    visible = [(frame[i*3]*scale+frame[offset], frame[i*3+1]*scale+frame[offset+1])
        for i in range(count) if frame[count*3+i] >= model["visibilityThreshold"]]
    if not visible:
        return None
    bounds = [max(0, min(x for x, _ in visible)), max(0, min(y for _, y in visible)),
        min(1, max(x for x, _ in visible)), min(1, max(y for _, y in visible))]
    return bounds if valid_bounds(bounds) else None


def support(pose, people, minimum_confidence, minimum_overlap):
    if not 0 < minimum_confidence <= 1 or not 0 < minimum_overlap <= 1:
        raise ValueError("Invalid support policy")
    reliable = [person["bounds"] for person in people if math.isfinite(person["confidence"])
        and person["confidence"] >= minimum_confidence and valid_bounds(person["bounds"])]
    if pose is None or not valid_bounds(pose) or not reliable:
        return "unknown"
    return "supported" if any(overlap_fraction(pose, box) >= minimum_overlap for box in reliable) else "contradicted"
