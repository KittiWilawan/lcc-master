import argparse
from pathlib import Path

import numpy as np


LABEL_VALUES = {"normal": 0, "fall": 1}


def read_arguments():
    parser = argparse.ArgumentParser(description="Keep one label from training while preserving validation and test")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--training-label", choices=tuple(LABEL_VALUES), required=True)
    return parser.parse_args()


def main():
    args = read_arguments()
    cache = np.load(args.source)
    labels = cache["labels"]
    splits = cache["splits"]
    selected_label = LABEL_VALUES[args.training_label]
    selected = (splits != "train") | (labels == selected_label)
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.destination,
        features=cache["features"][selected],
        labels=labels[selected],
        splits=splits[selected],
    )
    print({
        "kept": int(np.sum(selected)),
        "removed": int(np.sum(~selected)),
        "training_label": args.training_label,
    })


if __name__ == "__main__":
    main()
