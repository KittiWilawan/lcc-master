import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile();
const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
const apiKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!base || !apiKey) throw new Error('Public Supabase configuration required');
const endpoint = new URL('/functions/v1/native-camera-events', base);
const results = [];
for (const action of ['register', 'event', 'revoke-user', 'revoke']) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000), body: JSON.stringify({ action }) });
  const body = await response.json();
  results.push({ case: `${action}-without-authorization`, status: response.status, code: body.code });
  assert.equal(response.status, 401);
}
const invalid = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-token': 'synthetic-invalid-audit-token' },
  signal: AbortSignal.timeout(30000), body: JSON.stringify({ action: 'event' }) });
results.push({ case: 'invalid-device-token', status: invalid.status, code: (await invalid.json()).code });
assert.equal(invalid.status, 401);
for (const table of ['native_monitor_devices', 'native_monitor_deliveries']) {
  const response = await fetch(new URL(`/rest/v1/${table}?select=*&limit=1`, base), { headers: { apikey: apiKey }, signal: AbortSignal.timeout(30000) });
  results.push({ case: `${table}-anonymous-read`, status: response.status });
  assert.ok(response.status === 401 || response.status === 403);
}
await writeFile(process.argv[2], JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify({ passed: results.length, report: process.argv[2] }));
