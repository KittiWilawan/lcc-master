import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}) {
  const filename = resolve(relative);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} }; const original = createRequire(filename);
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    console: { warn() {}, log() {} }, Date, Number }, { filename });
  return module.exports;
}
const validation = await load('src/lib/formValidation.ts');
test('email rejects junk and unsafe separators while allowing real mailbox syntax', () => {
  for (const value of ['', 'hello', '@gmail.com', 'me@', 'a@@gmail.com', 'a b@gmail.com', 'a..b@gmail.com', '.a@gmail.com', 'a@domain', 'a@-bad.com', 'a@gmai..com', 'a@domain.12', 'a@gmail.com\nother']) {
    assert.ok(validation.validateEmail(value).error, value);
  }
  for (const value of ['test@gmail.com', 'test.name+family@gmail.com', 'test@school.ac.th', 'person@outlook.com']) assert.equal(validation.validateEmail(value).error, null);
  assert.equal(validation.validateEmail(' PERSON@GMAIL.COM ').email, 'person@gmail.com');
});
test('PIN requires numeric digits and a matching second entry', () => {
  for (const [first, second] of [['1234', ''], ['1234', '123'], ['1234', '4321'], ['abcd', 'abcd'], ['12345', '12345']]) assert.ok(validation.validatePinPair(first, second));
  assert.equal(validation.validatePinPair('0123', '0123'), null);
  assert.equal(validation.normalizePin('0a1 2-345'), '0123');
});

const face = await load('src/lib/faceInspection.ts', { 'react-native': { Platform: { OS: 'android' }, NativeModules: {} } });
const photo = faces => ({ faces, minFaceWidthRatio: .16, maxFaceWidthRatio: .95 });
const clearFace = { left: .2, top: .15, width: .4, height: .5, confidence: .98 };
test('face enrollment rejects missing, multiple, tiny, cropped and invalid face results', () => {
  for (const result of [photo([]), photo([clearFace, clearFace]), photo([{ ...clearFace, width: .05 }]), photo([{ ...clearFace, left: .8 }]), photo([{ ...clearFace, width: NaN }])]) assert.ok(face.facePhotoError(result, false));
  assert.equal(face.facePhotoError(photo([clearFace]), false), null);
  assert.equal(face.facePhotoError(photo([]), true), null, 'full body framing is manual and must not be certified by a short-range face model');
});
test('unsupported runtimes do not claim automatic face validation', async () => {
  assert.equal(face.supportsFaceInspection(), false);
  assert.equal((await face.validateFacePhoto('synthetic', false)).verified, false);
});

test('photo quality failures are rejected for both faces and full body', () => {
  for (const issue of ['dark', 'bright', 'blur']) {
    for (const fullBody of [true, false]) assert.ok(face.facePhotoError({ ...photo([clearFace]), quality: { brightness: 10, sharpness: 0, issue } }, fullBody));
  }
});

const guided = await load('src/lib/guidedFaceScan.ts', { 'react-native': { Platform: { OS: 'android' }, UIManager: { getViewManagerConfig: () => null } } });
test('scan instructions distinguish image focus, illumination and a camera stall', () => {
  assert.ok(guided.scanInstruction({hint:'eyes_blur'}).includes('ไม่คม'));
  assert.ok(guided.scanInstruction({hint:'eyes_dark'}).includes('แสง'));
  assert.ok(guided.scanInstruction({hint:'camera_stalled'}).includes('ค้าง'));
});
test('guided capture validates pose, data format and size and reports unsupported builds', () => {
  assert.equal(guided.supportsGuidedFaceScan(), false);
  assert.deepEqual(Array.from(guided.scanPoses('all')), ['front', 'left', 'right']);
  const minimalJpeg = Buffer.from([255, 216, 255, 217]).toString('base64');
  assert.equal(guided.validScanCapture({ pose: 'front', base64: minimalJpeg }, 'front'), true);
  for (const capture of [{ pose: 'right', base64: minimalJpeg }, { pose: 'front', base64: 'not a photo' }, { pose: 'front', base64: 'Zm9v' }, { pose: 'front', base64: 'AA=AAA==' }, { pose: 'front', base64: 'A'.repeat(3_000_000) }]) {
    assert.equal(guided.validScanCapture(capture, 'front'), false);
  }
});

