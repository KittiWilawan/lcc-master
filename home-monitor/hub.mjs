import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireString } from './core.mjs';

function runNode(script) {
  return spawnSync(process.execPath, [script], {
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });
}

function exitCode(result) {
  if (result.error) {
    console.error(`เปิดโปรแกรมไม่สำเร็จ: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

console.log('\n========================================');
console.log(' LookLanCare Hub - ระบบเฝ้าระวังบนคอม');
console.log('========================================\n');

const credentialsPath = resolve(requireString('HOME_MONITOR_DEVICE_CREDENTIALS_FILE', process.env));
if (!existsSync(credentialsPath)) {
  console.log('ยังไม่ได้เชื่อมคอมกับครอบครัวในแอป');
  const pairing = runNode('home-monitor/pair-device.mjs');
  const pairingExitCode = exitCode(pairing);
  if (pairingExitCode !== 0) process.exit(pairingExitCode);
}

console.log('\nกำลังเปิดและตรวจความพร้อมของ AI กรุณาเปิดหน้าต่างนี้ค้างไว้\n');
const monitor = runNode('home-monitor/start-monitoring.mjs');
process.exitCode = exitCode(monitor);
