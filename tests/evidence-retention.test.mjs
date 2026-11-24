import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(await readFile('src/lib/evidenceRetention.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} }; vm.runInNewContext(compiled, { module, exports: module.exports });
const { retainEvidenceRecords } = module.exports;
test('history trimming retains all unsynced events beyond the former thirty-event ceiling', () => {
  const pending = Array.from({ length: 90 }, (_, id) => ({ id: `pending-${id}`, cloudSynced: false }));
  const cloud = Array.from({ length: 40 }, (_, id) => ({ id: `cloud-${id}`, cloudSynced: true }));
  const retained = retainEvidenceRecords([...cloud, ...pending], 30);
  assert.equal(retained.length, 120); assert.equal(retained.filter(row => row.cloudSynced !== true).length, 90);
});
test('an unknown sync state cannot be treated as permission to evict an event', () => {
  const entries = [{ id: 'unknown' }, { id: 'first', cloudSynced: true }, { id: 'second', cloudSynced: true }];
  assert.deepEqual([...retainEvidenceRecords(entries, 1)].map(row => row.id), ['unknown', 'first']);
});
