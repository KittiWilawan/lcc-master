import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const filename = 'supabase/functions/native-camera-events/deliveryPolicy.ts';
const code = ts.transpileModule(await readFile(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports });
const { applyReceipts, deliverySummary, validateTickets } = module.exports;
const queued = { hash: 'device-a', id: 'ticket-a', sentAt: 1000, state: 'queued' };
test('a self-test records only the matching account and attempt, including a receipt before the send response', async () => {
  const entries = new Map();
  const storage = { getItem: async key => entries.get(key) ?? null, setItem: async (key, value) => entries.set(key, value) };
  const source = await readFile('src/lib/selfTestReceipts.ts','utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const api = {};
  vm.runInNewContext(compiled.outputText, { exports: api, require: () => storage, Date });
  await api.startPhoneTest('owner', 'first');
  await api.startPhoneTest('owner', 'latest');
  const notification = { type: 'notification_test', userId: 'owner', testId: 'latest' };
  await api.observePhoneTest('owner', { ...notification, testId: 'first' });
  await api.observePhoneTest('visitor', notification);
  await api.observePhoneTest('owner', { type: 'notification_test' });
  assert.equal((await api.lastPhoneTest('owner')).observedAt, undefined);
  await Promise.all([api.observePhoneTest('owner', notification), api.finishPhoneTest('owner', 'latest', true, true)]);
  const recorded = await api.lastPhoneTest('owner');
  assert.ok(recorded.observedAt && recorded.sentAt);
  await api.observePhoneTest('owner', notification);
  assert.equal((await api.lastPhoneTest('owner')).observedAt, recorded.observedAt);
  assert.equal(await api.lastPhoneTest('visitor'), null);
});
test('Expo ticket acceptance does not count as confirmed provider delivery', () => {
  const result = deliverySummary(['device-a'], ['device-a'], [queued]);
  assert.equal(result.remoteAccepted, true); assert.equal(result.deliveryComplete, false);
  assert.equal(result.providerConfirmed, false); assert.equal(result.state, 'receipt_pending');
});
test('provider receipt and app acknowledgement remain distinct evidence', () => {
  const tickets = applyReceipts([queued], { 'ticket-a': { status: 'ok' } }, 2000, 900000);
  const result = deliverySummary(['device-a'], ['device-a'], tickets, 0);
  assert.equal(result.providerConfirmed, true); assert.equal(result.deliveryComplete, true);
  assert.equal(result.receivedCount, 0);
});
test('one successful device cannot hide another pending or rejected recipient', () => {
  const tickets = [{ ...queued, state: 'provider_confirmed' }, { hash: 'device-b', id: 'ticket-b', sentAt: 1000, state: 'queued' }];
  assert.equal(deliverySummary(['device-a', 'device-b'], ['device-a', 'device-b'], tickets).deliveryComplete, false);
  assert.equal(deliverySummary(['device-a', 'device-b'], ['device-a'], tickets).remoteAccepted, false);
});
test('unregistered device is an explicit failure, never receipt success', () => {
  const tickets = applyReceipts([queued], { 'ticket-a': { status: 'error', details: { error: 'DeviceNotRegistered' } } }, 2000, 900000);
  assert.equal(tickets[0].error, 'DeviceNotRegistered');
  assert.equal(deliverySummary(['device-a'], ['device-a'], tickets).state, 'receipt_failed');
  assert.equal(deliverySummary(['device-a'], ['device-a'], tickets).providerConfirmed, false);
});
test('missing receipts expire without sending the same accepted ticket again', () => {
  const tickets = applyReceipts([queued], {}, 901001, 900000);
  assert.equal(tickets[0].state, 'expired');
  const result = deliverySummary(['device-a'], ['device-a'], tickets);
  assert.equal(result.remoteAccepted, true); assert.equal(result.providerConfirmed, false);
});
test('no recipients and corrupt provider records cannot claim readiness', () => {
  assert.equal(deliverySummary([], [], []).state, 'no_recipients');
  assert.equal(deliverySummary([], [], []).deliveryComplete, false);
  assert.equal(validateTickets([null, {}, 'token', { ...queued, sentAt: NaN }]).length, 0);
});
