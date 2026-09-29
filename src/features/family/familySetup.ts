import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface FamilyAccess {
  familyId: string;
  familyCode: string;
}

interface FamilyRpcResult {
  family_id: string;
  family_code: string;
}

export const FAMILY_NAME_LIMIT = 60;

export function prepareFamilyName(value: string): string {
  return value.trim();
}

export function prepareInvitationCode(value: string): string {
  return value.trim().toLowerCase();
}

export function validateFamilyName(value: string): string | null {
  const name = prepareFamilyName(value);
  if (!name) return 'กรุณาตั้งชื่อครอบครัว';
  if (name.length > FAMILY_NAME_LIMIT) return `ชื่อครอบครัวต้องไม่เกิน ${FAMILY_NAME_LIMIT} ตัวอักษร`;
  return null;
}

export function validateInvitationCode(value: string): string | null {
  if (!prepareInvitationCode(value)) return 'กรุณากรอกรหัสเชิญ';
  return null;
}

async function saveFamilyAccess(family: FamilyAccess): Promise<void> {
  await AsyncStorage.multiSet([
    ['familyId', family.familyId],
    ['familyCode', family.familyCode],
  ]);
}

function toFamilyAccess(result: FamilyRpcResult): FamilyAccess {
  return { familyId: result.family_id, familyCode: result.family_code };
}

export async function createFamily(client: SupabaseClient, familyName: string): Promise<FamilyAccess> {
  const { data, error } = await client
    .rpc('create_family', { p_name: prepareFamilyName(familyName) })
    .single();
  if (error) throw error;
  if (!data) throw new Error('สร้างครอบครัวไม่สำเร็จ');

  const family = toFamilyAccess(data as FamilyRpcResult);
  await saveFamilyAccess(family);
  return family;
}

export async function joinFamily(client: SupabaseClient, invitationCode: string): Promise<FamilyAccess | null> {
  const { data, error } = await client
    .rpc('join_family', { p_code: prepareInvitationCode(invitationCode) })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const family = toFamilyAccess(data as FamilyRpcResult);
  await saveFamilyAccess(family);
  return family;
}
