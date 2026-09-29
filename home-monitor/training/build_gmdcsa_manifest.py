import argparse
import csv
import json
from collections import Counter
from pathlib import Path


DATASET_NAME = "GMDCSA24"
DATASET_LICENSE = "CC BY 4.0"
DATASET_DOI = "10.5281/zenodo.12921216"


def read_arguments():
    parser = argparse.ArgumentParser(description="Build a subject-separated GMDCSA24 manifest")
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--validation-subject", type=int, required=True)
    parser.add_argument("--test-subject", type=int, required=True)
    return parser.parse_args()


def subject_id_from_path(video_path):
    for part in video_path.parts:
        if not part.startswith("Subject "):
            continue
        value = part.removeprefix("Subject ")
        if value.isdigit():
            return int(value)
    raise ValueError(f"Cannot read subject from {video_path}")


def label_from_path(video_path):
    folder = video_path.parent.name.casefold()
    if folder == "fall":
        return "fall"
    if folder == "adl":
        return "normal"
    raise ValueError(f"Cannot read label from {video_path}")


def split_for_subject(subject_id, validation_subject, test_subject):
    if subject_id == validation_subject:
        return "validation"
    if subject_id == test_subject:
        return "test"
    return "train"


def build_rows(dataset_root, validation_subject, test_subject):
    rows = []
    for video_path in sorted(dataset_root.rglob("*.mp4")):
        subject_id = subject_id_from_path(video_path)
        rows.append({
            "video_path": str(video_path.resolve()),
            "label": label_from_path(video_path),
            "subject_id": subject_id,
            "split": split_for_subject(subject_id, validation_subject, test_subject),
            "source": DATASET_NAME,
            "license": DATASET_LICENSE,
            "doi": DATASET_DOI,
        })
    return rows


def summarize(rows):
    summary = {}
    for split in ("train", "validation", "test"):
        selected = [row for row in rows if row["split"] == split]
        labels = Counter(row["label"] for row in selected)
        summary[split] = {
            "subjects": sorted({row["subject_id"] for row in selected}),
            "videos": len(selected),
            "falls": labels["fall"],
            "normal": labels["normal"],
        }
    return summary


def write_manifest(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main():
    args = read_arguments()
    if args.validation_subject == args.test_subject:
        raise ValueError("Validation and test subjects must be different")
    rows = build_rows(args.dataset_root.resolve(), args.validation_subject, args.test_subject)
    if not rows:
        raise RuntimeError("No GMDCSA24 videos were found")
    subjects = {row["subject_id"] for row in rows}
    required = {args.validation_subject, args.test_subject}
    if not required.issubset(subjects):
        raise ValueError("Validation or test subject is missing from the dataset")
    summary = summarize(rows)
    if any(summary[split]["videos"] == 0 for split in summary):
        raise ValueError("Every split must contain videos")
    args.output_root.mkdir(parents=True, exist_ok=True)
    write_manifest(args.output_root / "manifest.csv", rows)
    (args.output_root / "manifest.json").write_text(
        json.dumps({"dataset": DATASET_NAME, "summary": summary}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
