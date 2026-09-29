import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { connectFamily, readCameras } from './cloud.mjs';
import { connectDevice, readDeviceCameras } from './device-cloud.mjs';
import { readCameraImage } from './vision.mjs';
import { readPositiveInteger, requireString } from './core.mjs';

const results = [];
const diagnosticTimeoutMs = readPositiveInteger('HOME_MONITOR_IMAGE_TIMEOUT_MS', process.env);
const startupTimeoutMs = readPositiveInteger('POSE_MODEL_STARTUP_TIMEOUT_MS', process.env);

async function check(title, task) {
  try {
    const detail = await task();
    results.push({ title, ready: true, detail });
  } catch (error) {
    results.push({
      title,
      ready: false,
      detail: error instanceof Error ? error.message : 'ตรวจไม่สำเร็จ',
    });
  }
}

function showResults() {
  console.log('\nผลตรวจ LookLanCare Monitor\n');
  for (const result of results) {
    console.log(`${result.ready ? '✓' : '✗'} ${result.title}: ${result.detail}`);
  }
  const passed = results.filter((result) => result.ready).length;
  console.log(`\nพร้อม ${passed}/${results.length} รายการ`);
  if (passed !== results.length) process.exitCode = 1;
}

let config;
await check('ค่าตั้งระบบ', async () => {
  config = await loadConfig();
  return 'อ่านค่าครบ';
});

await check('ไฟล์โมเดล AI', async () => {
  const classifier = requireString('POSE_MODEL_PATH', process.env);
  const landmarker = requireString('POSE_LANDMARKER_PATH', process.env);
  await Promise.all([access(classifier), access(landmarker)]);
  return 'พบโมเดลตรวจการล้มและโมเดลโครงกระดูก';
});

await check('Python สำหรับ AI', async () => {
  const python = requireString('POSE_PYTHON_COMMAND', process.env);
  const probe = spawnSync(python, ['-c', 'import cv2, joblib, mediapipe, numpy, sklearn'], {
    encoding: 'utf-8',
    timeout: startupTimeoutMs,
    windowsHide: true,
  });
  if (probe.error) throw probe.error;
  if (probe.status !== 0) throw new Error('ไลบรารี AI ยังติดตั้งไม่ครบ');
  return 'ไลบรารี AI พร้อม';
});

await check('บริการตรวจท่าทาง', async () => {
  const healthUrl = requireString('POSE_MODEL_HEALTH_URL', process.env);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(diagnosticTimeoutMs) });
  if (!response.ok) throw new Error(`บริการตอบกลับ ${response.status}`);
  const health = await response.json();
  if (health.status !== 'ready') throw new Error('โมเดลยังโหลดไม่เสร็จ');
  return `พร้อมตรวจภาพต่อเนื่อง ${health.frames} ภาพ`;
});

await check('Ollama ระบุตัวบุคคล', async () => {
  const healthUrl = requireString('OLLAMA_HEALTH_URL', process.env);
  const model = requireString('OLLAMA_MODEL', process.env);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(diagnosticTimeoutMs) });
  if (!response.ok) throw new Error(`Ollama ตอบกลับ ${response.status}`);
  const payload = await response.json();
  const names = (payload.models ?? []).map((item) => item.name ?? item.model);
  if (!names.includes(model)) throw new Error(`ยังไม่พบโมเดล ${model}`);
  return `พบ ${model}`;
});

let supabase;
await check('บัญชีคอมและ Supabase', async () => {
  if (!config) throw new Error('ต้องแก้ค่าตั้งระบบก่อน');
  const healthUrl = new URL('/auth/v1/health', config.supabaseUrl);
  let healthResponse;
  try {
    healthResponse = await fetch(healthUrl, {
      headers: { apikey: config.supabaseKey },
      signal: AbortSignal.timeout(diagnosticTimeoutMs),
    });
  } catch {
    throw new Error('เชื่อมต่อ Supabase ไม่ได้ กรุณาตรวจอินเทอร์เน็ตหรือสถานะโปรเจกต์');
  }
  if (!healthResponse.ok) throw new Error(`Supabase ตอบกลับ ${healthResponse.status}`);
  supabase = config.connectionMode === 'device'
    ? await connectDevice(config)
    : await connectFamily(config);
  return config.connectionMode === 'device'
    ? 'คอมจับคู่กับครอบครัวแล้ว โดยไม่ใช้รหัสผ่าน'
    : 'เข้าสู่ระบบและเข้าถึงครอบครัวได้';
});

await check('กล้องที่เฝ้าดู', async () => {
  if (!supabase || !config) throw new Error('ต้องแก้บัญชีคอมหรือ Supabase ก่อน');
  const cameras = config.connectionMode === 'device'
    ? await readDeviceCameras(supabase)
    : await readCameras(supabase, config.familyId);
  if (!cameras.length) throw new Error('ยังไม่มีกล้องภายนอกที่ผูกกับผู้รับการดูแล');
  await readCameraImage(cameras[0].snapshot_url, config);
  return `พบ ${cameras.length} กล้อง และอ่านภาพตัวอย่างสำเร็จ`;
});

if (supabase && config?.connectionMode !== 'device') await supabase.auth.signOut();
showResults();
