"""Inspect the shipped APK without extracting private app data or signing secrets."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--apk',type=Path,required=True)
    parser.add_argument('--tested',type=Path,required=True)
    parser.add_argument('--previous',type=Path,required=True)
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args()
    config_bytes=Path('src/config/faceScan.json').read_bytes()
    config=json.loads(config_bytes)
    expected_certificate=json.loads(Path('test-artifacts/face-scan-fix-2026-10-13/apk-verification.json').read_text())['certificateSha256']
    assert expected_certificate in (args.root/'apk-signature.log').read_text(encoding='utf-8-sig')
    metadata=(args.root/'apk-metadata.log').read_text(encoding='utf-8-sig')
    app=json.loads(Path('app.json').read_text(encoding='utf-8'))['expo']
    assert f"name='{app['android']['package']}' versionCode='{app['android']['versionCode']}' versionName='{app['version']}'" in metadata
    assert "native-code: 'arm64-v8a'" in metadata
    fixtures={hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.root/'fixtures').glob('*.jpg')}
    fixtures.update(hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.root/'frames').rglob('*.jpg'))
    fixtures.add(hashlib.sha256(Path('android/app/src/androidTest/assets/face-portrait.jpg').read_bytes()).hexdigest())
    models={}; monitoring=[]; libraries=[]
    with zipfile.ZipFile(args.apk) as built,zipfile.ZipFile(args.tested) as tested,zipfile.ZipFile(args.previous) as previous:
      assert built.read('assets/enrollment/scan.json')==tested.read('assets/enrollment/scan.json')==config_bytes
      for model in [config['model'],config['security']['identity']]+config['security']['passiveModels']:
        name='assets/'+model['asset']; content=built.read(name)
        assert content==tested.read(name)
        digest=hashlib.sha256(content).hexdigest(); assert digest==model['sha256']
        models[name]=digest
      for item in built.infolist():
        name=item.filename
        if name.startswith('assets/monitoring/'):
          assert built.read(name)==previous.read(name); monitoring.append(name)
        if name.endswith(('.jpg','.jpeg','.png')):
          assert hashlib.sha256(built.read(name)).hexdigest() not in fixtures,'Public test fixture leaked into release'
        if name.endswith('.so'):
          assert name.startswith('lib/arm64-v8a/')
          data=built.read(name); assert data[:4]==b'\x7fELF' and data[4]==2
          endian='<' if data[5]==1 else '>'
          offset=struct.unpack_from(endian+'Q',data,32)[0]
          size=struct.unpack_from(endian+'H',data,54)[0]
          count=struct.unpack_from(endian+'H',data,56)[0]
          alignments=[]
          for index in range(count):
            position=offset+index*size
            if struct.unpack_from(endian+'I',data,position)[0]==1:
              alignment=struct.unpack_from(endian+'Q',data,position+48)[0]
              assert alignment>=16384,(name,alignment); alignments.append(alignment)
          libraries.append({'name':name,'alignments':alignments})
      assert monitoring and libraries
      for name in ['SFACE_LICENSE.txt','MINIFAS_LICENSE.txt','MODEL_NOTICE.md']:
        assert built.read('assets/enrollment/security/'+name)
    result={'file':str(args.apk.resolve()),'bytes':args.apk.stat().st_size,'sha256':hashlib.sha256(args.apk.read_bytes()).hexdigest(),
      'certificateSha256':expected_certificate,'configMatchesTested':True,'models':models,'monitoringUnchanged':monitoring,
      'testFixturesAbsent':True,'libraries':libraries}
    (args.root/'apk-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('libraries','models')},indent=2))


if __name__=='__main__': main()
