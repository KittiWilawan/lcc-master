import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile('supabase/functions/native-camera-events/eventImage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, atob, Uint8Array });
const { decodeEventImage } = module.exports;
test('metadata survives storage pressure and an already-synced retry needs no repeated image', () => {
  assert.equal(decodeEventImage({ evidenceState: 'storage_pressure' }, false, 1024), null);
  assert.equal(decodeEventImage({}, true, 1024), null);
  assert.throws(() => decodeEventImage({}, false, 1024));
});
test('an explicit malformed image is never accepted as a metadata-only event', () => {
  for (const value of ['', 'broken base64!', btoa('plain text'), null]) {
    assert.throws(() => decodeEventImage({ imageBase64: value, evidenceState: 'storage_pressure' }, true, 1024));
  }
});
test('valid JPEG prefix is preserved and the byte ceiling is enforced', () => {
  const image = btoa(String.fromCharCode(255, 216, 255, 217));
  assert.deepEqual([...decodeEventImage({ imageBase64: image }, false, 4)], [255,216,255,217]);
  assert.throws(() => decodeEventImage({ imageBase64: image }, false, 3));
});
