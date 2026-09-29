import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describeEventAttribution, describeEventDetails, selectMonitoredCameras } from './cloud.mjs';
import { requireString } from './core.mjs';

function endpoint(config) {
  return new URL(`/functions/v1/${config.deviceFunctionName}`, config.supabaseUrl).toString();
}

async function request(connection, action, body = {}) {
  const response = await fetch(endpoint(connection.config), {
    method: 'POST',
    headers: {
      apikey: connection.config.supabaseKey,
      'x-device-token': connection.credentials.token,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(connection.config.imageTimeoutMs),
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `ระบบตอบกลับ ${response.status}`);
  return payload;
}

async function downloadReference(reference, timeoutMs) {
  const response = await fetch(reference.signedUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('ดาวน์โหลดรูปอ้างอิงไม่สำเร็จ');
  return {
    pose: reference.pose,
    storagePath: reference.storagePath,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

export async function readDeviceCredentials(path) {
  const raw = await readFile(resolve(path), 'utf8');
  const value = JSON.parse(raw);
  return {
    deviceId: requireString('deviceId', value),
    familyId: requireString('familyId', value),
    name: requireString('name', value),
    token: requireString('token', value),
  };
}

export async function connectDevice(config) {
  const credentials = await readDeviceCredentials(config.deviceCredentialsFile);
  const connection = { mode: 'device', config, credentials };
  const current = await request(connection, 'device-config');
  if (current.familyId !== credentials.familyId) throw new Error('คอมเชื่อมกับครอบครัวไม่ถูกต้อง');
  return connection;
}

export async function readDeviceCameras(connection) {
  const payload = await request(connection, 'device-config');
  const selected = selectMonitoredCameras(payload.cameras || [], payload.hasTrackedRecipients === true);
  return Promise.all(selected.map(async (camera) => {
    const references = camera.allPeopleMode ? [] : camera.identityReferences || [];
    const downloaded = await Promise.allSettled(
      references.map((reference) => downloadReference(reference, connection.config.imageTimeoutMs)),
    );
    return {
      ...camera,
      identityReferenceSignature: references.map((reference) => reference.storagePath).sort().join('|'),
      identityReferenceImages: downloaded
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value),
    };
  }));
}

export async function publishDeviceHealth(connection, _config, health) {
  await request(connection, 'device-health', health);
}

export async function finalizeDeviceFalls(connection) {
  await request(connection, 'device-finalize');
}

export async function publishDeviceFall(connection, config, camera, image, result, report) {
  const memberName = describeEventAttribution(camera, result, config.identityConfidence);
  const payload = await request(connection, 'device-event', {
    cameraId: camera.id,
    contentType: image.contentType,
    imageBase64: image.bytes.toString('base64'),
    memberName,
    details: describeEventDetails(result),
  });
  report(`ส่งเหตุที่สงสัยว่าล้มจาก ${camera.name} แล้ว`, payload.eventId);
}
