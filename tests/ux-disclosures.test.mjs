import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Runs the real component handlers and re-renders with local hook state. No device or service is used.
async function componentHarness(file, exported, seniorMode = false) {
  let cursor = 0;
  const state = [];
  const filename = path.resolve(file);
  const original = createRequire(filename);
  const module = { exports: {} };
  const guidance = ts.transpileModule(await fs.readFile('src/lib/cameraLinkGuidance.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const guidanceExports = {};
  vm.runInNewContext(guidance.outputText, { exports: guidanceExports, URL });
  const colors = { card: '#fff', cardBorder: '#ccc', accentBg: '#eee', accentText: '#064',
    textPrimary: '#111', textSecondary: '#555', warningText: '#840', dangerText: '#900', inputBg: '#fafafa' };
  const overrides = {
    '../lib/cameraLinkGuidance': guidanceExports,
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    } },
    'react-native': { StyleSheet: { create: styles => styles }, Platform: { OS: 'android' },
      ActivityIndicator: 'Spinner', TextInput: 'Input', TouchableOpacity: 'Button', View: 'View' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../context/ThemeContext': { useTheme: () => ({ colors, seniorMode }) },
    './CareText': { CareText: 'Text' },
  };
  const code = ts.transpileModule(await fs.readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : original(name) }, { filename });
  return props => { cursor = 0; return module.exports[exported](props); };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[].concat(tree.props?.children ?? []).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [].concat(tree.props?.children ?? []).map(text).join(' ');
}
function byId(tree, id) {
  const found = nodes(tree).find(node => node.props?.testID === id);
  assert.ok(found, `Missing control: ${id}`);
  return found;
}
const summary = { title: 'รอยืนยันบุคคล', detail: 'จะไม่เปลี่ยนไปตรวจทุกคน', tone: 'attention', rows: [
  { id: 'camera', title: 'ภาพกล้อง', detail: 'ได้รับภาพ 1 กล้อง', tone: 'ready' },
  { id: 'ai', title: 'AI', detail: 'กำลังวิเคราะห์', tone: 'ready' },
  { id: 'person', title: 'บุคคล', detail: 'ยืนยันล่าสุดได้ 0 คน', tone: 'attention' },
] };

test('collapsing status details never hides uncertain identity or an AI problem', async () => {
  const render = await componentHarness('src/components/MonitoringStatusCard.tsx', 'MonitoringStatusCard');
  const props = { summary, onSettings() {} };
  let tree = render(props);
  assert.ok(text(tree).includes('ยืนยันล่าสุดได้ 0 คน'));
  assert.equal(byId(tree, 'monitoring-details-toggle').props.accessibilityState.expanded, false);
  byId(tree, 'monitoring-details-toggle').props.onPress();
  tree = render(props);
  assert.ok(text(tree).includes('จะไม่เปลี่ยนไปตรวจทุกคน'));
  assert.ok(text(tree).includes('กำลังวิเคราะห์'));
  assert.equal(byId(tree, 'monitoring-details-toggle').props.accessibilityState.expanded, true);
  byId(tree, 'monitoring-details-toggle').props.onPress();
  tree = render({ ...props, summary: { ...summary, rows: summary.rows.map(row => row.id === 'ai'
    ? { ...row, detail: 'ยังวิเคราะห์ภาพไม่ได้', tone: 'waiting' } : row) } });
  assert.ok(text(tree).includes('ยังวิเคราะห์ภาพไม่ได้'));
  assert.ok(text(tree).includes('ยืนยันล่าสุดได้ 0 คน'));
});

test('status settings action stays usable while the repeated action can be omitted', async () => {
  const render = await componentHarness('src/components/MonitoringStatusCard.tsx', 'MonitoringStatusCard', true);
  let clicked = false;
  let tree = render({ summary, onSettings: () => { clicked = true; } });
  nodes(tree).find(node => node.props?.accessibilityLabel === 'ตรวจและตั้งค่าระบบ').props.onPress();
  assert.equal(clicked, true);
  tree = render({ summary });
  assert.equal(nodes(tree).filter(node => node.props?.accessibilityLabel === 'ตรวจและตั้งค่าระบบ').length, 0);
  assert.ok(byId(tree, 'monitoring-details-toggle'));
});

const cameraProps = () => ({ type: 'rtsp', url: '', snapshotUrl: '', homeWorkerMode: false,
  onTypeChange() {}, onUrlChange() {}, onSnapshotChange() {}, onTest() {}, saving: false,
  test: { state: 'idle', message: '' } });

