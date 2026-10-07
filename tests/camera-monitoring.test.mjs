import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}, globals = {}) {
  const filename = resolve(relative);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} }; const original = createRequire(filename);
  const context = vm.createContext({ module, exports: module.exports,
    require: (name) => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    process: { env: { EXPO_PUBLIC_AI_MODE: 'app_background', EXPO_PUBLIC_CAMERA_TEST_TIMEOUT_MS: '20' } },
    URL, Request, Response, AbortController, DOMException, setTimeout, clearTimeout,
    console: { warn() {}, log() {} }, ...globals,
  });
  vm.runInContext(code, context, { filename }); return module.exports;
}
const source = await load('src/lib/cameraSource.ts');
const policy = await load('src/lib/monitoringPolicy.ts', { './cameraSource': source });

test('one HLS link is a valid AI source without a snapshot', () => {
  const camera = { type: 'rtsp', url: ' https://camera.test/live.m3u8?session=synthetic ' };
  assert.equal(source.resolveCameraSource(camera), 'https://camera.test/live.m3u8?session=synthetic');
  assert.equal(policy.shouldMonitorCamera(camera, new Set()), true);
});
test('invalid addresses and unsupported protocols cannot become ready', () => {
  for (const url of ['broken address', 'rtsp://camera.test/live', 'file:///private/image.jpg']) {
    assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url }, new Set()), false);
  }
});
test('selected families retain their camera scope with a single HLS link', () => {
  const targets = new Set(['selected-person']);
  assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url: 'https://camera.test/live.m3u8', assigned_member_id: 'other-person' }, targets), false);
  assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url: 'https://camera.test/live.m3u8', assigned_member_id: 'selected-person' }, targets), true);
});
test('camera connection readiness requires successful native decoding', async () => {
  const urls = [];
  const app = await load('src/lib/cameraConnectionTest.ts', {
    './cameraMonitoring': { hasNativeCameraMonitoring: () => true, testNativeCameraSource: async (url) => {
      urls.push(url); return { success: false, message: 'Decoder rejected the source' };
    } },
  }, { fetch() { throw new Error('Header-only testing must not be used'); } });
  assert.equal((await app.testCameraConnection('https://camera.test/live.m3u8')).success, false);
  assert.deepEqual(urls, ['https://camera.test/live.m3u8']);
});
test('computer loopback addresses are rejected before touching the decoder', async () => {
  const app = await load('src/lib/cameraConnectionTest.ts', {
    './cameraMonitoring': { hasNativeCameraMonitoring: () => true, testNativeCameraSource() { throw new Error('Unreachable'); } },
  });
  assert.equal((await app.testCameraConnection('http://localhost/live.m3u8')).success, false);
});
test('web cannot claim HLS AI readiness just because a playlist loads', async () => {
  const app = await load('src/lib/cameraConnectionTest.ts', {
    './cameraMonitoring': { hasNativeCameraMonitoring: () => false },
  }, { fetch: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/vnd.apple.mpegurl' }) }) });
  assert.equal((await app.testCameraConnection('https://camera.test/live.m3u8')).success, false);
});
test('camera freshness requires recent frame and inference timestamps', async () => {
  const app = await load('src/lib/cameraMonitoring.ts', {
    'react-native': { Platform: { OS: 'web' }, NativeModules: {} }, 'react': {},
  });
  const now = 100000;
  const fresh = { cameraId: 'camera', state: 'ready', lastFrameAt: now - 100, lastAnalysisAt: now - 50 };
  assert.equal(app.isCameraMonitorFresh(fresh, now), true);
  for (const state of [{ ...fresh, state: 'reconnecting' }, { ...fresh, lastFrameAt: 1 },
    { ...fresh, lastAnalysisAt: 1 }, { ...fresh, lastAnalysisAt: now + 1 }, undefined]) {
    assert.equal(app.isCameraMonitorFresh(state, now), false);
  }
});
test('fresh images with slow inference must not claim monitoring readiness', async () => {
  const app = await load('src/lib/cameraMonitoring.ts', {
    'react-native': { Platform: { OS: 'web' }, NativeModules: {} }, 'react': {},
  });
  const now = 100000;
  const state = { cameraId: 'camera', state: 'ready', lastFrameAt: now - 100, lastAnalysisAt: now - 50, inferenceMs: 1664 };
  assert.equal(app.isCameraMonitorFresh(state, now), true);
  assert.equal(app.isCameraMonitorSlow(state), true);
  assert.equal(app.isCameraMonitorReady(state, now), false);
  assert.equal(app.isCameraMonitorReady({ ...state, inferenceMs: 45 }, now), true);
  assert.equal(app.isCameraMonitorReady({ ...state, inferenceMs: undefined }, now), false);
  assert.equal(app.isCameraMonitorReady({ ...state, inferenceMs: NaN }, now), false);
});
test('network deadline covers a stalled response body', async () => {
  const app = await load('src/lib/networkRequest.ts', {
    '../config/network.json': { requestTimeoutMs: 20 },
  }, { fetch: async (_input, init) => ({ clone: () => ({ text: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }) }) }) });
  await assert.rejects(app.fetchWithDeadline('https://service.test'), (error) => error.name === 'TimeoutError');
});
test('caller cancellation is preserved without retrying requests', async () => {
  let calls = 0;
  const app = await load('src/lib/networkRequest.ts', {}, {
    fetch: async (_input, init) => { calls++; if (init.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); return new Response('{}'); },
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(app.fetchWithDeadline('https://service.test', { signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('auth errors preserve structured codes on Error subclasses', async () => {
  const app = await load('src/lib/friendlyError.ts');
  const credentials = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials', status: 400 });
  assert.equal(app.getAuthErrorMessage(credentials), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง');
  const unavailable = Object.assign(new Error('Fetch failure'), { status: 503 });
  assert.equal(app.getAuthErrorMessage(unavailable), 'ระบบส่วนกลางไม่พร้อมชั่วคราว กรุณารอสักครู่แล้วลองอีกครั้ง');
  assert.equal(app.getAuthErrorMessage(Object.assign(new Error('Timed out'), { name: 'TimeoutError' })),
    'ระบบตอบกลับช้าเกินไป กรุณาลองอีกครั้งเมื่อการเชื่อมต่อพร้อม');
});

test('native delivery API rejects unauthenticated and expired device requests', async () => {
  let handler;
  const chain = { select: () => chain, eq: () => chain, is: () => chain,
    maybeSingle: async () => ({ data: null, error: null }) };
  const client = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from: () => chain };
  await load('supabase/functions/native-camera-events/index.ts', {
    'npm:@supabase/supabase-js@2.108.2': { createClient: () => client },
  }, { crypto: (await import('node:crypto')).webcrypto,
    TextEncoder, Uint8Array, Deno: { env: { get: () => 'synthetic-test-environment' }, serve: (fn) => { handler = fn; } } });
  const body = { deviceId: '00000000-0000-0000-0000-000000000001', familyId: '00000000-0000-0000-0000-000000000002' };
  for (const action of ['register', 'event', 'revoke-user', 'revoke']) {
    const response = await handler(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ ...body, action }) }));
    assert.equal(response.status, 401, action);
    assert.equal((await response.json()).code, 'unauthorized');
  }
  const expired = await handler(new Request('https://test.invalid', { method: 'POST', headers: { 'x-device-token': 'synthetic-expired' }, body: JSON.stringify({ action: 'event' }) }));
  assert.equal(expired.status, 401); assert.equal((await expired.json()).code, 'device_expired');
});

test('native registration cannot authorize a different family', async () => {
  let handler;
  const chain = { select: () => chain, eq: () => chain, then: (resolve) => resolve({ count: 0, error: null }) };
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) }, from: () => chain };
  await load('supabase/functions/native-camera-events/index.ts', {
    'npm:@supabase/supabase-js@2.108.2': { createClient: () => client },
  }, { crypto: (await import('node:crypto')).webcrypto, TextEncoder, Uint8Array,
    Deno: { env: { get: () => 'synthetic-test-environment' }, serve: (fn) => { handler = fn; } } });
  const response = await handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user-session' },
    body: JSON.stringify({ action: 'register', deviceId: '00000000-0000-0000-0000-000000000001', familyId: '00000000-0000-0000-0000-000000000002' }) }));
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'family_forbidden');
});
test('offline native fall events preserve timestamp, local image and notification truth', async () => {
  const storage = new Map([['familyId', 'synthetic-family']]);
  const app = await load('src/lib/fallEvidence.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key) => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } },
    './supabase': { supabase: { storage: { from: () => ({ upload: async () => ({ error: new Error('Offline') }) }) }, from: () => ({ insert: async () => ({ error: new Error('Offline') }), upsert: async () => ({ error: new Error('Offline') }) }) } },
    'uuid': { v4: () => 'synthetic-id' }, 'expo-file-system': { File: class { async arrayBuffer() { return new ArrayBuffer(1); } } },
  }, { fetch: async () => ({ blob: async () => new Blob(['synthetic']) }) });
  const params = { eventId: 'stable-event-id', familyId: 'synthetic-family', createdAt: '2026-10-06T10:00:00.000Z', imageUri: 'file:///private/event.jpg', notificationSent: false };
  const record = await app.recordFallEvent(params);
  assert.equal(record.status, 'pending'); assert.equal(record.savedLocally, true); assert.equal(record.cloudSynced, undefined);
  assert.equal(record.image_url, params.imageUri); assert.equal(record.created_at, params.createdAt);
  await app.recordFallEvent({ ...params, notificationSent: true });
  const saved = JSON.parse(storage.get(app.STORAGE_KEY_FALL_EVIDENCE));
  assert.equal(saved.length, 1); assert.equal(saved[0].status, 'notified');
});

