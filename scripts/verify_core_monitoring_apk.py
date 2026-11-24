"""Compare release assets to source and the native-tested APK; inspect signing evidence."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--tested', type=Path, required=True)
    parser.add_argument('--previous-verification', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    app = json.loads(Path('app.json').read_text(encoding='utf-8'))['expo']
    certificate = json.loads(args.previous_verification.read_text(encoding='utf-8'))['certificateSha256']
    signature = (args.output.parent / 'apk-signature.log').read_text(encoding='utf-8-sig')
    metadata = (args.output.parent / 'apk-metadata.log').read_text(encoding='utf-8-sig')
    assert certificate in signature, 'Signing certificate changed'
    assert f"name='{app['android']['package']}' versionCode='{app['android']['versionCode']}' versionName='{app['version']}'" in metadata
    assert "native-code: 'arm64-v8a'" in metadata
    scan_bytes = Path('src/config/faceScan.json').read_bytes()
    scan = json.loads(scan_bytes)
    fixtures = {digest(path.read_bytes()) for path in Path('android/app/src/androidTest/assets').rglob('*') if path.is_file()}
    fixture_root = args.output.parent / 'face-fixtures'
    fixtures.update(digest(path.read_bytes()) for path in fixture_root.rglob('*.jpg'))
    monitoring = {}
    models = {}
    libraries = []
    with zipfile.ZipFile(args.apk) as release, zipfile.ZipFile(args.tested) as tested:
        assert release.read('assets/enrollment/scan.json') == tested.read('assets/enrollment/scan.json') == scan_bytes
        for path in Path('android/app/src/main/assets/monitoring').rglob('*'):
            if not path.is_file():
                continue
            name = 'assets/monitoring/' + path.relative_to(Path('android/app/src/main/assets/monitoring')).as_posix()
            content = release.read(name)
            assert content == path.read_bytes() == tested.read(name), f'Tested/source asset differs: {name}'
            monitoring[name] = digest(content)
        for model in [scan['model'], scan['security']['identity']] + scan['security']['passiveModels']:
            name = 'assets/' + model['asset']
            content = release.read(name)
            assert content == tested.read(name) and digest(content) == model['sha256'], f'Model changed: {name}'
            models[name] = digest(content)
        for notice in ('SFACE_LICENSE.txt', 'MINIFAS_LICENSE.txt', 'MODEL_NOTICE.md'):
            assert release.read('assets/enrollment/security/' + notice)
        for name in release.namelist():
            if name.endswith(('.jpg', '.jpeg', '.png')):
                assert digest(release.read(name)) not in fixtures, 'Test image included in release'
            if not name.endswith('.so'):
                continue
            assert name.startswith('lib/arm64-v8a/'), f'Unexpected ABI: {name}'
            data = release.read(name)
            assert data[:4] == b'\x7fELF' and data[4] == 2
            endian = '<' if data[5] == 1 else '>'
            offset = struct.unpack_from(endian + 'Q', data, 32)[0]
            size, count = struct.unpack_from(endian + 'HH', data, 54)
            alignments = []
            for index in range(count):
                values = struct.unpack_from(endian + 'IIQQQQQQ', data, offset + size * index)
                if values[0] != 1:
                    continue
                assert values[7] >= 16384 and (values[3] - values[2]) % 16384 == 0, f'ELF alignment: {name}'
                alignments.append(values[7])
            libraries.append({'name': name, 'loadAlignments': alignments})
    assert monitoring and libraries
    result = {'file': str(args.apk.resolve()), 'version': app['version'], 'versionCode': app['android']['versionCode'],
              'bytes': args.apk.stat().st_size, 'sha256': digest(args.apk.read_bytes()), 'certificateSha256': certificate,
              'sourceAndTestedAssetsMatch': monitoring, 'enrollmentModels': models, 'libraries': libraries,
              'testFixturesAbsent': True, 'elf16KB': True, 'firebaseConfigPresent': Path('android/app/google-services.json').is_file()}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in ('libraries', 'enrollmentModels', 'sourceAndTestedAssetsMatch')}, indent=2))


if __name__ == '__main__':
    main()
