import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function connectFamily(config) {
  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (signInError) throw signInError;
  const { data, error } = await client.from('families').select('id')
    .eq('id', config.familyId).maybeSingle();
  if (error || !data) throw new Error('บัญชีคอมไม่มีสิทธิ์เข้าถึงครอบครัวที่ตั้งค่า');
  return client;
}

export async function readCameras(client, familyId) {
  const [{ data, error }, { count, error: memberError }] = await Promise.all([
    client.from('cameras')
      .select('id,name,type,snapshot_url,assigned_member_id,family_members(display_name,is_tracked,user_id,identity_references(storage_path,pose))')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true }),
    client.from('family_members').select('id', { count: 'exact', head: true })
      .eq('family_id', familyId).is('user_id', null).eq('is_tracked', true),
  ]);
  if (error) throw error;
  if (memberError) throw memberError;
  const cameras = selectMonitoredCameras(data || [], Number(count) > 0);
  return Promise.all(cameras.map(async (camera) => {
    const references = camera.allPeopleMode ? [] : camera.family_members?.identity_references || [];
    return {
      ...camera,
      identityReferenceSignature: references.map((reference) => reference.storage_path).sort().join('|'),
      identityReferenceImages: await downloadIdentityReferences(client, references),
    };
  }));
}

async function downloadIdentityReferences(client, references) {
  const downloaded = await Promise.allSettled(references.map(async (reference) => {
    const { data, error } = await client.storage.from('identity-references')
      .download(reference.storage_path);
    if (error || !data) throw error || new Error('ดาวน์โหลดรูปอ้างอิงไม่สำเร็จ');
    return {
      pose: reference.pose,
      storagePath: reference.storage_path,
      bytes: Buffer.from(await data.arrayBuffer()),
    };
  }));
  return downloaded
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
}

export function selectMonitoredCameras(cameras, hasTrackedRecipients = cameras.some((camera) =>
  camera.family_members?.is_tracked === true && camera.family_members?.user_id === null
)) {
  const ready = cameras.filter((camera) => camera.type !== 'device' && camera.snapshot_url);
  if (!hasTrackedRecipients) {
    return ready.map((camera) => ({ ...camera, allPeopleMode: true }));
  }
  return ready.filter((camera) => camera.assigned_member_id &&
    camera.family_members?.is_tracked === true && camera.family_members?.user_id === null)
    .map((camera) => ({ ...camera, allPeopleMode: false }));
}

export async function publishHealth(client, config, health) {
  const { error } = await client.from('monitor_health').upsert({
    family_id: config.familyId,
    state: health.state,
    camera_count: health.cameraCount,
    analyzed_count: health.analyzedCount,
    error_count: health.errorCount,
    detail: health.detail,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'family_id' });
  if (error) throw error;
}

async function sendFamilyPush(client, config, camera, eventId, report, phase) {
  const { data: members, error: memberError } = await client.from('family_members')
    .select('user_id').eq('family_id', config.familyId);
  if (memberError) throw memberError;
  const userIds = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))];
  if (!userIds.length) return;
  const { data: profiles, error: profileError } = await client.from('profiles')
    .select('expo_push_token,fall_alerts').in('id', userIds);
  if (profileError) throw profileError;
  const tokens = [...new Set((profiles || [])
    .filter((profile) => profile.fall_alerts !== false)
    .map((profile) => profile.expo_push_token)
    .filter((token) => typeof token === 'string' && token.length > 0))];
  if (!tokens.length) {
    report('บันทึกเหตุการณ์แล้ว แต่ยังไม่มีมือถือที่ลงทะเบียนรับ Push');
    return;
  }
  const messages = tokens.map((to) => ({
    to,
    title: phase === 'pending' ? 'AI สงสัยว่าอาจเกิดการล้ม' : 'กรุณาตรวจสอบเหตุที่อาจล้ม',
    body: phase === 'pending'
      ? `ตรวจสอบภาพจาก ${camera.name} · ${camera.attributionLabel} และยกเลิกในแอปหากเป็นเหตุผิดพลาด`
      : `เหตุจาก ${camera.name} · ${camera.attributionLabel} ยังไม่มีการยกเลิก กรุณาตรวจสอบทันที`,
    data: { type: 'fall_alert', eventId, phase },
    sound: 'default',
    priority: 'high',
    channelId: 'emergency-fall-channel',
  }));
  const response = await fetch(config.pushUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.imageTimeoutMs),
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`ส่ง Push ไม่สำเร็จ (${response.status})`);
  const payload = await response.json();
  const tickets = Array.isArray(payload.data) ? payload.data : [payload.data];
  const failures = tickets.filter((ticket) => !ticket || ticket.status !== 'ok');
  if (failures.length) report('Push บางเครื่องส่งไม่สำเร็จ', `${failures.length}/${tokens.length}`);
}

