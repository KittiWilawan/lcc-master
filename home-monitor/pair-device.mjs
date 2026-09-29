import { hostname } from 'node:os';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { requireString } from './core.mjs';

function functionUrl(source) {
  const base = new URL(requireString('SUPABASE_URL', source));
  const functionName = requireString('MONITOR_DEVICE_FUNCTION_NAME', source);
  return new URL(`/functions/v1/${functionName}`, base).toString();
}

async function saveCredentials(path, credentials) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

const prompt = createInterface({ input, output });
try {
  console.log('\nเชื่อม LookLanCare Hub กับแอปมือถือ');
  console.log('เปิดแอป > ตรวจความพร้อม > คอมที่ใช้ตรวจภาพ > เชื่อมต่อคอมเครื่องใหม่\n');
  const code = (await prompt.question('รหัสจากแอป: ')).trim();
  const defaultName = `คอม ${hostname()}`;
  const enteredName = (await prompt.question(`ชื่อคอม (${defaultName}): `)).trim();
  const name = enteredName || defaultName;
  const response = await fetch(functionUrl(process.env), {
    method: 'POST',
    headers: {
      apikey: requireString('SUPABASE_ANON_KEY', process.env),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'pair', code, name }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `ระบบตอบกลับ ${response.status}`);
  await saveCredentials(
    requireString('HOME_MONITOR_DEVICE_CREDENTIALS_FILE', process.env),
    {
      deviceId: payload.deviceId,
      familyId: payload.familyId,
      name: payload.name,
      token: payload.token,
      pairedAt: new Date().toISOString(),
    },
  );
  console.log(`\nเชื่อม “${payload.name}” สำเร็จแล้ว`);
} catch (error) {
  console.error(`\nเชื่อมต่อไม่สำเร็จ: ${error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
