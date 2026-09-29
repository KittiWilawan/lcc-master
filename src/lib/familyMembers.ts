import { supabase } from './supabase';

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string | null;
  display_name: string;
  role: string | null;
  avatar_url: string | null;
  is_tracked: boolean;
  identity_consent_at: string | null;
  identity_reference_count: number;
}

export async function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase.from('family_members')
    .select('id,family_id,user_id,display_name,role,avatar_url,is_tracked,identity_consent_at,identity_references(id)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((member) => ({
    ...member,
    is_tracked: member.is_tracked === true,
    identity_reference_count: member.identity_references?.length ?? 0,
  })) as FamilyMember[];
}

export async function addCareRecipient(familyId: string, name: string, relationship: string) {
  const { data, error } = await supabase.from('family_members').insert({
    family_id: familyId,
    user_id: null,
    display_name: name,
    role: relationship || 'ผู้รับการดูแล',
    is_tracked: true,
    device_registered: false,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function updateCareRecipient(memberId: string, name: string, relationship: string) {
  const { error } = await supabase.from('family_members').update({
    display_name: name,
    role: relationship || 'ผู้รับการดูแล',
  }).eq('id', memberId).is('user_id', null);
  if (error) throw error;
}

export async function setCareRecipientTracking(memberId: string, enabled: boolean) {
  const { error } = await supabase.from('family_members')
    .update({ is_tracked: enabled }).eq('id', memberId).is('user_id', null);
  if (error) throw error;
}

export async function removeCareRecipient(memberId: string) {
  const { error } = await supabase.from('family_members')
    .delete().eq('id', memberId).is('user_id', null);
  if (error) throw error;
}

export async function uploadCareRecipientAvatar(memberId: string, imageUri: string) {
  const image = await fetch(imageUri);
  if (!image.ok) throw new Error('อ่านรูปภาพไม่ได้');
  const blob = await image.blob();
  if (!blob.type.startsWith('image/')) throw new Error('ไฟล์ที่เลือกไม่ใช่รูปภาพ');
  const path = `care-recipients/${memberId}-${Date.now()}`;
  const { error: uploadError } = await supabase.storage.from('avatars')
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const { error: updateError } = await supabase.from('family_members')
    .update({ avatar_url: data.publicUrl }).eq('id', memberId).is('user_id', null);
  if (updateError) throw updateError;
}