test('history includes pending local events and isolates other families when cloud has records', async () => {
  const local = [
    { id: 'pending', family_id: 'family-a', created_at: '2026-10-06T12:00:00Z', image_url: 'file:///private/pending.jpg' },
    { id: 'shared', family_id: 'family-a', created_at: '2026-10-06T10:00:00Z' },
    { id: 'private-other', family_id: 'family-b', created_at: '2026-10-06T13:00:00Z' },
  ];
  const query = { select: () => query, eq: (_field, value) => { assert.equal(value, 'family-a'); return query; },
    order: () => query, limit: async () => ({ data: [{ id: 'shared', family_id: 'family-a', created_at: '2026-10-06T10:00:00Z', status: 'responded' }], error: null }) };
  const app = await load('src/lib/fallEvidence.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key) => key === 'familyId' ? 'family-a' : JSON.stringify(local) },
    './supabase': { supabase: { from: () => query } }, 'uuid': {}, 'expo-file-system': {},
  });
  const events = await app.getFallEvents();
  assert.deepEqual(Array.from(events, (event) => event.id), ['pending', 'shared']);
  assert.equal(events[1].status, 'responded');
});

test('local notification permission does not pretend remote token registration succeeded', async () => {
  const storage = new Map([['@expo_push_token', 'stale-token']]);
  const app = await load('src/lib/pushNotifications.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-constants': { executionEnvironment: 'standalone', expoConfig: { extra: { eas: { projectId: 'synthetic-project' } } },
      ExecutionEnvironment: { StoreClient: 'store' } },
    '@react-native-async-storage/async-storage': { setItem: async (key, value) => storage.set(key, value), removeItem: async (key) => storage.delete(key) },
    './supabase': {}, './phone': {},
    'expo-notifications': { getPermissionsAsync: async () => ({ status: 'granted' }), getExpoPushTokenAsync: async () => { throw new Error('Synthetic FCM unavailable'); } },
  });
  assert.equal(await app.registerForPushNotificationsAsync(), true);
  assert.equal(storage.get('@push_registration_status'), 'local_only');
  assert.equal(storage.has('@expo_push_token'), false);
});

test('native events stay local until native delivery confirms cloud progress', async () => {
  const storage = new Map();
  const app = await load('src/lib/fallEvidence.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key) => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value) },
    './supabase': { supabase: { from: () => { throw new Error('Native delivery owns this upload'); } } },
    'uuid': {}, 'expo-file-system': {},
  });
  const params = { eventId: 'native-event', familyId: 'test-family', imageUri: 'file:///private/event.jpg', deferCloudSync: true };
  const local = await app.recordFallEvent(params);
  assert.equal(local.savedLocally, true); assert.equal(local.cloudSynced, undefined);
  const delivered = await app.recordFallEvent({ ...params, cloudImagePath: 'test-family/native-event.jpg' });
  assert.equal(delivered.cloudSynced, true); assert.equal(delivered.image_url, 'test-family/native-event.jpg');
});
