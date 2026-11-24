import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import config from './config.json' with { type: 'json' };
import { applyReceipts, deliverySummary, validateTickets } from './deliveryPolicy.ts';
import { decodeEventImage } from './eventImage.ts';

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
async function push(client: Client, familyId: string, eventId: string, previousAccepted: string[], storedTickets: unknown) {
  const accepted = [...previousAccepted]; let stored = validateTickets(storedTickets);
  const { data: members, error: memberError } = await client.from('family_members').select('user_id').eq('family_id', familyId).not('user_id', 'is', null);
  if (memberError) throw new RequestError(503, 'database_unavailable');
  const ids = Array.from(new Set((members ?? []).map((member) => member.user_id)));
  const { data: profiles, error } = await client.from('profiles').select('expo_push_token,fall_alerts').in('id', ids);
  if (error) throw new RequestError(503, 'database_unavailable');
  const tokens = Array.from(new Set((profiles ?? []).filter((profile) => profile.fall_alerts !== false)
    .map((profile) => profile.expo_push_token).filter((token): token is string => typeof token === 'string' && !!token)));
  const pending = [];
  for (const token of tokens) { const hash = await digest(token); if (!accepted.includes(hash)) pending.push({ token, hash }); }
  for (let offset = 0; offset < pending.length; offset += config.maxPushBatch) {
  const batch = pending.slice(offset, offset + config.maxPushBatch);
  let response: Response;
  try { response = await fetch(config.pushUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify(batch.map(({ token }) => ({
      to: token, title: 'พบเหตุที่สงสัยว่าอาจล้ม', body: 'เปิด LookLanCare เพื่อตรวจสอบภาพและช่วยเหลือ',
      data: { eventId, type: 'fall_alert' }, sound: 'default', priority: 'high', channelId: config.pushChannel,
    }))) }); }
  catch { return { accepted, tickets: stored, state: 'push_unavailable', remoteAccepted: false, deliveryComplete: false }; }
  if (!response.ok) return { accepted, tickets: stored, state: 'push_unavailable', remoteAccepted: false, deliveryComplete: false };
  const payload = await response.json(); const tickets = Array.isArray(payload.data) ? payload.data : [];
  for (let index = 0; index < batch.length; index++) {
    const item = batch[index]; const ticket = tickets[index];
    if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
      accepted.push(item.hash); stored.push({ hash: item.hash, id: ticket.id, sentAt: Date.now(), state: 'queued' });
    } else if (ticket?.details?.error === 'DeviceNotRegistered') {
      await client.from('profiles').update({ expo_push_token: null }).eq('expo_push_token', item.token);
    }
  }
  }
  const unresolved = stored.filter((ticket) => ticket.state === 'queued');
  if (unresolved.length) {
    try {
      const response = await fetch(config.receiptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify({ ids: unresolved.map((ticket) => ticket.id) }) });
      if (response.ok) stored = applyReceipts(stored, (await response.json()).data ?? {}, Date.now(), config.receiptMaxAgeMs);
      else stored = applyReceipts(stored, {}, Date.now(), config.receiptMaxAgeMs);
    } catch { stored = applyReceipts(stored, {}, Date.now(), config.receiptMaxAgeMs); }
    for (const ticket of stored.filter((row) => row.error === 'DeviceNotRegistered')) {
      for (const token of tokens) if (await digest(token) === ticket.hash) {
        await client.from('profiles').update({ expo_push_token: null }).eq('expo_push_token', token);
      }
    }
  }
  const tokenHashes = await Promise.all(tokens.map(digest));
  const { count } = await client.from('native_notification_receipts').select('event_id', { count: 'exact', head: true }).eq('event_id', eventId);
  return { accepted, tickets: stored, ...deliverySummary(tokenHashes, accepted, stored, count ?? 0) };
}
async function publish(client: Client, request: Request, body: Body) {
  const owner = await device(client, request); const eventId = uuid(body, 'eventId'); const cameraId = uuid(body, 'cameraId');
  const { data: camera, error: cameraError } = await client.from('cameras').select('id,name').eq('id', cameraId).eq('family_id', owner.family_id).maybeSingle();
  if (cameraError) throw new RequestError(503, 'database_unavailable');
  if (!camera) throw new RequestError(403, 'camera_forbidden');
  const { data: existing, error: existingError } = await client.from('fall_events').select('family_id,image_url').eq('id', eventId).maybeSingle();
  if (existingError) throw new RequestError(503, 'database_unavailable');
  if (existing && existing.family_id !== owner.family_id) throw new RequestError(403, 'event_forbidden');
  if (existing) {
    const { data: delivery, error } = await client.from('native_monitor_deliveries').select('device_id').eq('event_id', eventId).maybeSingle();
    if (error) throw new RequestError(503, 'database_unavailable');
    if (!delivery || delivery.device_id !== owner.id) throw new RequestError(403, 'event_forbidden');
  }
  let binary: Uint8Array | null;
  try { binary = decodeEventImage(body, Boolean(existing), config.maxImageBytes); }
  catch { throw new RequestError(400, 'invalid_image'); }
  const imagePath = existing ? existing.image_url : binary ? `${owner.family_id}/${eventId}.jpg` : null;
  if (!existing && binary && imagePath) {
    const { error: uploadError } = await client.storage.from('fall-evidence').upload(imagePath,
      binary, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new RequestError(503, 'storage_unavailable');
  }
  const createdAt = text(body, 'createdAt');
  if (!Number.isFinite(Date.parse(createdAt))) throw new RequestError(400, 'invalid_request');
  let memberName = 'ยังไม่ยืนยันตัวบุคคล';
  if (typeof body.memberId === 'string' && (body.identityState === 'face_confirmed' || body.identityState === 'recent_face')) {
    const { data: member, error } = await client.from('family_members').select('display_name,identity_consent_at')
      .eq('id', uuid(body, 'memberId')).eq('family_id', owner.family_id).maybeSingle();
    if (error) throw new RequestError(503, 'database_unavailable');
    if (member?.identity_consent_at) memberName = `อาจเป็น ${member.display_name}`;
  }
  const { error: eventError } = await client.from('fall_events').upsert({ id: eventId, family_id: owner.family_id,
    camera_name: camera.name, member_name: memberName, image_url: imagePath,
    details: text(body, 'details'), status: 'pending', event_type: 'actual', created_at: createdAt }, { onConflict: 'id', ignoreDuplicates: true });
  if (eventError) throw new RequestError(503, 'database_unavailable');
  const { error: queueError } = await client.from('native_monitor_deliveries').upsert({ event_id: eventId, device_id: owner.id }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (queueError) throw new RequestError(503, 'database_unavailable');
  const { data: claimed, error: claimError } = await client.rpc('claim_native_monitor_delivery', { p_event_id: eventId, p_device_id: owner.id, p_seconds: config.eventLeaseSeconds });
  if (claimError) throw new RequestError(503, 'database_unavailable');
  if (!claimed) return { cloudSynced: true, remoteAccepted: false, state: 'delivery_busy', imagePath };
  try {
    const { data: delivery, error } = await client.from('native_monitor_deliveries').select('accepted_tokens,push_tickets').eq('event_id', eventId).eq('device_id', owner.id).single();
    if (error) throw new RequestError(503, 'database_unavailable');
    const result = await push(client, owner.family_id, eventId, delivery.accepted_tokens, delivery.push_tickets);
    const { error: updateError } = await client.from('native_monitor_deliveries').update({ accepted_tokens: result.accepted, push_tickets: result.tickets, last_result: result.state,
      lease_until: null, updated_at: new Date().toISOString() }).eq('event_id', eventId).eq('device_id', owner.id);
    if (updateError) throw new RequestError(503, 'database_unavailable');
    return { cloudSynced: true, remoteAccepted: result.remoteAccepted, deliveryComplete: result.deliveryComplete,
      providerConfirmed: 'providerConfirmed' in result ? result.providerConfirmed : false,
      receivedCount: 'receivedCount' in result ? result.receivedCount : 0, state: result.state, imagePath };
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
    if (body.action === 'push-self-test') {
      const userId = await signedIn(client, request);
      const testId = body.testId === undefined ? crypto.randomUUID() : uuid(body, 'testId');
      const { data: profile, error } = await client.from('profiles').select('expo_push_token').eq('id', userId).maybeSingle();
      if (error) throw new RequestError(503, 'database_unavailable');
      if (!profile?.expo_push_token) return json({ remoteAccepted: false, state: 'no_token' });
      const response = await fetch(config.pushUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify({ to: profile.expo_push_token,
          title: 'ทดสอบ LookLanCare', body: 'ข้อความทดสอบจากระบบส่วนกลาง ไม่มีเหตุล้มจริง',
          data: { type: 'notification_test', testId, userId }, sound: 'default', priority: 'high', channelId: config.pushChannel }) });
      if (!response.ok) return json({ remoteAccepted: false, state: 'push_unavailable' });
      const payload = await response.json();
      const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      return json({ testId, remoteAccepted: ticket?.status === 'ok' && typeof ticket.id === 'string', state: ticket?.status === 'ok' ? 'ticket_accepted' : 'push_unavailable' });
    }
    if (body.action === 'identity-references') {
      let owner: { user_id: string; family_id: string };
      if (request.headers.has('x-device-token')) owner = await device(client, request);
      else {
        const userId = await signedIn(client, request); const familyId = uuid(body, 'familyId');
        await membership(client, userId, familyId);
        owner = { user_id: userId, family_id: familyId };
      }
      const { data: members, error } = await client.from('family_members').select('id,display_name,identity_consent_at')
        .eq('family_id', owner.family_id).is('user_id', null).not('identity_consent_at', 'is', null).order('id').limit(config.maxIdentityMembers + 1);
      if (error) throw new RequestError(503, 'database_unavailable');
      if ((members?.length ?? 0) > config.maxIdentityMembers) throw new RequestError(409, 'too_many_identity_members');
      const ids = (members ?? []).map((member) => member.id);
      const { data: rows, error: referenceError } = ids.length ? await client.from('identity_references')
        .select('member_id,pose,storage_path,created_at').eq('family_id', owner.family_id).in('member_id', ids).neq('pose', 'full_body') : { data: [], error: null };
      if (referenceError) throw new RequestError(503, 'database_unavailable');
      const references = [...(rows ?? [])].sort((a, b) => a.storage_path.localeCompare(b.storage_path));
      const revision = await digest(JSON.stringify({ members, references }));
      const prepared = [];
      for (const member of members ?? []) {
        const photos = [];
        for (const reference of references.filter((row) => row.member_id === member.id)) {
          const { data, error } = await client.storage.from('identity-references').createSignedUrl(reference.storage_path, config.identityReferenceTtlSeconds);
          if (error || !data?.signedUrl) throw new RequestError(503, 'storage_unavailable');
          photos.push(data.signedUrl);
        }
        prepared.push({ id: member.id, name: member.display_name, photos });
      }
      return json({ userId: owner.user_id, familyId: owner.family_id, revision, members: prepared });
    }
    if (body.action === 'acknowledge') {
      const userId = await signedIn(client, request); const eventId = uuid(body, 'eventId');
      const { data: event, error } = await client.from('fall_events').select('family_id').eq('id', eventId).maybeSingle();
      if (error) throw new RequestError(503, 'database_unavailable');
      if (!event) throw new RequestError(404, 'event_not_found');
      await membership(client, userId, event.family_id);
      const { error: ackError } = await client.from('native_notification_receipts').upsert({ event_id: eventId, user_id: userId,
        ...(body.opened === true ? { opened_at: new Date().toISOString() } : {}) }, { onConflict: 'event_id,user_id', ignoreDuplicates: body.opened !== true });
      if (ackError) throw new RequestError(503, 'database_unavailable');
      return json({ acknowledged: true });
    }
    if (body.action === 'delivery-status') {
      const userId = await signedIn(client, request); const eventId = uuid(body, 'eventId');
      const { data: event, error } = await client.from('fall_events').select('family_id').eq('id', eventId).maybeSingle();
      if (error) throw new RequestError(503, 'database_unavailable');
      if (!event) throw new RequestError(404, 'event_not_found');
      await membership(client, userId, event.family_id);
      const [{ data: delivery, error: stateError }, { data: receipts, error: receiptError }] = await Promise.all([
        client.from('native_monitor_deliveries').select('last_result,push_tickets').eq('event_id', eventId).maybeSingle(),
        client.from('native_notification_receipts').select('user_id,received_at').eq('event_id', eventId).order('received_at'),
      ]);
      if (stateError || receiptError) throw new RequestError(503, 'database_unavailable');
      const acknowledgements = receipts ?? [];
      const memberNames = new Map<string, string>();
      if (acknowledgements.length) {
        const { data: members, error: memberError } = await client.from('family_members')
          .select('user_id,display_name').eq('family_id', event.family_id).in('user_id', acknowledgements.map(row => row.user_id));
        if (memberError) throw new RequestError(503, 'database_unavailable');
        for (const member of members ?? []) memberNames.set(member.user_id, member.display_name);
      }
      const tickets = validateTickets(delivery?.push_tickets);
      return json({ state: delivery?.last_result ?? 'not_sent', recipientsAccepted: tickets.length,
        providerConfirmedCount: tickets.filter((ticket) => ticket.state === 'provider_confirmed').length,
        failedCount: tickets.filter((ticket) => ticket.state === 'failed' || ticket.state === 'expired').length,
        receivedCount: acknowledgements.length, receipts: acknowledgements.map(row => ({
          name: memberNames.get(row.user_id) || 'ผู้ดูแล', acknowledgedAt: row.received_at,
        })) });
    }
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