test('camera guidance distinguishes local MJPEG addresses from valid HLS links containing MJPEG in the query', async () => {
  const render = await componentHarness('src/components/CameraSourceFields.tsx', 'CameraSourceFields');
  const failed = { ...cameraProps(), test: { state: 'error', message: 'ยังรับภาพไม่ได้' } };
  const bad = text(render({ ...failed, url: 'http://localhost:8090/video.MJPG?oid=1' }));
  assert.ok(bad.includes('ใช้ IP ของคอมแทน localhost') && bad.includes('ลิงก์นี้มีนามสกุล MJPEG') && bad.includes('ลองอีกครั้ง'));
  const valid = text(render({ ...failed, url: 'https://camera.test/live.m3u8?old=video.mjpg' }));
  assert.ok(!valid.includes('ลิงก์นี้มีนามสกุล MJPEG'));
});

test('Android one-link form does not require a snapshot and help can be opened and closed', async () => {
  const render = await componentHarness('src/components/CameraSourceFields.tsx', 'CameraSourceFields', true);
  const props = cameraProps();
  let tree = render(props);
  assert.equal(nodes(tree).filter(node => node.type === 'Input').length, 1);
  assert.equal(nodes(tree).some(node => node.props?.testID === 'camera-link-help'), false);
  byId(tree, 'camera-link-help-toggle').props.onPress();
  tree = render(props);
  assert.ok(text(byId(tree, 'camera-link-help')).includes('HLS'));
  assert.ok(text(tree).includes('IP ของคอมแทน localhost'));
  assert.ok(text(tree).includes('RTSP หรือ MJPEG'));
  byId(tree, 'camera-link-help-toggle').props.onPress();
  assert.equal(nodes(render(props)).some(node => node.props?.testID === 'camera-link-help'), false);
});

test('camera inputs and test action respect the in-flight test and do not report live AI from connection alone', async () => {
  const render = await componentHarness('src/components/CameraSourceFields.tsx', 'CameraSourceFields');
  const props = cameraProps();
  let sent;
  props.onUrlChange = value => { sent = value; };
  let tree = render(props);
  nodes(tree).find(node => node.type === 'Input').props.onChangeText('https://camera.test/live.m3u8');
  assert.equal(sent, 'https://camera.test/live.m3u8');
  const testButton = value => nodes(value).find(node => node.props?.accessibilityLabel === 'ทดสอบการเชื่อมต่อกล้อง');
  assert.equal(testButton(tree).props.disabled, true);
  props.url = sent;
  tree = render(props);
  assert.equal(testButton(tree).props.disabled, false);
  tree = render({ ...props, test: { state: 'testing', message: 'กำลังรับภาพ' } });
  assert.equal(testButton(tree).props.disabled, true);
  assert.ok(nodes(tree).filter(node => node.type === 'Input').every(node => node.props.editable === false));
  tree = render({ ...props, test: { state: 'success', message: 'รับภาพสำเร็จ' } });
  assert.ok(text(byId(tree, 'camera-test-result')).includes('หลังบันทึกให้ดูสถานะ'));
});

test('alternative sources remain selectable and choosing a device removes URL requirements', async () => {
  const render = await componentHarness('src/components/CameraSourceFields.tsx', 'CameraSourceFields');
  const props = cameraProps();
  let tree = render(props);
  nodes(tree).find(node => text(node).includes('ใช้กล้องมือถือหรือวิดีโอแทน') && node.type === 'Button').props.onPress();
  tree = render(props);
  assert.equal(nodes(tree).filter(node => node.props?.accessibilityRole === 'radio').length, 3);
  tree = render({ ...props, type: 'device' });
  assert.equal(nodes(tree).filter(node => node.type === 'Input').length, 0);
  assert.equal(nodes(tree).some(node => node.props?.accessibilityLabel === 'ทดสอบการเชื่อมต่อกล้อง'), false);
  assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === 'กล้องมือถือเครื่องนี้').props.accessibilityState.checked, true);
});

test('the computer-worker video flow still exposes the separate AI snapshot input', async () => {
  const render = await componentHarness('src/components/CameraSourceFields.tsx', 'CameraSourceFields');
  const tree = render({ ...cameraProps(), type: 'video', homeWorkerMode: true });
  assert.equal(nodes(tree).filter(node => node.type === 'Input').length, 2);
  assert.ok(text(tree).includes('สำหรับ AI'));
  assert.equal(text(tree).includes('ไม่ต้องกรอกลิงก์ภาพนิ่งเพิ่ม'), false);
});
