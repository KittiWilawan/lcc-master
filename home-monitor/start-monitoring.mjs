import { spawn } from 'node:child_process';
import { readPositiveInteger, requireString } from './core.mjs';

const poseHealthUrl = requireString('POSE_MODEL_HEALTH_URL', process.env);
const startupTimeoutMs = readPositiveInteger('POSE_MODEL_STARTUP_TIMEOUT_MS', process.env);
const startupPollMs = readPositiveInteger('POSE_MODEL_STARTUP_POLL_MS', process.env);
const children = [];
let stopping = false;

function start(script) {
  const child = spawn(process.execPath, [script], {
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

async function waitForPoseService(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (child.exitCode !== null) throw new Error('บริการโมเดลท่าทางหยุดก่อนพร้อมใช้งาน');
    try {
      const response = await fetch(poseHealthUrl, { signal: AbortSignal.timeout(startupPollMs) });
      if (response.ok && (await response.json()).status === 'ready') return;
    } catch {
      // The service is still loading its model.
    }
    await new Promise((resolve) => setTimeout(resolve, startupPollMs));
  }
  throw new Error('บริการโมเดลท่าทางเริ่มทำงานไม่ทันเวลาที่กำหนด');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

try {
  const pose = start('home-monitor/pose-service-launcher.mjs');
  await waitForPoseService(pose);
  console.log('โมเดลท่าทางพร้อม เริ่มระบบเฝ้าระวัง');
  const worker = start('home-monitor/worker.mjs');
  worker.once('exit', (code) => {
    stop();
    process.exitCode = code ?? 1;
  });
  pose.once('exit', (code) => {
    if (!stopping) {
      console.error('บริการโมเดลท่าทางหยุดทำงาน');
      stop();
      process.exitCode = code ?? 1;
    }
  });
} catch (error) {
  console.error('เริ่มระบบเฝ้าระวังไม่สำเร็จ:', error.message);
  stop();
  process.exitCode = 1;
}
