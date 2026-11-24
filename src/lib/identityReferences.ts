import { decode } from 'base64-arraybuffer';
import { v4 as createUuid } from 'uuid';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import referenceConfig from '../config/identityReferences.json';
import scanConfig from '../config/faceScan.json';
import identityConfig from '../../android/app/src/main/assets/monitoring/identity.json';
import { commitReferenceSet } from './referenceSetTransaction';
import type { ScanPhotoSet, ScanSaveOptions } from './faceScanSave';
import type { FacePose } from './guidedFaceScan';

const IDENTITY_BUCKET = referenceConfig.bucket;
const SIGNED_URL_TTL_SECONDS = referenceConfig.signedUrlTtlSeconds;
const MAX_REFERENCE_BYTES = identityConfig.maxReferenceBytes;

export const IDENTITY_POSES = [
  { key: 'front', label: 'หน้าตรง', description: 'เห็นใบหน้าชัด ไม่ย้อนแสง' },
  { key: 'left', label: 'หันซ้าย', description: 'ค่อย ๆ หันไปทางซ้ายของคุณ' },
  { key: 'right', label: 'หันขวา', description: 'ค่อย ๆ หันไปทางขวาของคุณ' },
  { key: 'full_body', label: 'เต็มตัว', description: 'เห็นรูปร่างตั้งแต่ศีรษะถึงเท้า' },
] as const;

export type IdentityPose = typeof IDENTITY_POSES[number]['key'];

export interface IdentityReference {
  id: string;
  family_id: string;
  member_id: string;
  pose: IdentityPose;
  storage_path: string;
  signed_url: string | null;
  created_at: string;
}

interface SaveIdentityReferenceInput {
  familyId: string;
  memberId: string;
  pose: IdentityPose;
  base64: string;
}

export async function listIdentityReferences(memberId: string): Promise<IdentityReference[]> {
  const { data, error } = await supabase.from('identity_references')
    .select('id,family_id,member_id,pose,storage_path,created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return Promise.all((data ?? []).map(async (reference) => {
    const { data: signed, error: signedError } = await supabase.storage
      .from(IDENTITY_BUCKET)
      .createSignedUrl(reference.storage_path, SIGNED_URL_TTL_SECONDS);
    return {
      ...reference,
      pose: reference.pose as IdentityPose,
      signed_url: signedError ? null : signed.signedUrl,
    };
  }));
}

export async function confirmIdentityConsent(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('set_identity_consent', {
    p_member_id: memberId,
    p_consent: true,
  });
  if (error) throw error;
}

export async function saveIdentityReference(input: SaveIdentityReferenceInput): Promise<void> {
  const bytes = decode(input.base64);
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error('รูปที่ปรับขนาดแล้วยังใหญ่เกินกำหนด กรุณาเลือกรูปอื่น');
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('กรุณาเข้าสู่ระบบใหม่');

  const { data: oldReference, error: oldError } = await supabase.from('identity_references')
    .select('storage_path')
    .eq('member_id', input.memberId)
    .eq('pose', input.pose)
    .maybeSingle();
  if (oldError) throw oldError;

  const storagePath = `${input.familyId}/${input.memberId}/${createUuid()}.jpg`;
  const { error: uploadError } = await supabase.storage.from(IDENTITY_BUCKET)
    .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: false });
  if (uploadError) throw uploadError;

  const { error: referenceError } = await supabase.from('identity_references').upsert({
    family_id: input.familyId,
    member_id: input.memberId,
    pose: input.pose,
    storage_path: storagePath,
    created_by: auth.user.id,
  }, { onConflict: 'member_id,pose' });
  if (referenceError) {
    await supabase.storage.from(IDENTITY_BUCKET).remove([storagePath]);
    throw referenceError;
  }

  if (oldReference?.storage_path && oldReference.storage_path !== storagePath) {
    await supabase.storage.from(IDENTITY_BUCKET).remove([oldReference.storage_path]);
  }
}

