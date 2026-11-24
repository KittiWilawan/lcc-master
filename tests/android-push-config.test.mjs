import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndroidPushConfig, matchingAndroidPushConfigs } from '../scripts/lib/android_push_config.mjs';

const packageName = 'com.example.audit';
const fixture = () => ({ project_info: { project_id: 'synthetic-project', project_number: '123456' }, client: [
  { client_info: { mobilesdk_app_id: 'synthetic-android-client', android_client_info: { package_name: packageName } }, api_key: [{ current_key: 'synthetic-public-key' }] },
] });

test('client setup accepts matching Android metadata without returning its API key', () => {
  const result = validateAndroidPushConfig(fixture(), packageName);
  assert.equal(result.packageName, packageName);
  assert.equal(JSON.stringify(result).includes('synthetic-public-key'), false);
});
test('client setup refuses private service-account files even if client data was appended', () => {
  for (const secret of [{ type: 'service_account' }, { private_key: 'synthetic-private-key' }, { private_key_id: 'synthetic-key-id' }]) {
    assert.throws(() => validateAndroidPushConfig({ ...fixture(), ...secret }, packageName));
  }
});
test('wrong package and missing registration key cannot become ready', () => {
  assert.throws(() => validateAndroidPushConfig(fixture(), 'com.example.other'));
  const missing = fixture(); missing.client[0].api_key = [];
  assert.throws(() => validateAndroidPushConfig(missing, packageName));
});
test('root and native configuration must describe the same Firebase Android app', () => {
  const first = validateAndroidPushConfig(fixture(), packageName);
  assert.equal(matchingAndroidPushConfigs(first, { ...first }), true);
  for (const key of ['projectId', 'projectNumber', 'applicationId', 'packageName']) {
    assert.equal(matchingAndroidPushConfigs(first, { ...first, [key]: 'other' }), false);
  }
  assert.equal(matchingAndroidPushConfigs(first, null), false);
});
