import { encode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { clearMonitoringIdentity, configureMonitoringIdentity, getIdentityGalleryStatus, supportsMonitoringIdentity } from './cameraMonitoring';
import config from '../../android/app/src/main/assets/monitoring/identity.json';
import cloud from '../../android/app/src/main/assets/monitoring/cloud.json';

interface Member { id: string; display_name: string; identity_consent_at: string | null }
interface References { userId: string; familyId: string; revision: string; members: { id: string; name: string; photos: string[] }[] }
/** Download only consenting references; native keeps encrypted vectors, never these photos. */
export async function syncMonitoringIdentity(userId: string, familyId: string, members: Member[],
  signal: AbortSignal, stillActive: () => Promise<boolean>): Promise<void> {
  if (!supportsMonitoringIdentity()) return;
  const allowed = members.filter((member) => member.identity_consent_at);
  if (!allowed.length) { await clearMonitoringIdentity(); return; }
  if (allowed.length > config.maxMembers) throw new Error(`เครื่องนี้จับคู่บุคคลได้สูงสุด ${config.maxMembers} คน`);
  // Native refresh and JS use the same server revision, avoiding template churn on resume.
  const { data, error } = await supabase.functions.invoke<References>(cloud.functionName,
    { body: { action: 'identity-references', familyId } });
  if (error) throw error;
  if (signal.aborted || !await stillActive()) return;
  if (!data || data.userId !== userId || data.familyId !== familyId || typeof data.revision !== 'string' ||
    !data.revision || !Array.isArray(data.members) || data.members.length > config.maxMembers) throw new Error('ข้อมูลรูปอ้างอิงไม่ตรงบัญชี');
  const { revision } = data;
  const current = await getIdentityGalleryStatus();
  if (current.userId === userId && current.familyId === familyId && current.revision === revision &&
    (current.expiresAt ?? 0) - Date.now() > config.galleryRenewBeforeMs) return;
  // Revocation/replacement removes stale templates before network work begins.
  await clearMonitoringIdentity();
  const prepared = [];
  for (const member of data.members) {
    if (!allowed.some((value) => value.id === member.id) || typeof member.name !== 'string' ||
      !Array.isArray(member.photos) || member.photos.length > config.maxReferences) throw new Error('ข้อมูลสมาชิกไม่ตรงกับครอบครัว');
    const chosen = member.photos;
    if (chosen.length < config.minReferences) continue;
    const photos = [];
    for (const url of chosen) {
      if (!await stillActive() || signal.aborted) return;
      if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('ลิงก์รูปอ้างอิงไม่ถูกต้อง');
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('ดาวน์โหลดรูปอ้างอิงไม่สำเร็จ');
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > config.maxReferenceBytes) throw new Error('รูปอ้างอิงใหญ่เกินกำหนด');
      photos.push(encode(bytes));
      new Uint8Array(bytes).fill(0);
    }
    prepared.push({ id: member.id, name: member.name, photos });
  }
  if (!await stillActive() || signal.aborted) return;
  await configureMonitoringIdentity({ userId, familyId, revision, members: prepared });
}
