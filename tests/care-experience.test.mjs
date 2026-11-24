import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}) {
  const filename = resolve(relative), module = { exports: {} }, original = createRequire(filename);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    Date, Number, Set, process: { env: { EXPO_PUBLIC_AI_MODE: 'app_background' } } }, { filename });
  return module.exports;
}
const policy = await load('src/lib/monitoringPolicy.ts', { './cameraSource': { resolveCameraSource: camera => camera.url } });
const { describeLiveMonitoring } = await load('src/lib/monitoringStatus.ts', { './monitoringPolicy': policy });
const { readableTypography } = await load('src/lib/readability.ts');
const now = 100000;
const camera = { id: 'living-room', type: 'rtsp', url: 'https://camera.test/live.m3u8' };
function snapshot(overrides = {}) {
  return { cameraId: camera.id, state: 'ready', lastFrameAt: now-100, lastAnalysisAt: now-100, inferenceMs: 30,
    analysis: { monitoringMode: 'selected_people', identityReady: true,
      detections: [{ memberId: 'grandma', identityState: 'face_confirmed' }] }, ...overrides };
}
function describe(state = snapshot(), overrides = {}) {
  return describeLiveMonitoring({ cameras: [camera], states: { [camera.id]: state }, targetIds: new Set(['grandma']), nativeMode: true, now, ...overrides });
}
const row = (summary, id) => summary.rows.find(item => item.id === id);
test('a selected name is shown independently from a current identity match', () => {
  const options = { singleTarget: { id: 'grandma', name: 'คุณยาย' } };
  assert.ok(row(describe(snapshot(), options), 'person').detail.includes('ยืนยันใบหน้าล่าสุดได้แล้ว'));
  const stale = describe(snapshot({ lastAnalysisAt: now-4000 }), options);
  assert.equal(row(stale, 'person').detail, 'ตั้งให้เฝ้าดูคุณยาย\nตอนนี้ยังยืนยันคุณยายไม่ได้');
  const all = describe(snapshot(), { ...options, targetIds: new Set() });
  assert.equal(row(all, 'person').detail, 'ตรวจการล้มของทุกคนในภาพ');
  const unavailable = describe(snapshot(), { targetIds: new Set(), scopeUnavailable: true });
  assert.equal(row(unavailable, 'person').tone, 'attention');
  assert.ok(!row(unavailable, 'person').detail.includes('ทุกคนในภาพ'));
});

test('saving a camera alone cannot claim that the stream, AI or identity is ready', () => {
  const result = describe(undefined, { states: {} });
  for (const id of ['camera', 'ai', 'person']) assert.notEqual(row(result, id).tone, 'ready');
});
test('receiving a frame while AI has an error reports connection and analysis separately', () => {
  const result = describe(snapshot({ state: 'ai_error' }));
  assert.equal(row(result, 'camera').tone, 'ready');
  assert.notEqual(row(result, 'ai').tone, 'ready');
  assert.notEqual(row(result, 'person').tone, 'ready');
});
test('prepared face templates without a current recognized face do not mean a verified person', () => {
  const result = describe(snapshot({ analysis: { monitoringMode: 'selected_people', identityReady: true, detections: [] } }));
  assert.equal(row(result, 'ai').tone, 'ready');
  assert.notEqual(row(result, 'person').tone, 'ready');
  assert.ok(result.detail.includes('ไม่เปลี่ยนไปตรวจทุกคน'));
});
test('fresh target recognition can be ready while an unrelated face cannot', () => {
  assert.equal(describe().tone, 'ready');
  const result = describe(snapshot({ analysis: { monitoringMode: 'selected_people', identityReady: true,
    detections: [{ memberId: 'visitor', identityState: 'face_confirmed' }] } }));
  assert.notEqual(row(result, 'person').tone, 'ready');
});
test('identity display expires sooner than the stream and never trusts future timestamps', () => {
  assert.equal(row(describe(snapshot({ lastAnalysisAt: now-4000 })), 'ai').tone, 'ready');
  assert.notEqual(row(describe(snapshot({ lastAnalysisAt: now-4000 })), 'person').tone, 'ready');
  for (const timestamp of [now+1, 1, NaN]) {
    const result = describe(snapshot({ lastFrameAt: timestamp, lastAnalysisAt: timestamp }));
    assert.notEqual(result.tone, 'ready');
    assert.notEqual(row(result, 'person').tone, 'ready');
  }
});
test('slow inference, frozen images and an old monitoring mode cannot claim current analysis', () => {
  for (const state of [snapshot({ inferenceMs: 3000 }), snapshot({ healthIssues: ['IMAGE_UNCHANGED'] }),
    snapshot({ analysis: { monitoringMode: 'all_people', identityReady: true, detections: [] } })]) {
    assert.notEqual(row(describe(state), 'ai').tone, 'ready');
  }
});
test('one connected camera is not enough when another configured camera is offline', () => {
  const result = describe(snapshot(), { cameras: [camera, { ...camera, id: 'hall' }] });
  assert.notEqual(row(result, 'camera').tone, 'ready');
  assert.notEqual(row(result, 'ai').tone, 'ready');
});
test('all people needs no face recognition; a worker heartbeat alone proves no decoded images', () => {
  const all = describe(snapshot({ analysis: { monitoringMode: 'all_people', detections: [] } }), { targetIds: new Set() });
  assert.equal(all.tone, 'ready');
  const worker = describe(snapshot(), { nativeMode: false, workerOnline: true });
  assert.notEqual(row(worker, 'camera').tone, 'ready');
  assert.notEqual(row(worker, 'ai').tone, 'ready');
});
test('a face verified for a different per-camera selection cannot satisfy this camera', () => {
  const result = describe(snapshot(), { cameras: [{ ...camera, assigned_member_id: 'grandpa' }], targetIds: new Set(['grandma','grandpa']) });
  assert.ok(row(result, 'person').detail.includes('ยืนยันล่าสุดได้ 0'));
});
test('loading does not flash a ready badge from cached observations', () => {
  const result = describe(snapshot(), { loading: true });
  assert.equal(result.tone, 'waiting');
  assert.ok(result.rows.every(item => item.tone === 'waiting'));
});
test('nested large headings retain their size without applying senior enlargement twice', () => {
  const parent = readableTypography(30, 32, true);
  const child = readableTypography(undefined, undefined, true, parent.fontSize);
  assert.equal(child.fontSize, parent.fontSize);
  assert.ok(child.lineHeight >= child.fontSize);
  assert.ok(readableTypography(10, 12, true).fontSize > readableTypography(10, 12, false).fontSize);
});
test('switching to all people updates only care recipients in the requested family', async () => {
  const calls = [];
  const query = { update: value => { calls.push(['update',value]); return query; },
    eq: (field,value) => { calls.push(['eq',field,value]); return query; },
    is: (field,value) => { calls.push(['is',field,value]); return query; },
    then: resolve => Promise.resolve({ error: null }).then(resolve) };
  const members = await load('src/lib/familyMembers.ts', { './supabase': { supabase: { from: table => {
    calls.push(['from',table]); return query;
  } } } });
  await members.clearCareRecipientSelection('test-family');
  assert.ok(calls.some(item => item[0]==='eq' && item[1]==='family_id' && item[2]==='test-family'));
  assert.ok(calls.some(item => item[0]==='is' && item[1]==='user_id' && item[2]===null));
  assert.ok(calls.some(item => item[0]==='eq' && item[1]==='is_tracked' && item[2]===true));
  const count = calls.length;
  await assert.rejects(members.clearCareRecipientSelection('  '));
  assert.equal(calls.length, count);
});

