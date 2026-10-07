import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import config from './config.json' with { type: 'json' };

type Client = ReturnType<typeof createClient>;
type Body = Record<string, unknown>;
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: Body, status = 200) => new Response(JSON.stringify(body), { status, headers });
class RequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new RequestError(503, 'service_unavailable'); return value; }
function text(body: Body, key: string) {
  const value = body[key]; if (typeof value !== 'string' || !value || value.length > config.maxTextLength) throw new RequestError(400, 'invalid_request');
  return value;
}
function uuid(body: Body, key: string) {
  const value = text(body, key); const parts = value.split('-');
  if (parts.map((part) => part.length).join(',') !== '8,4,4,4,12' ||
    [...parts.join('').toLowerCase()].some((char) => !'0123456789abcdef'.includes(char))) throw new RequestError(400, 'invalid_request');
  return value;
}
async function digest(value: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function membership(client: Client, userId: string, familyId: string) {
  const { count, error } = await client.from('family_members').select('id', { count: 'exact', head: true })
    .eq('family_id', familyId).eq('user_id', userId);
  if (error) throw new RequestError(503, 'database_unavailable');
  if (!count) throw new RequestError(403, 'family_forbidden');
}
async function signedIn(client: Client, request: Request) {
  const header = request.headers.get('Authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new RequestError(401, 'unauthorized');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new RequestError(401, 'unauthorized');
  return data.user.id;
}
async function device(client: Client, request: Request) {
  const token = request.headers.get('x-device-token');
  if (!token || token.length > config.maxTextLength) throw new RequestError(401, 'unauthorized');
  const { data, error } = await client.from('native_monitor_devices').select('id,user_id,family_id,expires_at')
    .eq('token_hash', await digest(token)).is('revoked_at', null).maybeSingle();
  if (error) throw new RequestError(503, 'database_unavailable');
  if (!data || Date.parse(data.expires_at) <= Date.now()) throw new RequestError(401, 'device_expired');
  await membership(client, data.user_id, data.family_id);
  return data;
}
async function register(client: Client, request: Request, body: Body) {
  const userId = await signedIn(client, request); const familyId = uuid(body, 'familyId'); const id = uuid(body, 'deviceId');
  await membership(client, userId, familyId);
  const { data: existing, error: readError } = await client.from('native_monitor_devices').select('user_id').eq('id', id).maybeSingle();
  if (readError) throw new RequestError(503, 'database_unavailable');
  if (existing && existing.user_id !== userId) throw new RequestError(403, 'device_forbidden');
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.deviceTokenDays * 86400000).toISOString();
  const { error } = await client.from('native_monitor_devices').upsert({ id, user_id: userId, family_id: familyId,
    token_hash: await digest(token), expires_at: expiresAt, revoked_at: null });
  if (error) throw new RequestError(503, 'database_unavailable');
  return { deviceId: id, token, expiresAt };
}
async function push(client: Client, familyId: string, eventId: string, accepted: string[]) {
  const { data: members, error: memberError } = await client.from('family_members').select('user_id').eq('family_id', familyId).not('user_id', 'is', null);
  if (memberError) throw new RequestError(503, 'database_unavailable');
  const ids = Array.from(new Set((members ?? []).map((member) => member.user_id)));
  const { data: profiles, error } = await client.from('profiles').select('expo_push_token,fall_alerts').in('id', ids);
  if (error) throw new RequestError(503, 'database_unavailable');
  const tokens = Array.from(new Set((profiles ?? []).filter((profile) => profile.fall_alerts !== false)
    .map((profile) => profile.expo_push_token).filter((token): token is string => typeof token === 'string' && !!token)));
  const pending = [];
  for (const token of tokens) { const hash = await digest(token); if (!accepted.includes(hash)) pending.push({ token, hash }); }
  if (!tokens.length) return { accepted, state: 'no_recipients', remoteAccepted: false };
  if (!pending.length) return { accepted, state: 'accepted', remoteAccepted: true };
  const response = await fetch(config.pushUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify(pending.map(({ token }) => ({
      to: token, title: 'พบเหตุที่สงสัยว่าอาจล้ม', body: 'เปิด LookLanCare เพื่อตรวจสอบภาพและช่วยเหลือ',
      data: { eventId, type: 'fall_alert' }, sound: 'default', priority: 'high', channelId: config.pushChannel,
    }))) });
  if (!response.ok) return { accepted, state: 'push_unavailable', remoteAccepted: false };
  const payload = await response.json(); const tickets = Array.isArray(payload.data) ? payload.data : [];
  pending.forEach((item, index) => { if (tickets[index]?.status === 'ok' && typeof tickets[index]?.id === 'string') accepted.push(item.hash); });
  const tokenHashes = await Promise.all(tokens.map(digest));
  const remoteAccepted = tokenHashes.every((hash) => accepted.includes(hash));
  return { accepted, state: remoteAccepted ? 'accepted' : 'push_rejected', remoteAccepted };
}
async function publish(client: Client, request: Request, body: Body) {
  const owner = await device(client, request); const eventId = uuid(body, 'eventId'); const cameraId = uuid(body, 'cameraId');
  const { data: camera, error: cameraError } = await client.from('cameras').select('id,name').eq('id', cameraId).eq('family_id', owner.family_id).maybeSingle();
  if (cameraError) throw new RequestError(503, 'database_unavailable');
  if (!camera) throw new RequestError(403, 'camera_forbidden');
  const { data: existing, error: existingError } = await client.from('fall_events').select('family_id').eq('id', eventId).maybeSingle();
  if (existingError) throw new RequestError(503, 'database_unavailable');
  if (existing && existing.family_id !== owner.family_id) throw new RequestError(403, 'event_forbidden');
  if (existing) {
    const { data: delivery, error } = await client.from('native_monitor_deliveries').select('device_id').eq('event_id', eventId).maybeSingle();
    if (error) throw new RequestError(503, 'database_unavailable');
    if (!delivery || delivery.device_id !== owner.id) throw new RequestError(403, 'event_forbidden');
  }
  const imageValue = body.imageBase64;
  if (typeof imageValue !== 'string' || imageValue.length > Math.ceil(config.maxImageBytes / 3) * 4) throw new RequestError(400, 'invalid_image');
  let binary: string; try { binary = atob(imageValue); } catch { throw new RequestError(400, 'invalid_image'); }
  if (!binary.length || binary.length > config.maxImageBytes || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216) throw new RequestError(400, 'invalid_image');
  const imagePath = `${owner.family_id}/${eventId}.jpg`;
  if (!existing) {
    const { error: uploadError } = await client.storage.from('fall-evidence').upload(imagePath,
      Uint8Array.from(binary, (char) => char.charCodeAt(0)), { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new RequestError(503, 'storage_unavailable');
  }
  const createdAt = text(body, 'createdAt');
  if (!Number.isFinite(Date.parse(createdAt))) throw new RequestError(400, 'invalid_request');
  const { error: eventError } = await client.from('fall_events').upsert({ id: eventId, family_id: owner.family_id,
    camera_name: camera.name, member_name: 'ยังไม่ยืนยันตัวบุคคล', image_url: imagePath,
    details: text(body, 'details'), status: 'pending', event_type: 'actual', created_at: createdAt }, { onConflict: 'id', ignoreDuplicates: true });
  if (eventError) throw new RequestError(503, 'database_unavailable');
  const { error: queueError } = await client.from('native_monitor_deliveries').upsert({ event_id: eventId, device_id: owner.id }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (queueError) throw new RequestError(503, 'database_unavailable');
  const { data: claimed, error: claimError } = await client.rpc('claim_native_monitor_delivery', { p_event_id: eventId, p_device_id: owner.id, p_seconds: config.eventLeaseSeconds });
  if (claimError) throw new RequestError(503, 'database_unavailable');
  if (!claimed) return { cloudSynced: true, remoteAccepted: false, state: 'delivery_busy' };
  try {
    const { data: delivery, error } = await client.from('native_monitor_deliveries').select('accepted_tokens').eq('event_id', eventId).eq('device_id', owner.id).single();
    if (error) throw new RequestError(503, 'database_unavailable');
    const result = await push(client, owner.family_id, eventId, delivery.accepted_tokens);
    const { error: updateError } = await client.from('native_monitor_deliveries').update({ accepted_tokens: result.accepted, last_result: result.state,
      lease_until: null, updated_at: new Date().toISOString() }).eq('event_id', eventId).eq('device_id', owner.id);
    if (updateError) throw new RequestError(503, 'database_unavailable');
    return { cloudSynced: true, remoteAccepted: result.remoteAccepted, state: result.state, imagePath };
  } catch (error) {
    await client.from('native_monitor_deliveries').update({ lease_until: null }).eq('event_id', eventId).eq('device_id', owner.id);
    throw error;
  }
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
  try {
    const raw = await request.text(); if (new TextEncoder().encode(raw).length > config.maxBodyBytes) throw new RequestError(413, 'body_too_large');
    let body: Body; try { body = JSON.parse(raw); } catch { throw new RequestError(400, 'invalid_request'); }
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new RequestError(400, 'invalid_request');
    const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === 'register') return json(await register(client, request, body));
    if (body.action === 'revoke-user') {
      const userId = await signedIn(client, request); const id = uuid(body, 'deviceId');
      const { error } = await client.from('native_monitor_devices').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      if (error) throw new RequestError(503, 'database_unavailable');
      return json({ revoked: true });
    }
    if (body.action === 'event') return json(await publish(client, request, body));
    if (body.action === 'revoke') {
      const owner = await device(client, request);
      const { error } = await client.from('native_monitor_devices').update({ revoked_at: new Date().toISOString() }).eq('id', owner.id);
      if (error) throw new RequestError(503, 'database_unavailable');
      return json({ revoked: true });
    }
    return json({ code: 'invalid_request' }, 400);
  } catch (error) {
    return json({ code: error instanceof RequestError ? error.code : 'service_unavailable' }, error instanceof RequestError ? error.status : 503);
  }
});
