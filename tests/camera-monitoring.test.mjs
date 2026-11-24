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
    require: (name) => Object.hasOwn(stubs, name) ? stubs[name] : name === './cameraLinkGuidance' ? guidance : name === './eventImage.ts' ? eventImage : name === './evidenceRetention' ? evidenceRetention : original(name),
    process: { env: { EXPO_PUBLIC_AI_MODE: 'app_background', EXPO_PUBLIC_CAMERA_TEST_TIMEOUT_MS: '20' } },
    URL, Request, Response, AbortController, DOMException, setTimeout, clearTimeout,
    console: { warn() {}, log() {} }, ...globals,
  });
  vm.runInContext(code, context, { filename }); return module.exports;
}
const guidance = await load('src/lib/cameraLinkGuidance.ts');
const source = await load('src/lib/cameraSource.ts');
const deliveryPolicy = await load('supabase/functions/native-camera-events/deliveryPolicy.ts');
const eventImage = await load('supabase/functions/native-camera-events/eventImage.ts', {}, { atob });
const evidenceRetention = await load('src/lib/evidenceRetention.ts');
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
test('ready cameras monitor selected people even without a camera assignment', () => {
  const targets = new Set(['selected-person']);
  assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url: 'https://camera.test/live.m3u8', assigned_member_id: 'other-person' }, targets), true);
  assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url: 'https://camera.test/live.m3u8', assigned_member_id: 'selected-person' }, targets), true);
  assert.equal(policy.shouldMonitorCamera({ type: 'rtsp', url: 'https://camera.test/live.m3u8' }, targets), true);
  assert.deepEqual([...policy.getCameraTargetMemberIds({ type: 'rtsp' }, targets)], ['selected-person']);
  assert.deepEqual([...policy.getCameraTargetMemberIds({ type: 'rtsp', assigned_member_id: 'other-person' }, targets)], ['selected-person']);
  assert.deepEqual([...policy.getCameraTargetMemberIds({ type: 'rtsp', assigned_member_id: 'selected-person' }, new Set())], []);
  assert.deepEqual([...policy.getCameraTargetMemberIds({ type: 'rtsp', assigned_member_id: 'selected-person' }, new Set(['selected-person', 'second']))], ['selected-person']);
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
test('home worker setup distinguishes a playlist from login pages and malformed camera links', async () => {
  const url = 'https://camera.test/live.m3u8?ticket=test';
  let response;
  const app = await load('src/lib/cameraConnectionTest.ts', {
    './cameraMonitoring': { hasNativeCameraMonitoring: () => false },
  }, { fetch: async () => response, process: { env: { EXPO_PUBLIC_CAMERA_TEST_TIMEOUT_MS: '2000', EXPO_PUBLIC_AI_MODE: 'home_worker' } } });
  for (const [type, body, ok] of [
    ['text/html', '<html>Login</html>', false],
    ['text/plain', '<html>Login</html>', false],
    ['text/plain', '#EXTM3UX', false],
    ['text/plain', '#EXTM3U\n#EXT-X-VERSION:3', true],
  ]) {
    response = new Response(body, { headers: { 'Content-Type': type } });
    assert.equal((await app.testCameraConnection(url)).success, ok);
  }
  assert.ok(app.getCameraAddressIssue('http://127.0.0.2/live'));
  assert.ok(app.getCameraAddressIssue('http://camera.localhost/live'));
  assert.ok(guidance.cameraLinkGuidance('192.168.1.55/live', true, false));
  assert.equal(guidance.cameraLinkGuidance('', true, false), null);
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

test('old native builds stop instead of silently treating selected people as everyone', async () => {
  const configured = [];
  const app = await load('src/lib/cameraMonitoring.ts', {
    'react-native': { Platform: { OS: 'android' }, NativeModules: { BackgroundMonitoring: {
      configure: async value => configured.push(JSON.parse(value)), testSource: async () => '{}', getStates: async () => '[]',
      getCapabilities: async () => '{}',
    } } }, react: {},
  });
  await assert.rejects(app.configureNativeCameraMonitoring([{ id: 'camera', targetMemberIds: ['target'] }]));
  assert.equal(configured.length, 1); assert.equal(configured[0].length, 0);
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
    './deliveryPolicy.ts': deliveryPolicy,
    'npm:@supabase/supabase-js@2.108.2': { createClient: () => client },
  }, { crypto: (await import('node:crypto')).webcrypto,
    TextEncoder, Uint8Array, Deno: { env: { get: () => 'synthetic-test-environment' }, serve: (fn) => { handler = fn; } } });
  const body = { deviceId: '00000000-0000-0000-0000-000000000001', familyId: '00000000-0000-0000-0000-000000000002' };
  for (const action of ['register', 'event', 'revoke-user', 'revoke', 'push-self-test']) {
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
    './deliveryPolicy.ts': deliveryPolicy,
    'npm:@supabase/supabase-js@2.108.2': { createClient: () => client },
  }, { crypto: (await import('node:crypto')).webcrypto, TextEncoder, Uint8Array,
    Deno: { env: { get: () => 'synthetic-test-environment' }, serve: (fn) => { handler = fn; } } });
  const response = await handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user-session' },
    body: JSON.stringify({ action: 'register', deviceId: '00000000-0000-0000-0000-000000000001', familyId: '00000000-0000-0000-0000-000000000002' }) }));
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'family_forbidden');
});