async function notificationHarness({ status = 'granted', environment = 'standalone', platform = 'android', registration = 'remote_ready' } = {}) {
  const calls = { schedules: [], channels: [], permissions: 0, remote: 0 };
  const values = new Map([['@push_registration_status', registration]]);
  const notifications = {
    setNotificationHandler() {}, AndroidImportance: { MAX: 5, HIGH: 4 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    AndroidNotificationPriority: { HIGH: 'high' }, SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    setNotificationChannelAsync: async (id, config) => { calls.channels.push({ id, config }); },
    getPermissionsAsync: async () => ({ status }), requestPermissionsAsync: async () => { calls.permissions += 1; return { status }; },
    scheduleNotificationAsync: async config => { calls.schedules.push(config); return 'test-id'; },
    getExpoPushTokenAsync: async () => { calls.remote += 1; throw new Error('Local testing must not register push'); },
  };
  const app = await load('src/lib/pushNotifications.ts', {
    'react-native': { Platform: { OS: platform } },
    'expo-constants': { __esModule: true, default: { executionEnvironment: environment }, ExecutionEnvironment: { StoreClient: 'expo' } },
    'expo-notifications': notifications,
    '@react-native-async-storage/async-storage': { getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value) },
    './supabase': { supabase: new Proxy({}, { get() { throw new Error('Local test must not touch backend or family data'); } }) },
    './phone': { getEmergencyPhoneNumber: () => 'test' },
  });
  return { app, calls, values };
}
test('local notification test is isolated from family alerts and preserves push registration', async () => {
  const { app, calls, values } = await notificationHarness();
  assert.equal(await app.scheduleLocalTestNotification(), 'test-id');
  assert.equal(calls.remote, 0); assert.equal(calls.schedules.length, 1);
  assert.equal(calls.schedules[0].content.data.type, 'notification_test');
  assert.equal(calls.schedules[0].trigger.channelId, 'looklancare-notification-test');
  assert.equal(calls.schedules[0].trigger.seconds, 3);
  assert.equal(values.get('@push_registration_status'), 'remote_ready');
});
test('denied notification permission cannot be reported as a successful test', async () => {
  const { app, calls } = await notificationHarness({ status: 'denied' });
  assert.equal(await app.scheduleLocalTestNotification(), null); assert.equal(calls.schedules.length, 0);
});
test('Expo Go supports the local test while web reports unsupported', async () => {
  const expo = await notificationHarness({ environment: 'expo' });
  assert.equal(await expo.app.scheduleLocalTestNotification(), 'test-id'); assert.equal(expo.calls.remote, 0);
  const web = await notificationHarness({ platform: 'web' });
  assert.equal(await web.app.scheduleLocalTestNotification(), null); assert.equal(web.calls.schedules.length, 0);
});

test('scheduled device tests persist after reopening and stay private to the account', async () => {
  const data = new Map();
  const storage = {
    getItem: async key => data.get(key) ?? null,
    mergeItem: async (key, raw) => data.set(key, JSON.stringify({
      ...JSON.parse(data.get(key) ?? '{}'), ...JSON.parse(raw),
    })),
  };
  const loadHistory = () => load('src/lib/localNotificationHistory.ts', { '@react-native-async-storage/async-storage': storage });
  const history = await loadHistory();
  let nextId = 'first';
  const useCase = await load('src/lib/testDeviceNotification.ts', {
    './localNotificationHistory': history,
    './pushNotifications': { scheduleLocalTestNotification: async () => nextId },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) } } },
    './appAlert': { AppAlert: { success() {}, error() {} } }, './friendlyError': { getFriendlyErrorMessage: String },
  });
  assert.equal(await useCase.testDeviceNotification(), true);
  nextId = 'second';
  assert.equal(await useCase.testDeviceNotification(), true);
  nextId = null;
  assert.equal(await useCase.testDeviceNotification(), false);
  const reopened = await loadHistory();
  assert.deepEqual(Array.from(await reopened.getScheduledTests('alice'), row => row.id), ['first', 'second']);
  assert.equal((await reopened.getScheduledTests('bob')).length, 0);
});
const persistence = await load('src/lib/faceScanSave.ts');
test('scan saving hands one immutable complete set to a single repository operation', async () => {
  const calls = []; const photos = { front: 'a', left: 'b', right: 'c' };
  await persistence.saveScanPhotoSet({ poses: ['front', 'left', 'right'], photos, isActive: () => true,
    store: async set => { calls.push(set); photos.front = 'changed'; }, onProgress() {} });
  assert.equal(calls.length, 1); assert.equal(calls[0].front, 'a');
});
test('incomplete or abandoned scans cannot start an upload', async () => {
  const store = () => { throw new Error('Must not upload'); };
  const input = { poses: ['front'], photos: {}, isActive: () => true, store, onProgress() {} };
  await assert.rejects(persistence.saveScanPhotoSet(input));
  assert.equal(await persistence.saveScanPhotoSet({ ...input, photos: { front: 'a' }, isActive: () => false }), false);
});

test('typed alerts preserve explicit kind and destructive button callbacks', async () => {
  const collected = [];
  const app = await load('src/lib/appAlert.ts', { 'react-native': { Alert: { alert() { throw new Error('Presenter is attached'); } } } });
  const detach = app.attachAlertPresenter(value => collected.push(value));
  let executed = false;
  app.AppAlert.confirm('ยืนยัน', 'ทดสอบ', [{ text: 'ลบ', style: 'destructive', onPress: () => { executed = true; } }]);
  app.AppAlert.error('ผิดพลาด', 'ทดสอบ'); app.AppAlert.success('บันทึกแล้ว', 'ทดสอบ');
  assert.deepEqual(collected.map(value => value.kind), ['confirm', 'error', 'success']);
  assert.equal(executed, false); collected[0].buttons[0].onPress(); assert.equal(executed, true); detach();
});
