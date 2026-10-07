"""Check packaged model/config and ELF alignment without extracting executable files."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("assets", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk) as archive:
        assets = {}
        for name in ("runtime.json", "cloud.json", "model.json", "fall_forest.bin", "pose_landmarker_lite.task"):
            packaged = archive.read(f"assets/monitoring/{name}")
            original = (args.assets / name).read_bytes()
            if packaged != original:
                raise RuntimeError(f"Packaged asset differs: {name}")
            assets[name] = hashlib.sha256(packaged).hexdigest()
        libraries = []
        for name in archive.namelist():
            if not name.startswith("lib/") or not name.endswith(".so"):
                continue
            data = archive.read(name)
            if data[:4] != b"\x7fELF" or data[4] != 2:
                raise RuntimeError(f"Expected 64 bit ELF: {name}")
            endian = "<" if data[5] == 1 else ">"
            offset = struct.unpack_from(endian + "Q", data, 32)[0]
            size, count = struct.unpack_from(endian + "HH", data, 54)
            alignments = []
            for index in range(count):
                values = struct.unpack_from(endian + "IIQQQQQQ", data, offset + index * size)
                if values[0] == 1:
                    alignment = values[7]
                    if alignment < 16384 or (values[3] - values[2]) % 16384:
                        raise RuntimeError(f"ELF not aligned for 16 KB: {name}")
                    alignments.append(alignment)
            libraries.append({"name": name, "loadAlignments": alignments})
        result = {"apkSha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
                  "bytes": args.apk.stat().st_size, "assetsMatch": assets,
                  "libraries": libraries, "elf16KB": True}
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"assetsMatch": len(assets), "libraries": len(libraries), "elf16KB": True}))


if __name__ == "__main__":
    main()
