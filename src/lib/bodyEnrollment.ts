import { randomUUID } from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import config from '../config/identityReferences.json';
import type { BodyAngle } from './bodyPose';

export type EnrollmentPhotos = Record<BodyAngle | 'full_body', string>;
export interface Enrollment { family: string; member: string; batch: string; name: string; role: string; create: boolean }

export async function saveBodyEnrollment(draft: Enrollment, photos: EnrollmentPhotos) {
  const { family, member, batch } = draft;
  if (await AsyncStorage.getItem('familyId') !== family) throw new Error('ครอบครัวเปลี่ยน กรุณาเริ่มสแกนใหม่');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const bucket = supabase.storage.from(config.bucket);
  const prefix = `${family}/${member}/enrollment/${batch}/`;
  const query = () => supabase.from('identity_references').select('storage_path').eq('family_id', family).eq('member_id', member);
  const old = await query();
  if (old.error) throw old.error;
  const staged: string[] = [];
  let submitted = false;
  try {
    for (const [pose, photo] of Object.entries(photos)) {
      const path = prefix + pose + '.jpg';
      const result = await bucket.upload(path, decode(photo), { contentType: 'image/jpeg', upsert: false });
      if (result.error && result.error.statusCode !== '409' && result.error.message !== 'The resource already exists') throw result.error;
      staged.push(path);
    }
    if (await AsyncStorage.getItem('familyId') !== family || (await supabase.auth.getSession()).data.session?.user.id !== user.id)
      throw new Error('บัญชีหรือครอบครัวเปลี่ยน กรุณาเริ่มสแกนใหม่');
    submitted = true;
    const { error } = await supabase.rpc('save_body_enrollment', { p_family: family, p_member: member,
      p_batch: batch, p_name: draft.name, p_role: draft.role, p_create: draft.create, p_consent: true });
    if (error) {
      const result = await query();
      if (result.error || !staged.every(path => result.data.some(row => row.storage_path === path))) {
        if (!result.error && error.code && !result.data.some(row => staged.includes(row.storage_path))) await bucket.remove(staged);
        throw error;
      }
    }
  } catch (error) {
    // After a lost commit response a retry uses the same paths. Never delete possibly committed images.
    if (!submitted && staged.length) await bucket.remove(staged);
    throw error;
  }
  const replaced = old.data.map(row => row.storage_path).filter(path => !staged.includes(path));
  if (replaced.length) await bucket.remove(replaced).catch(() => undefined);
}
export function makeEnrollment(family: string, member: string | undefined, name: string, role: string): Enrollment {
  return { family, member: member || randomUUID(), batch: randomUUID(), name, role, create: !member };
}
