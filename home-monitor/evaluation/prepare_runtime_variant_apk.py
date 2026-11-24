"""Prepare a config-only audit APK; align and sign with the audit key afterwards."""
import argparse
import hashlib
import json
import zipfile
from copy import copy
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("runtime", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--asset-manifest", type=Path)
    args = parser.parse_args()
    if args.apk.resolve() == args.output.resolve():
        raise ValueError("Preserve the original APK")
    runtime = args.runtime.read_bytes()
    json.loads(runtime.decode("utf-8"))
    asset = "assets/monitoring/runtime.json"
    replacements = {asset: runtime}
    if args.asset_manifest:
        additions = json.loads(args.asset_manifest.read_text(encoding="utf-8"))
        for name, source in additions.items():
            if not name.startswith("assets/monitoring/") or ".." in name.split("/") or "\\" in name:
                raise ValueError("Only monitoring assets may be replaced")
            replacements[name] = Path(source).read_bytes()
    preserved = {}
    with zipfile.ZipFile(args.apk) as original, zipfile.ZipFile(args.output, "w") as modified:
        if asset not in original.namelist():
            raise ValueError("Monitoring runtime asset missing")
        for member in original.infolist():
            name = member.filename
            if name.startswith("META-INF/") and (name.endswith((".SF", ".RSA", ".DSA", ".EC")) or name == "META-INF/MANIFEST.MF"):
                continue
            value = replacements.get(name, original.read(name))
            rebuilt = copy(member)
            # Padding belongs to the old ZIP offsets; zipalign regenerates it.
            rebuilt.extra = b''
            modified.writestr(rebuilt, value)
            if name not in replacements:
                preserved[name] = hashlib.sha256(value).hexdigest()
        for name, value in replacements.items():
            if name not in original.namelist():
                modified.writestr(name, value, compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(args.output) as archive:
        if any(hashlib.sha256(archive.read(name)).hexdigest() != digest for name, digest in preserved.items()):
            raise ValueError("Config-only variant changed executable/model bytes")
    args.output.with_suffix(".json").write_text(json.dumps({"original": str(args.apk.resolve()),
        "runtime": str(args.runtime.resolve()), "runtimeSha256": hashlib.sha256(runtime).hexdigest(),
        "unchangedMembers": preserved, "changedAssets": {name: hashlib.sha256(value).hexdigest() for name,value in replacements.items()},
        "requiresAlignmentAndAuditSigning": True}, indent=2), encoding="utf-8")
    print(json.dumps({"unchangedMembers": len(preserved), "runtimeOnlyChanged": len(replacements)==1}))


if __name__ == "__main__":
    main()