test('foreground gallery requests cannot read a family outside the signed-in membership', async () => {
  let handler;
  const chain = { select: () => chain, eq: () => chain, then: (resolve) => resolve({ count: 0, error: null }) };
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) }, from: () => chain };
  await load('supabase/functions/native-camera-events/index.ts', {
    './deliveryPolicy.ts': deliveryPolicy, 'npm:@supabase/supabase-js@2.108.2': { createClient: () => client },
  }, { crypto: (await import('node:crypto')).webcrypto, TextEncoder, Uint8Array,
    Deno: { env: { get: () => 'synthetic-test-environment' }, serve: (fn) => { handler = fn; } } });
  const response = await handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic-session' },
    body: JSON.stringify({ action: 'identity-references', familyId: '00000000-0000-0000-0000-000000000002' }) }));
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'family_forbidden');
});

test('same fresh server gallery revision avoids clearing or redownloading templates on resume', async () => {
  const members = [{ id: 'person', display_name: 'บุคคลทดสอบ', identity_consent_at: 'synthetic-consent' }];
  const gallery = { userId: 'user', familyId: 'family', revision: 'shared-server-revision', expiresAt: Date.now() + 300000 };
  const app = await load('src/lib/monitoringIdentity.ts', {
    './supabase': { supabase: { functions: { invoke: async () => ({ data: { ...gallery, members: [] }, error: null }) } } },
    './cameraMonitoring': { supportsMonitoringIdentity: () => true, getIdentityGalleryStatus: async () => gallery,
      clearMonitoringIdentity: async () => { throw new Error('Fresh gallery must remain'); }, configureMonitoringIdentity: async () => { throw new Error('No replacement needed'); } },
  }, { fetch: async () => { throw new Error('No photo request expected'); } });
  await app.syncMonitoringIdentity('user', 'family', members, new AbortController().signal, async () => true);
});