async function finalizeFallEvent(client, config, event, report) {
  const { data: finalized, error } = await client.rpc('finalize_pending_fall', {
    p_event_id: event.id,
  });
  if (error) throw error;
  if (!finalized) return false;
  report(`ยืนยันเหตุที่สงสัยว่าล้มจาก ${event.camera_name}`, event.id);
  try {
    await sendFamilyPush(client, config, {
      name: event.camera_name,
      attributionLabel: event.member_name || 'ยังไม่ยืนยันตัวบุคคล',
    }, event.id, report, 'notified');
  } catch (pushError) {
    report('ยืนยันเหตุการณ์แล้ว แต่ส่ง Push รอบสุดท้ายไม่สำเร็จ', pushError.message);
  }
  return true;
}

export async function finalizeOutstandingFalls(client, config, report) {
  const { data: events, error } = await client.from('fall_events')
    .select('id,camera_name,member_name,resolution_deadline')
    .eq('family_id', config.familyId)
    .eq('status', 'pending')
    .lte('resolution_deadline', new Date().toISOString())
    .order('resolution_deadline', { ascending: true })
    .limit(50);
  if (error) throw error;
  for (const event of events || []) await finalizeFallEvent(client, config, event, report);
}

export async function publishFall(client, config, camera, image, result, report) {
  const extension = image.contentType === 'image/png' ? 'png' : 'jpg';
  const imagePath = `${config.familyId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage.from('fall-evidence')
    .upload(imagePath, image.bytes, { contentType: image.contentType, upsert: false });
  if (uploadError) report(`เก็บภาพหลักฐานของ ${camera.name} ไม่สำเร็จ`, uploadError.message);
  const deadline = new Date(Date.now() + config.cancelWindowMs);
  const attributionLabel = describeEventAttribution(camera, result, config.identityConfidence);
  const { data: event, error: eventError } = await client.from('fall_events').insert({
    family_id: config.familyId,
    member_name: attributionLabel,
    camera_name: camera.name,
    image_url: uploadError ? null : imagePath,
    details: describeEventDetails(result),
    event_type: 'actual',
    status: 'pending',
    resolution_deadline: deadline.toISOString(),
  }).select('id').single();
  if (eventError || !event) throw eventError || new Error('บันทึกเหตุการณ์ไม่สำเร็จ');
  report(`รอยืนยันเหตุที่สงสัยว่าล้มจาก ${camera.name}`, event.id);
  try {
    await sendFamilyPush(client, config, { ...camera, attributionLabel }, event.id, report, 'pending');
  } catch (error) {
    report('บันทึกเหตุการณ์แล้ว แต่ส่ง Push รอบแรกไม่สำเร็จ', error.message);
  }
  const remainingMs = Math.max(0, deadline.getTime() - Date.now());
  if (remainingMs) await new Promise((resolve) => setTimeout(resolve, remainingMs));
  const finalized = await finalizeFallEvent(client, config, {
    id: event.id, camera_name: camera.name, member_name: attributionLabel,
  }, report);
  if (!finalized) {
    report('เหตุที่สงสัยว่าล้มถูกยกเลิกหรือรับทราบแล้ว', event.id);
  }
}

export function describeEventAttribution(camera, result, identityThreshold) {
  if (camera.allPeopleMode) return 'บุคคลที่ตรวจพบ · โหมดตรวจทุกคน';
  const name = camera.family_members?.display_name;
  if (name && result.fallingPersonMatch === 'confirmed_target' &&
      result.identityConfidence >= identityThreshold) {
    return `AI เปรียบเทียบแล้วว่าอาจเป็น ${name}`;
  }
  return name ? `ยังไม่ยืนยันตัวบุคคล · กำลังเฝ้าดู ${name}` : 'ยังไม่ยืนยันตัวบุคคล';
}

export function describeEventDetails(result) {
  const identity = result.fallingPersonMatch === 'confirmed_target'
    ? `รูปอ้างอิงสอดคล้อง ${Math.round(result.identityConfidence * 100)}%`
    : result.fallingPersonMatch === 'not_target'
      ? 'คนที่เกิดเหตุไม่ตรงกับบุคคลเป้าหมาย'
      : result.fallingPersonMatch === 'possible_target'
        ? `อาจเป็นบุคคลเป้าหมาย ${Math.round(result.identityConfidence * 100)}% แต่หลักฐานยังไม่พอ`
        : 'ยังยืนยันตัวบุคคลไม่ได้';
  const context = `พบ ${result.peopleCount} คนในภาพ`;
  return `${result.reason} · ${context} · ${identity}`;
}
