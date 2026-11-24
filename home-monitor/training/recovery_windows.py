"""Tag temporal windows that contain fresh recovered observations, preserving window semantics."""


def recovery_windows(record, runtime, model):
    history, previous = [], None
    recovered = set(record.get("recovery", {}).get("positionsMs", []))
    count = model["framesPerWindow"]
    for timestamp, frame in zip(record["timestampsMs"], record["frames"]):
        if previous is not None and timestamp-previous > runtime["maxPoseGapMs"]:
            history.clear()
        if frame[-1] <= 0:
            continue
        previous = timestamp
        history.append((timestamp, frame, timestamp in recovered))
        history = [item for item in history if timestamp-item[0] <= runtime["maxWindowAgeMs"]][-count:]
        if len(history) < runtime["minTrackFrames"]:
            continue
        observed = [item[1] for item in history]
        if len(observed) < count:
            if runtime["initialWindowPolicy"] != "repeat_initial":
                continue
            observed = [observed[0]]*(count-len(observed))+observed
        yield timestamp, observed, any(item[2] for item in history)


def confirmed(scores, threshold, runtime):
    count, last = 0, None
    for timestamp, score in scores:
        if last is not None and timestamp-last > runtime["confirmationMaxGapMs"]:
            count = 0
        if score >= threshold:
            count += 1; last = timestamp
        else:
            count = 0
        if count >= runtime["confirmations"]:
            return timestamp
    return None
