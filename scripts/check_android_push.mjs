import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAndroidPushConfig, matchingAndroidPushConfigs } from './lib/android_push_config.mjs';

const output = process.argv[2];
const app = JSON.parse(await readFile(resolve('app.json'), 'utf8')).expo;
const report = { androidPackage: app.android.package, expoProjectConfigured: Boolean(app.extra?.eas?.projectId),
  firebaseClientPresent: false, androidClientMatches: false, nativeClientPresent: false,
  firebaseClientValid: false, nativeClientValid: false, sameFirebaseProject: false, clientConfigReady: false, errors: [],
  serverFcmCredential: 'requires_check_in_expo_account', physicalReceptionTest: 'not_yet_verified' };
const validated = [];
for (const [file, flag] of [['google-services.json', 'firebaseClientPresent'], ['android/app/google-services.json', 'nativeClientPresent']]) {
  try {
    const value = JSON.parse(await readFile(resolve(file), 'utf8'));
    report[flag] = true;
    validated.push(validateAndroidPushConfig(value, app.android.package));
    report[flag === 'firebaseClientPresent' ? 'firebaseClientValid' : 'nativeClientValid'] = true;
  } catch (error) {
    validated.push(null);
    if (error.code !== 'ENOENT') report.errors.push({ file, message: error instanceof SyntaxError ? 'ไฟล์ JSON ไม่ถูกต้อง' : error.message });
  }
}
report.sameFirebaseProject = matchingAndroidPushConfigs(...validated);
report.androidClientMatches = report.firebaseClientValid && report.nativeClientValid && report.sameFirebaseProject;
report.clientConfigReady = report.androidClientMatches && report.expoProjectConfigured;
if (output) await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
