import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(await readFile('src/lib/monitoringLifecycle.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} }; vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { monitoringOwnerNeedsReset } = module.exports;
test('same authenticated owner keeps autonomous monitoring across UI teardown', () => {
  assert.equal(monitoringOwnerNeedsReset('owner-a', ['owner-a','owner-a'], true), false);
});
test('different owner or inconsistent persisted scopes require reset before fetching new cameras', () => {
  assert.equal(monitoringOwnerNeedsReset('owner-b', ['owner-a','owner-a'], true), true);
  assert.equal(monitoringOwnerNeedsReset('owner-b', ['owner-b','owner-a'], true), true);
});
test('a running legacy service with unknown owner fails closed while an idle first launch needs no erase', () => {
  assert.equal(monitoringOwnerNeedsReset('owner-a', [], true), true);
  assert.equal(monitoringOwnerNeedsReset('owner-a', [], false), false);
});
test('owner change stops the native scope before clearing cached data and same owner does neither', async () => {
  const calls = [];
  const stubs = {
    './cameraMonitoring': { getNativeCameraCapabilities: async () => ({ recovery: { userId: 'owner-a' } }), getDeliveryRegistration: async () => ({ userId: 'owner-a' }) },
    './backgroundMonitoring': { isBackgroundMonitoringRunning: async () => true, stopBackgroundMonitoring: async () => calls.push('stop') },
    './authSession': { clearSignedInUserStorage: async () => calls.push('clear') },
  };
  const instance = { exports: {} }; vm.runInNewContext(compiled, { module: instance, exports: instance.exports, require: key => stubs[key] });
  await instance.exports.reconcileMonitoringOwner('owner-a'); assert.deepEqual(calls, []);
  await instance.exports.reconcileMonitoringOwner('owner-b'); assert.deepEqual(calls, ['stop','clear']);
});
