import { createClient } from 'npm:@supabase/supabase-js@2.108.2';

type JsonRecord = Record<string, unknown>;

const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function readPositiveInteger(name: string): number {
  const value = Number(requireEnvironment(name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => String(byte % 10)).join('');
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function normalizePairingCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value).filter((character) => character >= '0' && character <= '9').join('');
}

function readBodyObject(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request body');
  return value as JsonRecord;
}

async function userFromRequest(request: Request, publicClient: ReturnType<typeof createClient>) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const { data, error } = await publicClient.auth.getUser(authorization.slice(7));
  return error ? null : data.user;
}

async function requireFamilyOwner(service: ReturnType<typeof createClient>, familyId: string, userId: string) {
  const { data, error } = await service.from('families').select('id')
    .eq('id', familyId).eq('owner_id', userId).maybeSingle();
  if (error || !data) throw new Error('Only the family owner can manage a home computer');
}

async function authenticateDevice(service: ReturnType<typeof createClient>, request: Request) {
  const token = request.headers.get('x-device-token')?.trim();
  if (!token) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await service.from('monitor_devices')
    .select('id,family_id,name').eq('token_hash', tokenHash).is('revoked_at', null).maybeSingle();
  return error ? null : data;
}

async function sendPush(service: ReturnType<typeof createClient>, familyId: string, payload: {
  eventId: string;
  title: string;
  body: string;
  phase: 'pending' | 'notified';
}) {
  const pushUrl = requireEnvironment('EXPO_PUSH_URL');
  const { data: members } = await service.from('family_members').select('user_id').eq('family_id', familyId);
  const userIds = [...new Set((members ?? []).map((member) => member.user_id).filter(Boolean))];
  if (!userIds.length) return;
  const { data: profiles } = await service.from('profiles')
    .select('expo_push_token,fall_alerts').in('id', userIds);
  const tokens = [...new Set((profiles ?? [])
    .filter((profile) => profile.fall_alerts !== false)
    .map((profile) => profile.expo_push_token)
    .filter((token) => typeof token === 'string' && token.length > 0))];
  if (!tokens.length) return;
  await fetch(pushUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: { type: 'fall_alert', eventId: payload.eventId, phase: payload.phase },
      sound: 'default',
      priority: 'high',
      channelId: 'emergency-fall-channel',
    }))),
  });
}