test('late gallery response cannot overwrite identity after logout or a family change', async () => {
  const app = await load('src/lib/monitoringIdentity.ts', {
    './supabase': { supabase: { functions: { invoke: async () => ({ data: { userId: 'user', familyId: 'family', revision: 'revision', members: [] }, error: null }) } } },
    './cameraMonitoring': { supportsMonitoringIdentity: () => true, getIdentityGalleryStatus: async () => { throw new Error('Scope revoked'); },
      clearMonitoringIdentity: async () => { throw new Error('Must not change next account'); }, configureMonitoringIdentity: async () => { throw new Error('Must not install'); } },
  });
  await app.syncMonitoringIdentity('user', 'family', [{ id: 'person', identity_consent_at: 'yes' }], new AbortController().signal, async () => false);
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
    '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value), removeItem: async (key) => storage.delete(key) },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'synthetic-user' } } } }) } } }, './phone': {},
    'expo-notifications': { getPermissionsAsync: async () => ({ status: 'granted' }), getExpoPushTokenAsync: async () => { throw new Error('Synthetic FCM unavailable'); } },
  });
  assert.equal(await app.registerForPushNotificationsAsync(), false);
  assert.equal(storage.get('@push_registration_status'), 'remote_unavailable');
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
  const metadata = await app.recordFallEvent({ eventId: 'metadata-only', familyId: 'test-family', deferCloudSync: true, cloudSynced: true });
  assert.equal(metadata.cloudSynced, true);
  const cached = JSON.parse(storage.get(app.STORAGE_KEY_FALL_EVIDENCE));
  assert.equal(cached.find((record) => record.id === 'metadata-only').cloudSynced, true);
  for (let index = 0; index < 45; index++) await app.recordFallEvent({ eventId: `unsynced-${index}`, familyId: 'test-family', deferCloudSync: true });
  const backlog = JSON.parse(storage.get(app.STORAGE_KEY_FALL_EVIDENCE));
  assert.equal(backlog.filter((record) => record.id.startsWith('unsynced-')).length, 45);
});

test('temporary auth bootstrap failure does not erase the native outbox as if the user logged out', async () => {
  for (const unavailable of [true, false]) {
    const effects = []; let stops = 0;
    const controller = await load('src/components/BackgroundMonitoringController.tsx', {
      react: { useEffect: (effect) => effects.push(effect) },
      'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
      '@react-native-async-storage/async-storage': {}, './missing': {},
      '../lib/fallEvidence': {}, '../lib/backgroundMonitoring': { stopBackgroundMonitoring: async () => { stops++; } },
      '../lib/monitoringPolicy': {}, '../lib/supabase': {}, '../lib/cameraSource': {}, '../lib/nativeEventDelivery': {}, '../lib/monitoringIdentity': {},
      '../lib/cameraMonitoring': { hasNativeCameraMonitoring: () => true }, '../lib/monitoringLifecycle': {},
    });
    controller.BackgroundMonitoringController({ session: null, authenticationUnavailable: unavailable });
    const cleanup = effects[0](); await Promise.resolve(); assert.equal(stops, unavailable ? 0 : 1); cleanup();
  }
});

test('UI teardown cancels listeners but keeps independent native monitoring running', async () => {
  const effects = []; const configurations = []; let removed = 0;
  const controller = await load('src/components/BackgroundMonitoringController.tsx', {
    react: { useEffect: (effect) => effects.push(effect) },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove: () => { removed++; } }) } },
    '@react-native-async-storage/async-storage': { getItem: async () => 'synthetic-family' },
    '../lib/fallEvidence': {}, '../lib/backgroundMonitoring': {}, '../lib/monitoringPolicy': {}, '../lib/supabase': {}, '../lib/cameraSource': {},
    '../lib/nativeEventDelivery': {}, '../lib/monitoringIdentity': {}, '../lib/monitoringLifecycle': { reconcileMonitoringOwner: async () => {} },
    '../lib/cameraMonitoring': { hasNativeCameraMonitoring: () => true, configureNativeCameraMonitoring: async (sources) => configurations.push(sources),
      subscribeCameraMonitoring: () => () => { removed++; }, onCameraMonitoringRefresh: () => () => { removed++; } },
  });
  controller.BackgroundMonitoringController({ session: { user: { id: 'synthetic-user' } } });
  const cleanup = effects[0](); cleanup(); await Promise.resolve(); await Promise.resolve();
  assert.equal(configurations.length, 0); assert.equal(removed, 3);
});
