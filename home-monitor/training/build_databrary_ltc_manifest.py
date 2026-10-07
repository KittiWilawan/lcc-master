import argparse
import csv
import json
from collections import Counter
from pathlib import Path


SOURCE_NAME = "Databrary older adults falls dataset"
SOURCE_DOI = "10.17910/B7.739"
SPLIT_RATIOS = {"train": 0.6, "validation": 0.2, "test": 0.2}


def read_arguments():
    parser = argparse.ArgumentParser(description="Build a participant-separated Databrary LTC fall manifest")
    parser.add_argument("metadata", type=Path)
    parser.add_argument("videos_root", type=Path)
    parser.add_argument("output_root", type=Path)
    return parser.parse_args()


def assign_participants(records):
    video_counts = Counter(record["participant_id"] for record in records)
    targets = {name: len(records) * ratio for name, ratio in SPLIT_RATIOS.items()}
    assigned_counts = {name: 0 for name in SPLIT_RATIOS}
    assignments = {}
    ordered = sorted(video_counts.items(), key=lambda item: (-item[1], item[0]))
    for participant_id, count in ordered:
        split = max(
            SPLIT_RATIOS,
            key=lambda name: (targets[name] - assigned_counts[name], -assigned_counts[name], name),
        )
        assignments[participant_id] = split
        assigned_counts[split] += count
    return assignments


def build_rows(records, videos_root):
    assignments = assign_participants(records)
    rows = []
    for record in records:
        video_path = (videos_root / record["video_name"]).resolve()
        if not video_path.exists():
            raise FileNotFoundError(video_path)
        rows.append({
            "video_path": str(video_path),
            "label": "fall",
            "split": assignments[record["participant_id"]],
            "participant_id": record["participant_id"],
            "age": record["age"],
            "sex": record["sex"],
            "session_id": record["session_id"],
            "source": SOURCE_NAME,
            "doi": SOURCE_DOI,
        })
    return sorted(rows, key=lambda row: (row["split"], row["participant_id"], row["session_id"]))


def summarize(rows):
    return {
        split: {
            "videos": sum(row["split"] == split for row in rows),
            "participants": len({row["participant_id"] for row in rows if row["split"] == split}),
            "participant_ids": sorted({
                row["participant_id"] for row in rows if row["split"] == split
            }),
        }
        for split in SPLIT_RATIOS
    }


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as destination:
        writer = csv.DictWriter(destination, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def main():
    args = read_arguments()
    records = json.loads(args.metadata.read_text(encoding="utf-8-sig"))
    rows = build_rows(records, args.videos_root)
    summary = summarize(rows)
    args.output_root.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_root / "manifest.csv", rows)
    (args.output_root / "manifest.json").write_text(
        json.dumps({"source": SOURCE_NAME, "doi": SOURCE_DOI, "summary": summary}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
