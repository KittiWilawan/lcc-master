import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEY_FALL_EVIDENCE } from './fallEvidence';
import { supabase } from './supabase';
import { stopBackgroundMonitoring } from './backgroundMonitoring';
import { prepareNativeEventRevocation } from './nativeEventDelivery';
import { STORAGE_KEY_EXPO_PUSH_TOKEN, STORAGE_KEY_PUSH_REGISTRATION } from './pushNotifications';

const DEPRECATED_INTEGRATION_STORAGE_KEYS = [
  '@line_messaging_channel_token',
  '@line_messaging_target_id',
] as const;

function getSessionTimeoutMs(): number {
  const configured = Number(process.env.EXPO_PUBLIC_AUTH_SESSION_TIMEOUT_MS);
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new Error('EXPO_PUBLIC_AUTH_SESSION_TIMEOUT_MS must be a positive integer');
  }
  return configured;
}

export async function getCurrentSession() {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Auth session request timed out')),
      getSessionTimeoutMs(),
    );
  });

  try {
    const { data, error } = await Promise.race([supabase.auth.getSession(), timeout]);
    if (error) throw error;
    return data.session;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

const SIGNED_IN_USER_STORAGE_KEYS = [
  'familyId',
  'familyCode',
  '@family_cameras',
  '@fall_history',
  STORAGE_KEY_FALL_EVIDENCE,
  '@app_lock_enabled',
  '@app_lock_pin',
  STORAGE_KEY_EXPO_PUSH_TOKEN,
  STORAGE_KEY_PUSH_REGISTRATION,
] as const;

export async function clearSignedInUserStorage(): Promise<void> {
  await AsyncStorage.multiRemove([
    ...SIGNED_IN_USER_STORAGE_KEYS,
    ...DEPRECATED_INTEGRATION_STORAGE_KEYS,
  ]);
}

export async function clearDeprecatedIntegrationStorage(): Promise<void> {
  await AsyncStorage.multiRemove([...DEPRECATED_INTEGRATION_STORAGE_KEYS]);
}

export async function signOutCurrentDevice(): Promise<void> {
  const revoke = await prepareNativeEventRevocation().catch(() => undefined);
  await stopBackgroundMonitoring().catch(() => false);
  // Clear the local device permission immediately; revoke it on the server before ending the session.
  if (revoke) await revoke().catch(() => undefined);
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id) {
    await supabase.from('profiles').update({ expo_push_token: null }).eq('id', data.session.user.id);
  }
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;

  await clearSignedInUserStorage();

  const session = await getCurrentSession();
  if (session) throw new Error('ยังล้างข้อมูลการเข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
}