test('readiness distinguishes prepared references, saved cameras and current identity', async () => {
  let receipt = null;
  const native = { hasNativeCameraMonitoring: () => true, supportsMonitoringIdentity: () => true,
    getIdentityGalleryStatus: async () => ({ familyId: 'family', userId: 'caregiver', expiresAt: Date.now()+60000, memberIds: ['grandma'] }),
    getNativeCameraCapabilities: async () => ({ localNotificationsEnabled: true, remotePushConfigured: true }), refreshCameraMonitorStates: async () => {},
    getCameraMonitorStates: () => ({}), isCameraMonitorReady: () => false, isCameraMonitorSlow: () => false };
  const source = await load('src/lib/systemReadiness.ts', {
    '@react-native-async-storage/async-storage': { getItem: async key => key === 'familyId' ? 'family' : 'test-token' },
    './familyMembers': { listFamilyMembers: async () => [{ id: 'grandma', user_id: null, is_tracked: true, display_name: 'ยาย', identity_reference_count: 3 }] },
    './selfTestReceipts': { lastPhoneTest: async id => { assert.equal(id, 'caregiver'); return receipt; } },
    './pushNotifications': { STORAGE_KEY_EXPO_PUSH_TOKEN: 'test-token-key' },
    './supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'caregiver' } } }) },
      from: () => ({ select: () => ({ eq: async () => ({ data: [camera], error: null }) }) }) } },
    './backgroundMonitoring': {}, './cameraAnalysis': { getAnalysisIntervalMs: () => 300, getCaptureQuality: () => .7 },
    './monitoringPolicy': policy, './monitorHealth': {}, './cameraMonitoring': native, './monitoringStatus': { describeLiveMonitoring },
  });
  const result = await source.checkSystemReadiness();
  assert.equal(result.steps.find(item => item.id === 'identity').ready, true);
  assert.equal(result.steps.find(item => item.id === 'camera').ready, true);
  assert.equal(result.steps.find(item => item.id === 'analysis').ready, false);
  assert.equal(result.steps.find(item => item.id === 'notification').ready, true);
  const phoneReady = async () => (await source.checkSystemReadiness()).steps.find(item => item.id === 'phoneReceipt').ready;
  assert.equal(await phoneReady(), false);
  receipt = { sentAt: Date.now(), correlated: true };
  assert.equal(await phoneReady(), false);
  receipt.observedAt = Date.now();
  assert.equal(await phoneReady(), true);
  native.getNativeCameraCapabilities = async () => ({ localNotificationsEnabled: false, remotePushConfigured: true });
  assert.equal(await phoneReady(), false);
  assert.notEqual(row(result.monitoring, 'person').tone, 'ready');
  assert.equal(result.steps.find(item => item.id === 'identity').params.memberId, 'grandma');
});
