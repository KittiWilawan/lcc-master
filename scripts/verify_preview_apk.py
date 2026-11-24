"""Verify APK packaging without claiming that Android runtime tests were run."""

import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def elf_alignments(name, data):
    assert data[:4] == b'\x7fELF' and data[4] == 2, name
    endian = '<' if data[5] == 1 else '>'
    offset = struct.unpack_from(endian + 'Q', data, 32)[0]
    size, count = struct.unpack_from(endian + 'HH', data, 54)
    alignments = []
    for index in range(count):
        values = struct.unpack_from(endian + 'IIQQQQQQ', data, offset + size * index)
        if values[0] == 1:
            assert values[7] >= 16384 and (values[3] - values[2]) % 16384 == 0, name
            alignments.append(values[7])
    assert alignments, name
    return alignments


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--previous-verification', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--native-audit', type=Path)
    args = parser.parse_args()
    app = json.loads(Path('app.json').read_text(encoding='utf-8'))['expo']
    previous = json.loads(args.previous_verification.read_text(encoding='utf-8'))
    certificate = previous['certificateSha256']
    signature = (args.output.parent / 'apk-signature.log').read_text(encoding='utf-8-sig')
    metadata = (args.output.parent / 'apk-metadata.log').read_text(encoding='utf-8-sig')
    alignment = (args.output.parent / 'apk-zipalign.log').read_text(encoding='utf-8-sig')
    assert certificate in signature, 'Signing certificate differs from the previous APK'
    assert 'Verifies' in signature, 'APK signature was not verified'
    expected_metadata = (f"name='{app['android']['package']}' "
                         f"versionCode='{app['android']['versionCode']}' "
                         f"versionName='{app['version']}'")
    assert expected_metadata in metadata, 'APK package/version differs from source'
    assert "native-code: 'arm64-v8a'" in metadata, 'Unexpected ABI'
    assert 'application-debuggable' not in metadata, 'APK is debuggable'
    assert 'Verification successful' in alignment, 'ZIP alignment was not verified'
    fixtures_root = Path('android/app/src/androidTest/assets')
    fixtures = {digest(path.read_bytes()) for path in fixtures_root.rglob('*') if path.is_file()}
    source_assets = Path('android/app/src/main/assets')
    scan_bytes = Path('src/config/faceScan.json').read_bytes()
    scan = json.loads(scan_bytes)
    source_hashes, libraries = {}, []
    with zipfile.ZipFile(args.apk) as archive:
        assert archive.testzip() is None, 'APK contains a corrupted ZIP entry'
        for path in source_assets.rglob('*'):
            if path.is_file():
                name = 'assets/' + path.relative_to(source_assets).as_posix()
                content = archive.read(name)
                assert content == path.read_bytes(), f'Source asset differs: {name}'
                source_hashes[name] = digest(content)
        assert archive.read('assets/enrollment/scan.json') == scan_bytes
        for model in [scan['model'], scan['security']['identity']] + scan['security']['passiveModels']:
            name = 'assets/' + model['asset']
            assert digest(archive.read(name)) == model['sha256'], f'Model hash differs: {name}'
        bundle_bytes = len(archive.read('assets/index.android.bundle'))
        with zipfile.ZipFile(previous['file']) as older:
            previous_bundle_bytes = len(older.read('assets/index.android.bundle'))
        assert bundle_bytes >= previous_bundle_bytes // 2, 'Bundle is unexpectedly small for the full app'
        for name in archive.namelist():
            if name.endswith(('.jpg', '.jpeg', '.png')):
                assert digest(archive.read(name)) not in fixtures, 'Test image was packaged'
            assert not name.endswith(('.jks', '.keystore')), 'Signing keystore was packaged'
            if name.endswith('.so'):
                assert name.startswith('lib/arm64-v8a/'), f'Unexpected ABI: {name}'
                libraries.append({'name': name, 'loadAlignments': elf_alignments(name, archive.read(name))})
    assert source_hashes and libraries
    native_assets_match = False
    if args.native_audit:
        with zipfile.ZipFile(args.native_audit) as audited, zipfile.ZipFile(args.apk) as packaged:
            for name in source_hashes:
                current = packaged.read(name)
                tested = audited.read(name)
                if name == 'assets/monitoring/model.json':
                    current_metadata = json.loads(current)
                    for annotation in ('landmarkerSha256', 'landmarkerFamily'):
                        current_metadata.pop(annotation, None)
                    assert current_metadata == json.loads(tested), 'Inference configuration differs from the audit'
                elif name.endswith('.json'):
                    assert json.loads(current) == json.loads(tested), f'Audited configuration differs: {name}'
                else:
                    assert current == tested, f'Audited asset differs: {name}'
            assert json.loads(packaged.read('assets/monitoring/runtime.json')) == json.loads(audited.read('assets/monitoring/runtime.json'))
        native_assets_match = True
    runtime = json.loads((source_assets / 'monitoring/runtime.json').read_text(encoding='utf-8'))
    result = {
        'file': str(args.apk.resolve()), 'releaseStatus': 'preview',
        'package': app['android']['package'], 'version': app['version'],
        'versionCode': app['android']['versionCode'], 'bytes': args.apk.stat().st_size,
        'sha256': digest(args.apk.read_bytes()), 'certificateSha256': certificate,
        'sourceAssetsMatch': source_hashes, 'libraries': libraries,
        'javascriptBundleBytes': bundle_bytes, 'testFixturesAbsent': True,
        'elf16KB': True, 'zipAlignment16KB': True,
        'firebaseConfigPresent': Path('android/app/google-services.json').is_file(),
        'poseRecoveryEnabled': runtime['poseRecoveryEnabled'],
        'newNativeRuntimeTestsExecuted': False,
        'nativeAuditAssetsMatch': native_assets_match,
        'nativeAuditScope': 'model bytes and parsed configuration; see native test report' if native_assets_match else None,
        'arm64RuntimeTestsExecuted': False,
        'crossDevicePushVerified': False,
    }
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in ('sourceAssetsMatch', 'libraries')}, indent=2))


if __name__ == '__main__':
    main()
