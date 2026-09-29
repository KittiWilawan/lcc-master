import argparse
from pathlib import Path

import numpy as np


def read_arguments():
    parser = argparse.ArgumentParser(description="Sample a balanced training split and retain evaluation splits")
    parser.add_argument("source_cache", type=Path)
    parser.add_argument("output_cache", type=Path)
    parser.add_argument("--train-count", type=int, required=True)
    parser.add_argument("--seed", type=int, default=20260926)
    return parser.parse_args()


def selected_indices(labels, splits, train_count, seed):
    evaluation = np.flatnonzero(splits != "train")
    per_label = train_count // 2
    generator = np.random.default_rng(seed)
    selected_train = []
    for label in (0, 1):
        candidates = np.flatnonzero((splits == "train") & (labels == label))
        count = min(per_label, len(candidates))
        selected_train.extend(generator.choice(candidates, size=count, replace=False).tolist())
    return np.concatenate((np.array(sorted(selected_train)), evaluation))


def main():
    args = read_arguments()
    if args.train_count < 2:
        raise ValueError("train-count must be at least two")
    cache = np.load(args.source_cache)
    indices = selected_indices(cache["labels"], cache["splits"], args.train_count, args.seed)
    args.output_cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output_cache,
        features=cache["features"][indices],
        labels=cache["labels"][indices],
        splits=cache["splits"][indices],
    )


if __name__ == "__main__":
    main()
