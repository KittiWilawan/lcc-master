import { v4 as uuid } from 'uuid';
import { supabase } from './supabase';
import { configureEventDelivery, getDeliveryRegistration, hasNativeCameraMonitoring } from './cameraMonitoring';
import config from '../../android/app/src/main/assets/monitoring/cloud.json';

/** Enrols a device permission scoped to one user and family; no account credentials cross the bridge. */
export async function ensureNativeEventDelivery(userId: string, familyId: string, stillActive: () => Promise<boolean>) {
  const current = await getDeliveryRegistration();
  if (current.userId === userId && current.familyId === familyId && current.expiresAt &&
    Date.parse(current.expiresAt) - Date.now() > config.tokenRenewBeforeMs) return;
  const deviceId = current.userId === userId && current.deviceId ? current.deviceId : uuid();
  const { data, error } = await supabase.functions.invoke(config.functionName, { body: { action: 'register', deviceId, familyId } });
  if (error || !data?.token || !data?.expiresAt) throw new Error('ลงทะเบียนการส่งแจ้งเตือนเบื้องหลังไม่สำเร็จ');
  if (!await stillActive()) return;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error('ยังไม่ได้ตั้งค่าระบบส่วนกลาง');
  const endpoint = new URL(`/functions/v1/${config.functionName}`, base).toString();
  await configureEventDelivery({ deviceId, userId, familyId, expiresAt: data.expiresAt, token: data.token, endpoint });
}

export async function prepareNativeEventRevocation(): Promise<(() => Promise<void>) | undefined> {
  if (!hasNativeCameraMonitoring()) return;
  const registration = await getDeliveryRegistration();
  if (!registration.deviceId) return;
  return async () => {
    await supabase.functions.invoke(config.functionName, { body: { action: 'revoke-user', deviceId: registration.deviceId } });
  };
}
