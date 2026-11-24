import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}, env = {}) {
  const filename = resolve(relative);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} }; const original = createRequire(filename);
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    Date, URL, process: { env }, console: { warn() {} } }, { filename });
  return module.exports;
}
const policy = await load('src/lib/monitoringPolicy.ts', { './cameraSource': {} });
async function video(options = {}) {
  const userId = 'synthetic-user'; const familyId = 'synthetic-family';
  const chain = { select: () => chain, eq: () => chain, is: () => chain, abortSignal: async () => ({ data: options.members ?? [], error: options.error }) };
  return load('src/lib/videoFallTest.ts', {
    'react-native': { Platform: { OS: options.os ?? 'android' }, NativeModules: { VideoFallTest: options.native } },
    '@react-native-async-storage/async-storage': { getItem: async () => familyId },
    './monitoringPolicy': policy,
    './supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: userId } } }),
      getSession: async () => ({ data: { session: { user: { id: options.currentUser ?? userId } } } }) }, from: () => chain } },
    './monitoringIdentity': { syncMonitoringIdentity: options.sync ?? (async () => {}) },
    './cameraMonitoring': { getIdentityGalleryStatus: async () => options.gallery ?? {} },
  });
}
test('no recipients and all disabled recipients choose all-people video mode', async () => {
  for (const members of [[], [{ id: 'disabled', is_tracked: false, display_name: 'ผู้ทดสอบ' }]]) {
    const api = await video({ members });
    assert.equal((await api.getVideoTestScope(new AbortController().signal)).targetMemberIds.length, 0);
  }
});
test('multiple active recipients survive video scope loading; disabled people do not', async () => {
  const api = await video({ members: [{ id: 'b', is_tracked: true }, { id: 'a', is_tracked: true }, { id: 'c', is_tracked: false }] });
  assert.deepEqual([...(await api.getVideoTestScope(new AbortController().signal)).targetMemberIds], ['a', 'b']);
});
test('database failures, changed account and cancellation never fall back to all-people mode', async () => {
  for (const options of [{ error: new Error('offline') }, { currentUser: 'another-user' }]) {
    const api = await video(options);
    await assert.rejects(api.getVideoTestScope(new AbortController().signal));
  }
  const api = await video(); const controller = new AbortController(); controller.abort();
  await assert.rejects(api.getVideoTestScope(controller.signal));
});
test('an active target without scoped and fresh reference vectors blocks a video test', async () => {
  const members = [{ id: 'target', is_tracked: true }];
  for (const gallery of [{}, { userId: 'other', familyId: 'synthetic-family', expiresAt: Date.now() + 60000, memberIds: ['target'] },
    { userId: 'synthetic-user', familyId: 'synthetic-family', expiresAt: 1, memberIds: ['target'] }]) {
    const api = await video({ members, gallery });
    await assert.rejects(api.getVideoTestScope(new AbortController().signal, true));
  }
  const api = await video({ members, gallery: { userId: 'synthetic-user', familyId: 'synthetic-family', expiresAt: Date.now() + 60000, memberIds: ['target'] } });
  assert.deepEqual([...(await api.getVideoTestScope(new AbortController().signal, true)).targetMemberIds], ['target']);
});
test('video requests send explicit selected IDs only to native; remote links and Expo Go are refused', async () => {
  const requests = [];
  const api = await video({ native: { start: async json => { requests.push(JSON.parse(json)); return JSON.stringify({ framesAnalyzed: 2 }); } } });
  const scope = { userId: 'synthetic-user', familyId: 'synthetic-family', targetMemberIds: ['target'], names: ['ผู้ทดสอบ'] };
  await api.startVideoFallTest('job', 'file:///test-cache/clip.mp4', scope);
  assert.deepEqual(requests[0].targetMemberIds, ['target']);
  await assert.rejects(api.startVideoFallTest('job', 'https://example.invalid/clip.mp4', scope));
  assert.equal(requests.length, 1);
  const unavailable = await video();
  await assert.rejects(unavailable.startVideoFallTest('job', 'file:///test-cache/clip.mp4', scope));
});
test('legacy image AI cannot silently alert everyone while a target is active', async () => {
  let invocations = 0;
  const camera = { select: () => camera, eq: () => camera, maybeSingle: async () => ({ data: { family_id: 'synthetic-family' } }) };
  const members = { select: () => members, eq: () => members, is: async () => ({ data: [{ id: 'target', is_tracked: true }] }) };
  const api = await load('src/lib/cameraAnalysis.ts', {
    './monitoringPolicy': policy,
    './supabase': { supabase: { from: name => name === 'cameras' ? camera : members, functions: { invoke: async () => { invocations++; } } } },
  }, { EXPO_PUBLIC_AI_FUNCTION_NAME: 'synthetic-provider' });
  await assert.rejects(api.analyzeCameraImages('camera', 'data:image/jpeg;base64,synthetic'));
  assert.equal(invocations, 0);
});
