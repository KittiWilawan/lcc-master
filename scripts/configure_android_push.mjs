import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAndroidPushConfig } from './lib/android_push_config.mjs';

const input = process.argv[2];
if (!input) throw new Error('ระบุไฟล์ google-services.json ที่ดาวน์โหลดจาก Firebase');
const appPath = resolve('app.json');
const app = JSON.parse(await readFile(appPath, 'utf8'));
const raw = await readFile(resolve(input), 'utf8');
let config;
try { config = JSON.parse(raw); }
catch { throw new Error('ไฟล์ตั้งค่า Firebase ไม่ใช่ JSON ที่ถูกต้อง'); }
validateAndroidPushConfig(config, app.expo.android.package);
await writeFile(resolve('google-services.json'), raw);
await writeFile(resolve('android/app/google-services.json'), raw);
app.expo.android.googleServicesFile = './google-services.json';
await writeFile(appPath, JSON.stringify(app, null, 2) + '\n');
console.log('ตั้งค่าแอป Android แล้ว ต้องเชื่อม FCM V1 ใน Expo และสร้าง APK ใหม่ก่อนทดสอบข้ามมือถือ');