async function createPairing(service: ReturnType<typeof createClient>, body: JsonRecord, userId: string) {
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  await requireFamilyOwner(service, familyId, userId);
  const codeLength = readPositiveInteger('MONITOR_PAIRING_CODE_LENGTH');
  const ttlSeconds = readPositiveInteger('MONITOR_PAIRING_TTL_SECONDS');
  const code = randomDigits(codeLength);
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await service.from('monitor_pairing_codes').delete()
    .eq('family_id', familyId).eq('created_by', userId).is('used_at', null);
  const { error } = await service.from('monitor_pairing_codes').insert({
    family_id: familyId,
    code_hash: codeHash,
    created_by: userId,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { code, expiresAt };
}

async function pairDevice(service: ReturnType<typeof createClient>, body: JsonRecord) {
  const code = normalizePairingCode(body.code);
  const expectedLength = readPositiveInteger('MONITOR_PAIRING_CODE_LENGTH');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (code.length !== expectedLength || !name) throw new Error('Pairing code or computer name is invalid');
  const codeHash = await sha256(code);
  const { data: pairing, error: pairingError } = await service.from('monitor_pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id,family_id,created_by')
    .maybeSingle();
  if (pairingError || !pairing) throw new Error('Pairing code is invalid or expired');

  const token = randomToken(readPositiveInteger('MONITOR_DEVICE_TOKEN_BYTES'));
  const { data: device, error: deviceError } = await service.from('monitor_devices').insert({
    family_id: pairing.family_id,
    name,
    token_hash: await sha256(token),
    created_by: pairing.created_by,
  }).select('id,family_id,name').single();
  if (deviceError || !device) throw deviceError ?? new Error('Unable to register computer');
  return { deviceId: device.id, familyId: device.family_id, name: device.name, token };
}

async function listDevices(service: ReturnType<typeof createClient>, body: JsonRecord, userId: string) {
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const { data: membership } = await service.from('family_members').select('id')
    .eq('family_id', familyId).eq('user_id', userId).maybeSingle();
  if (!membership) throw new Error('Family unavailable');
  const { data, error } = await service.from('monitor_devices')
    .select('id,name,state,detail,camera_count,analyzed_count,error_count,last_seen_at,created_at,revoked_at')
    .eq('family_id', familyId).order('created_at', { ascending: false });
  if (error) throw error;
  return { devices: data ?? [] };
}

async function revokeDevice(service: ReturnType<typeof createClient>, body: JsonRecord, userId: string) {
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  await requireFamilyOwner(service, familyId, userId);
  const { error } = await service.from('monitor_devices').update({
    revoked_at: new Date().toISOString(),
    state: 'stopped',
    detail: 'ยกเลิกการเชื่อมต่อจากแอป',
  }).eq('id', deviceId).eq('family_id', familyId);
  if (error) throw error;
  return { revoked: true };
}

async function deviceConfiguration(service: ReturnType<typeof createClient>, device: { id: string; family_id: string }) {
  const [{ data, error }, { count, error: memberError }] = await Promise.all([
    service.from('cameras')
      .select('id,name,type,url,protocol,snapshot_url,assigned_member_id,family_members(display_name,is_tracked,user_id,identity_references(storage_path,pose))')
      .eq('family_id', device.family_id).order('created_at', { ascending: true }),
    service.from('family_members').select('id', { count: 'exact', head: true })
      .eq('family_id', device.family_id).is('user_id', null).eq('is_tracked', true),
  ]);
  if (error) throw error;
  if (memberError) throw memberError;
  const hasTrackedRecipients = Number(count) > 0;
  const signedUrlSeconds = readPositiveInteger('MONITOR_REFERENCE_URL_TTL_SECONDS');
  const cameras = await Promise.all((data ?? []).map(async (camera) => {
    const references = hasTrackedRecipients && camera.family_members?.is_tracked === true &&
      camera.family_members?.user_id === null
      ? camera.family_members?.identity_references ?? [] : [];
    const signedReferences = await Promise.all(references.map(async (reference: { storage_path: string; pose: string }) => {
      const { data: signed } = await service.storage.from('identity-references')
        .createSignedUrl(reference.storage_path, signedUrlSeconds);
      return { pose: reference.pose, storagePath: reference.storage_path, signedUrl: signed?.signedUrl ?? null };
    }));
    return { ...camera, identityReferences: signedReferences.filter((reference) => reference.signedUrl) };
  }));
  return { familyId: device.family_id, hasTrackedRecipients, cameras };
}

async function publishDeviceHealth(service: ReturnType<typeof createClient>, device: { id: string; family_id: string }, body: JsonRecord) {
  const allowedStates = new Set(['idle', 'running', 'degraded', 'stopped']);
  const state = typeof body.state === 'string' && allowedStates.has(body.state) ? body.state : 'degraded';
  const cameraCount = Number.isSafeInteger(body.cameraCount) ? Number(body.cameraCount) : 0;
  const analyzedCount = Number.isSafeInteger(body.analyzedCount) ? Number(body.analyzedCount) : 0;
  const errorCount = Number.isSafeInteger(body.errorCount) ? Number(body.errorCount) : 0;
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 500) : null;
  const now = new Date().toISOString();
  const { error: deviceError } = await service.from('monitor_devices').update({
    state, detail, camera_count: cameraCount, analyzed_count: analyzedCount,
    error_count: errorCount, last_seen_at: now,
  }).eq('id', device.id);
  if (deviceError) throw deviceError;
  const { error: healthError } = await service.from('monitor_health').upsert({
    family_id: device.family_id, device_id: device.id, state, detail,
    camera_count: cameraCount, analyzed_count: analyzedCount, error_count: errorCount, checked_at: now,
  }, { onConflict: 'family_id' });
  if (healthError) throw healthError;
  return { accepted: true };
}

function decodeImage(value: unknown, maxBytes: number): Uint8Array {
  if (typeof value !== 'string' || !value) throw new Error('Missing event image');
  const binary = atob(value);
  if (!binary.length || binary.length > maxBytes) throw new Error('Event image is too large');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function publishDeviceEvent(
  service: ReturnType<typeof createClient>,
  device: { id: string; family_id: string },
  body: JsonRecord,
) {
  const cameraId = typeof body.cameraId === 'string' ? body.cameraId : '';
  const contentType = body.contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const image = decodeImage(body.imageBase64, readPositiveInteger('MONITOR_EVENT_IMAGE_MAX_BYTES'));
  const memberName = typeof body.memberName === 'string' ? body.memberName.slice(0, 300) : 'ยังไม่ยืนยันตัวบุคคล';
  const details = typeof body.details === 'string' ? body.details.slice(0, 1000) : 'AI ตรวจพบเหตุที่อาจล้ม';
  const { data: camera, error: cameraError } = await service.from('cameras')
    .select('id,name').eq('id', cameraId).eq('family_id', device.family_id).maybeSingle();
  if (cameraError || !camera) throw new Error('Camera unavailable');

  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const imagePath = `${device.family_id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await service.storage.from('fall-evidence')
    .upload(imagePath, image, { contentType, upsert: false });
  const deadline = new Date(Date.now() + readPositiveInteger('MONITOR_CANCEL_WINDOW_SECONDS') * 1000);
  const { data: event, error: eventError } = await service.from('fall_events').insert({
    family_id: device.family_id,
    member_name: memberName,
    camera_name: camera.name,
    image_url: uploadError ? null : imagePath,
    details,
    event_type: 'actual',
    status: 'pending',
    resolution_deadline: deadline.toISOString(),
  }).select('id').single();
  if (eventError || !event) throw eventError ?? new Error('Unable to save event');
  await sendPush(service, device.family_id, {
    eventId: event.id,
    title: 'AI สงสัยว่าอาจเกิดการล้ม',
    body: `ตรวจสอบภาพจาก ${camera.name} · ${memberName}`,
    phase: 'pending',
  });
  return { eventId: event.id, resolutionDeadline: deadline.toISOString() };
}

async function finalizeDeviceEvents(service: ReturnType<typeof createClient>, device: { family_id: string }) {
  const { data: events, error } = await service.from('fall_events')
    .select('id,camera_name,member_name')
    .eq('family_id', device.family_id)
    .eq('status', 'pending')
    .lte('resolution_deadline', new Date().toISOString())
    .order('resolution_deadline', { ascending: true })
    .limit(50);
  if (error) throw error;
  let finalizedCount = 0;
  for (const event of events ?? []) {
    const { data: changed } = await service.from('fall_events').update({ status: 'notified' })
      .eq('id', event.id).eq('status', 'pending').select('id').maybeSingle();
    if (!changed) continue;
    finalizedCount += 1;
    await sendPush(service, device.family_id, {
      eventId: event.id,
      title: 'กรุณาตรวจสอบเหตุที่อาจล้ม',
      body: `เหตุจาก ${event.camera_name} · ${event.member_name || 'ยังไม่ยืนยันตัวบุคคล'}`,
      phase: 'notified',
    });
  }
  return { finalizedCount };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: responseHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const supabaseUrl = requireEnvironment('SUPABASE_URL');
    const anonKey = requireEnvironment('SUPABASE_ANON_KEY');
    const serviceKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const body = readBodyObject(await request.json());
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'pair') return json(await pairDevice(service, body));

    if (action === 'device-config' || action === 'device-health' ||
        action === 'device-event' || action === 'device-finalize') {
      const device = await authenticateDevice(service, request);
      if (!device) return json({ error: 'Device unauthorized' }, 401);
      if (action === 'device-config') return json(await deviceConfiguration(service, device));
      if (action === 'device-health') return json(await publishDeviceHealth(service, device, body));
      if (action === 'device-event') return json(await publishDeviceEvent(service, device, body));
      return json(await finalizeDeviceEvents(service, device));
    }

    const user = await userFromRequest(request, publicClient);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (action === 'create-pairing') return json(await createPairing(service, body, user.id));
    if (action === 'list-devices') return json(await listDevices(service, body, user.id));
    if (action === 'revoke-device') return json(await revokeDevice(service, body, user.id));
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return json({ error: message }, 400);
  }
});