/** Upload all three drafts first; one PostgreSQL upsert replaces the active rows together. */
export async function saveIdentityReferenceSet(input: {
  familyId: string; memberId: string; photos: Readonly<ScanPhotoSet>; options: ScanSaveOptions;
}): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const ownerId = auth.user.id;
  const poses = scanConfig.poses.map(value => value.key as FacePose);
  const planned = new Map(poses.map(pose => [pose, `${input.familyId}/${input.memberId}/${createUuid()}.jpg`]));
  const stillActive = async () => input.options.isActive() && await AsyncStorage.getItem('familyId') === input.familyId &&
    (await supabase.auth.getSession()).data.session?.user.id === ownerId;
  const checkMember = async () => {
    if (!await stillActive()) throw new Error('บัญชีหรือครอบครัวเปลี่ยน กรุณาเริ่มสแกนใหม่');
    const { data: member, error } = await supabase.from('family_members').select('identity_consent_at')
      .eq('id', input.memberId).eq('family_id', input.familyId).is('user_id', null).single();
    if (error || !member?.identity_consent_at) throw new Error('กรุณายืนยันความยินยอมของบุคคลนี้ก่อนบันทึก');
  };
  await checkMember();
  const { data: old, error: readError } = await supabase.from('identity_references').select('pose,storage_path')
    .eq('member_id', input.memberId).eq('family_id', input.familyId).in('pose', poses);
  if (readError) throw readError;
  const bucket = supabase.storage.from(IDENTITY_BUCKET);
  await commitReferenceSet({ poses, photos: input.photos, stillActive,
    stage: async (pose, base64) => {
      if (base64.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4) throw new Error('รูปสแกนใหญ่เกินกำหนด กรุณาสแกนใหม่');
      const bytes = decode(base64);
      const image = new Uint8Array(bytes);
      if (image.length < 4 || image.length > MAX_REFERENCE_BYTES || image[0] !== 0xff || image[1] !== 0xd8 ||
          image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) throw new Error('รูปสแกนไม่ถูกต้อง กรุณาสแกนใหม่');
      const path = planned.get(pose)!;
      try {
        const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        return path;
      } finally { image.fill(0); }
    },
    commit: async paths => {
      await checkMember();
      const createdAt = new Date().toISOString();
      const rows = poses.map(pose => ({ family_id: input.familyId, member_id: input.memberId,
        pose, storage_path: paths[pose]!, created_by: ownerId, created_at: createdAt }));
      const { error } = await supabase.from('identity_references').upsert(rows, { onConflict: 'member_id,pose' });
      if (error) {
        // A lost response may follow a successful server transaction. Reconcile the exact paths.
        if (!await stillActive()) throw error;
        const { data: confirmed, error: confirmError } = await supabase.from('identity_references').select('pose,storage_path')
          .eq('member_id', input.memberId).eq('family_id', input.familyId).in('pose', poses);
        if (confirmError || !rows.every(row => confirmed?.some(value => value.pose === row.pose && value.storage_path === row.storage_path))) {
          throw new Error('ยังยืนยันผลบันทึกทั้งชุดไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
        }
      }
    },
    discard: async () => { await bucket.remove([...planned.values()]); },
    onStaged: input.options.onProgress,
  });
  // Cleanup failures do not turn a committed set into an apparent failed save.
  const oldPaths = (old ?? []).map(value => value.storage_path).filter(path => ![...planned.values()].includes(path));
  try { if (oldPaths.length && await stillActive()) await bucket.remove(oldPaths); }
  catch { /* Active references are already committed; cleanup can be retried independently. */ }
}

export async function deleteIdentityReference(reference: IdentityReference): Promise<void> {
  const { error: deleteError } = await supabase.from('identity_references')
    .delete()
    .eq('id', reference.id);
  if (deleteError) throw deleteError;
  const { error: storageError } = await supabase.storage.from(IDENTITY_BUCKET)
    .remove([reference.storage_path]);
  if (storageError) throw storageError;
}

export async function withdrawIdentityConsent(memberId: string): Promise<void> {
  const { data, error } = await supabase.from('identity_references')
    .select('storage_path')
    .eq('member_id', memberId);
  if (error) throw error;

  const { error: deleteError } = await supabase.from('identity_references')
    .delete()
    .eq('member_id', memberId);
  if (deleteError) throw deleteError;

  const paths = (data ?? []).map((reference) => reference.storage_path);
  if (paths.length) await supabase.storage.from(IDENTITY_BUCKET).remove(paths);

  const { error: consentError } = await supabase.rpc('set_identity_consent', {
    p_member_id: memberId,
    p_consent: false,
  });
  if (consentError) throw consentError;
}
