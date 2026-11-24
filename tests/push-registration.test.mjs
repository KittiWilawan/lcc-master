import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

async function fixture({ tokenFailure = false, updateFailure = false, switchedUser = false, expoGo = false } = {}) {
  const values = new Map(); let calls = 0;
  const auth = { getSession: async () => ({ data: { session: { user: { id: switchedUser && ++calls > 1 ? 'other-user' : 'test-user' } } } }) };
  const supabase = { auth, from: () => ({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updateFailure ? null : { id: 'test-user' }, error: null }) }) }) }) }) };
  const notifications = { setNotificationHandler() {}, AndroidImportance: { MAX: 5 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    setNotificationChannelAsync: async () => {}, getPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => { if (tokenFailure) throw new Error('Synthetic provider error'); return { data: 'synthetic-push-token' }; } };
  const storage = { getItem: async (key) => values.get(key), setItem: async (key, value) => { values.set(key, value); }, removeItem: async (key) => { values.delete(key); } };
  const stubs = { 'react-native': { Platform: { OS: 'android' } }, '@react-native-async-storage/async-storage': storage,
    'expo-constants': { __esModule: true, default: { executionEnvironment: expoGo ? 'store' : 'standalone', expoConfig: { extra: { eas: { projectId: 'synthetic-project' } } } }, ExecutionEnvironment: { StoreClient: 'store' } },
    './supabase': { supabase }, './phone': {}, 'expo-notifications': notifications };
  const file = resolve('src/lib/pushNotifications.ts'); const original = createRequire(file);
  const compiled = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(compiled, { module, exports: module.exports, require: (key) => stubs[key] ?? original(key), console: { log() {}, warn() {} }, setTimeout, clearTimeout });
  return { api: module.exports, values };
}
test('a push provider failure never reports remote registration as successful', async () => {
  const { api, values } = await fixture({ tokenFailure: true }); assert.equal(await api.registerForPushNotificationsAsync(), false);
  assert.equal(values.get(api.STORAGE_KEY_PUSH_REGISTRATION), 'remote_unavailable'); assert.equal(values.has(api.STORAGE_KEY_EXPO_PUSH_TOKEN), false);
});
test('missing profile or account changed mid-registration cannot produce remote_ready', async () => {
  for (const options of [{ updateFailure: true }, { switchedUser: true }]) {
    const { api, values } = await fixture(options); assert.equal(await api.registerForPushNotificationsAsync(), false);
    assert.notEqual(values.get(api.STORAGE_KEY_PUSH_REGISTRATION), 'remote_ready');
  }
});
test('remote_ready requires profile persistence and matching signed-in account', async () => {
  const { api, values } = await fixture(); assert.equal(await api.registerForPushNotificationsAsync(), true);
  assert.equal(values.get(api.STORAGE_KEY_PUSH_REGISTRATION), 'remote_ready');
});
test('Expo Go local permission does not imply remote push is ready', async () => {
  const { api, values } = await fixture({ expoGo: true }); assert.equal(await api.registerForPushNotificationsAsync(), false);
  assert.notEqual(values.get(api.STORAGE_KEY_PUSH_REGISTRATION), 'remote_ready');
});
