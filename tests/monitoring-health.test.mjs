import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile('src/lib/monitoringHealth.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(source, { module, exports: module.exports });
const { describeMonitoringHealth } = module.exports;

test('no current health problem and unknown future codes do not invent a fall alert', () => {
  assert.equal(describeMonitoringHealth(undefined).length, 0);
  assert.equal(describeMonitoringHealth({ healthIssues: ['FUTURE_CODE'] }).length, 0);
});
test('stationary content is described as a request to check the image, not a confirmed broken camera', () => {
  const messages = describeMonitoringHealth({ healthIssues: ['IMAGE_UNCHANGED'] });
  assert.equal(messages.length, 1); assert.ok(messages[0].includes('ภาพไม่เปลี่ยน'));
  assert.ok(messages[0].includes('โปรดตรวจ'));
});
test('queue pressure and discarded evidence both remain visible with their actual counts', () => {
  const messages = describeMonitoringHealth({ healthIssues: ['QUEUE_NEAR_FULL', 'QUEUE_DISCARDED'], pendingEventCount: 30, queueCapacity: 30, queueDiscardedEvents: 2 });
  assert.equal(messages.length, 2); assert.ok(messages[0].includes('30 เหตุ')); assert.ok(messages[1].includes('2 เหตุ'));
});
