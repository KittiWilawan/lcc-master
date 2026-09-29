import argparse
import csv
import json
import random
from collections import Counter
from pathlib import Path


def read_arguments():
    parser = argparse.ArgumentParser(description="Build a subject-separated fall video manifest")
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--train-ratio", type=float, default=0.62)
    parser.add_argument("--validation-ratio", type=float, default=0.17)
    parser.add_argument("--seed", type=int, default=20260926)
    return parser.parse_args()


def validate_ratios(train_ratio, validation_ratio):
    if train_ratio <= 0 or validation_ratio <= 0 or train_ratio + validation_ratio >= 1:
        raise ValueError("Train and validation ratios must be positive and leave room for a test split")


def read_cases(dataset_root):
    cases = []
    for label_folder, label in (("Fall", "fall"), ("ADL", "normal")):
        for video_path in sorted((dataset_root / label_folder).rglob("*.mp4")):
            metadata_path = video_path.parent / "metadata.json"
            if not metadata_path.exists():
                continue
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            cases.append({
                "video_path": str(video_path.resolve()),
                "label": label,
                "subject_id": int(metadata["subjectId"]),
                "location_id": int(metadata["locationId"]),
                "action_id": int(metadata["actionId"]),
                "side": str(metadata["side"]),
                "attempt": int(metadata["attempt"]),
                "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects",
                "license": "CC BY 4.0",
                "doi": "10.6084/m9.figshare.28596332.v2",
            })
    return cases


def subject_splits(subjects, train_ratio, validation_ratio, seed):
    shuffled = list(subjects)
    random.Random(seed).shuffle(shuffled)
    train_count = round(len(shuffled) * train_ratio)
    validation_count = round(len(shuffled) * validation_ratio)
    return {
        "train": set(shuffled[:train_count]),
        "validation": set(shuffled[train_count:train_count + validation_count]),
        "test": set(shuffled[train_count + validation_count:]),
    }


def assign_split(subject_id, splits):
    for split, subject_ids in splits.items():
        if subject_id in subject_ids:
            return split
    raise ValueError(f"Subject {subject_id} is missing from all splits")


def build_summary(cases, splits):
    summary = {}
    for split, subject_ids in splits.items():
        split_cases = [item for item in cases if item["split"] == split]
        labels = Counter(item["label"] for item in split_cases)
        summary[split] = {
            "subjects": sorted(subject_ids),
            "subject_count": len(subject_ids),
            "videos": len(split_cases),
            "falls": labels["fall"],
            "normal": labels["normal"],
            "locations": sorted({item["location_id"] for item in split_cases}),
        }
    return summary


def write_csv(path, cases):
    fieldnames = list(cases[0].keys())
    with path.open("w", newline="", encoding="utf-8-sig") as destination:
        writer = csv.DictWriter(destination, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cases)


def main():
    args = read_arguments()
    validate_ratios(args.train_ratio, args.validation_ratio)
    cases = read_cases(args.dataset_root.resolve())
    if not cases:
        raise RuntimeError("No labeled videos were found")
    subjects = sorted({item["subject_id"] for item in cases})
    splits = subject_splits(subjects, args.train_ratio, args.validation_ratio, args.seed)
    for item in cases:
        item["split"] = assign_split(item["subject_id"], splits)
    cases.sort(key=lambda item: (item["split"], item["subject_id"], item["label"], item["video_path"]))
    summary = build_summary(cases, splits)
    args.output_root.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_root / "manifest.csv", cases)
    (args.output_root / "manifest.json").write_text(
        json.dumps({"seed": args.seed, "summary": summary, "cases": cases}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
