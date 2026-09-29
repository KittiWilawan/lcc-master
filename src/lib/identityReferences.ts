import { decode } from 'base64-arraybuffer';
import { v4 as createUuid } from 'uuid';
import { supabase } from './supabase';

const IDENTITY_BUCKET = 'identity-references';
const SIGNED_URL_TTL_SECONDS = 600;
const MAX_REFERENCE_BYTES = 2_000_000;

export const IDENTITY_POSES = [
  { key: 'front', label: 'หน้าตรง', description: 'เห็นใบหน้าชัด ไม่ย้อนแสง' },
  { key: 'left', label: 'หันซ้าย', description: 'เห็นใบหน้าด้านซ้าย' },
  { key: 'right', label: 'หันขวา', description: 'เห็นใบหน้าด้านขวา' },
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
