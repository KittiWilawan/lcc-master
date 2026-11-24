import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}) {
  const filename = resolve(relative);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} }; const original = createRequire(filename);
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    Date, setInterval: () => 0, clearInterval() {} }, { filename });
  return module.exports;
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(value => find(value, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}
async function harness(store, compare = async () => {}) {
  const hooks = []; let cursor = 0; let pending = []; let listener; let closed = 0;
  const react = {
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useState(value) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof value === 'function' ? value() : value };
      return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
    useEffect(effect, dependencies) { const index = cursor++; const previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) pending.push(() => {
        previous?.cleanup?.(); hooks[index] = { dependencies, cleanup: effect() }; }); },
  };
  const rn = { Platform: { OS: 'android' }, UIManager: {},
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View', Linking: {},
    StyleSheet: { create: value => value, absoluteFill: {} }, requireNativeComponent: () => 'NativeScanner',
    AppState: { currentState: 'active', addEventListener: (_name, callback) => { listener = callback; return { remove() {} }; } } };
  const guided = await load('src/lib/guidedFaceScan.ts', { 'react-native': rn });
  const save = await load('src/lib/faceScanSave.ts');
  const { GuidedFaceScanModal } = await load('src/components/GuidedFaceScanModal.tsx', {
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../lib/faceInspection': { supportsPoseRetake: () => true, checkPoseReplacement: compare },
    react, 'react-native': rn, 'expo-camera': { useCameraPermissions: () => [{ granted: true }, async () => {}] },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../context/ThemeContext': { useTheme: () => ({ colors: {} }) }, '../lib/guidedFaceScan': guided,
    '../lib/faceScanSave': save, '../lib/friendlyError': { getFriendlyErrorMessage: error => error.message },
  });
  const props = { target: 'all', onClose: () => { closed++; }, onSaveSet: store };
  let tree;
  const render = () => { cursor = 0; tree = GuidedFaceScanModal(props); const effects = pending; pending = []; effects.forEach(effect => effect()); return tree; };
  render();
  const scanner = find(tree, node => node.type === 'NativeScanner')[0];
  const jpeg = Buffer.from([255, 216, 255, 217]).toString('base64');
  for (const pose of ['front', 'left', 'right']) scanner.props.onScanCapture({ nativeEvent: { pose, runId: 0, base64: jpeg } });
  render();
  return {
    render, closed: () => closed,
    retake: poseLabel => {
      const button = find(tree, node => node.props?.accessibilityLabel === `ถ่ายมุม${poseLabel}ใหม่`)[0];
      assert.ok(button); button.props.onPress(); render();
      return tree.props;
    },
    imageCount: () => find(tree, node => node.type === 'Image').length,
    pause: () => { rn.AppState.currentState = 'background'; listener('background'); render(); },
    resume: () => { rn.AppState.currentState = 'active'; listener('active'); render(); },
    save: () => {
      const button = find(tree, node => typeof node.props?.onPress === 'function' && find(node, child => child.type === 'Text' &&
        (child.props.children === 'บันทึกรูปอ้างอิง' || child.props.children === 'ลองบันทึกอีกครั้ง')).length > 0)[0];
      assert.ok(button, 'Complete drafts must offer a save/retry action'); button.props.onPress(); render();
    },
    unmount: () => hooks.forEach(hook => hook?.cleanup?.()),
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('a retake replaces just the matched pose and a failed comparison preserves the draft', async () => {
  let committed;
  const replacements = [];
  const h = await harness(async photos => { committed = photos; }, async (candidate, retained) => {
    assert.equal(retained.length, 2); replacements.push(candidate);
    if (candidate === 'other-person') throw new Error('mismatch');
  });
  const left = h.retake('หันซ้าย');
  assert.equal(left.target, 'left');
  await assert.rejects(left.onReplace('other-person', () => true));
  left.onClose(); h.render();
  const right = h.retake('หันขวา');
  await right.onReplace('matched-new-photo', () => true); right.onClose(); h.render();
  h.save(); await flush(); h.render();
  assert.deepEqual(replacements, ['other-person','matched-new-photo']);
  assert.equal(committed.front, committed.left); assert.notEqual(committed.left, 'other-person');
  assert.equal(committed.right, 'matched-new-photo'); h.unmount();
});
test('background saving preserves the complete draft and closes only after foreground return', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let calls = 0;
  const h = await harness(async (photos, options) => { calls++; assert.equal(Object.keys(photos).length, 3);
    options.onProgress(['front']); await waiting; assert.equal(options.isActive(), true); options.onProgress(['front', 'left', 'right']); });
  h.save(); h.pause(); assert.equal(h.imageCount(), 3); release(); await flush(); h.render();
  assert.equal(calls, 1); assert.equal(h.closed(), 0); assert.equal(h.imageCount(), 3);
  h.resume(); assert.equal(h.closed(), 1); h.unmount();
});
test('failed batch save retains all captured photos for a full-set retry', async () => {
  let calls = 0;
  const h = await harness(async photos => { calls++; assert.equal(Object.keys(photos).length, 3); if (calls === 1) throw new Error('Network interrupted'); });
  h.save(); await flush(); h.render(); assert.equal(h.imageCount(), 3); assert.equal(h.closed(), 0);
  h.save(); await flush(); h.render(); assert.equal(calls, 2); assert.equal(h.closed(), 1); h.unmount();
});
test('unmount revokes the save operation owner before later stages can commit', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let stillActive;
  const h = await harness(async (_photos, options) => { await waiting; stillActive = options.isActive(); if (!stillActive) throw new Error('Cancelled'); });
  h.save(); h.unmount(); release(); await flush(); assert.equal(stillActive, false); assert.equal(h.closed(), 0);
});
