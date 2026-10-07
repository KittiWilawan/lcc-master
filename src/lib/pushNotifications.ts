import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { supabase } from './supabase';
import { getEmergencyPhoneNumber } from './phone';

export const STORAGE_KEY_EXPO_PUSH_TOKEN = '@expo_push_token';
export const STORAGE_KEY_PUSH_REGISTRATION = '@push_registration_status';

// Detect if running inside Expo Go store client
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any)?.appOwnership === 'expo';

/**
 * Safely load expo-notifications module dynamically.
 * Returns null in Expo Go on Android or Web to prevent native module crashes.
 */
function getNotificationsModule(): any | null {
  if (Platform.OS === 'web') return null;
  if (isExpoGo && Platform.OS === 'android') return null;

  try {
    // Loaded only on supported native runtimes; Expo Go on Android does not include this module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch (e) {
    console.log('[LookLanCare] expo-notifications module notice:', e);
    return null;
  }
}

/**
 * Configure OS High-Priority Emergency Notification Channel (Android & iOS)
 * and register/sync Expo Push Token to Supabase
 */
export async function registerForPushNotificationsAsync(): Promise<boolean> {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    if (isExpoGo && Platform.OS === 'android') {
      console.log('[LookLanCare] Remote push notifications are disabled in Expo Go on Android (SDK 53+). Use a development build for remote push testing.');
    }
    return false;
  }

  try {
    if (typeof Notifications.setNotificationHandler === 'function') {
      try {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
      } catch (err) {
        console.log('setNotificationHandler notice:', err);
      }
    }

    if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
      try {
        await Notifications.setNotificationChannelAsync('emergency-fall-channel', {
          name: 'การแจ้งเตือนเหตุล้มฉุกเฉิน (LookLanCare)',
          importance: Notifications.AndroidImportance?.MAX ?? 5,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#EF4444',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PRIVATE ?? 0,
        });
      } catch (err) {
        console.log('setNotificationChannelAsync notice:', err);
      }
    }

    if (typeof Notifications.getPermissionsAsync !== 'function') return false;

    let existingStatus = 'denied';
    try {
      const res = await Notifications.getPermissionsAsync();
      existingStatus = res.status;
    } catch {
      return false;
    }

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      } catch {
        return false;
      }
    }

    if (finalStatus !== 'granted') {
      await AsyncStorage.setItem(STORAGE_KEY_PUSH_REGISTRATION, 'permission_denied');
      return false;
    }

    // Get and save Expo Push Token
    await AsyncStorage.setItem(STORAGE_KEY_PUSH_REGISTRATION, 'local_only');
    try {
      if (typeof Notifications.getExpoPushTokenAsync === 'function') {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) throw new Error('ยังไม่ได้ตั้งค่า Expo project ID สำหรับ Push');
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        const token = tokenData?.data;
        if (token) {
          await syncPushTokenToSupabase(token);
          await AsyncStorage.setItem(STORAGE_KEY_EXPO_PUSH_TOKEN, token);
          await AsyncStorage.setItem(STORAGE_KEY_PUSH_REGISTRATION, 'remote_ready');
        }
      }
    } catch {
      await AsyncStorage.removeItem(STORAGE_KEY_EXPO_PUSH_TOKEN);
      console.warn('รับแจ้งเตือนจากเครื่องอื่นยังไม่พร้อม · การเตือนบนเครื่องนี้ยังใช้ได้');
    }

    return true;
  } catch (e) {
    console.log('Error registering OS push notifications:', e);
    return false;
  }
}

/**
 * Sync push token to Supabase profiles table
 */
export async function syncPushTokenToSupabase(token: string): Promise<void> {
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  if (!session?.user) throw new Error('กรุณาเข้าสู่ระบบก่อนลงทะเบียนรับแจ้งเตือน');
  const { data, error } = await supabase.from('profiles').update({ expo_push_token: token })
    .eq('id', session.user.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('ยังไม่มีโปรไฟล์สำหรับรับแจ้งเตือน');
}

/**
 * Dispatch Remote Expo Push Notification to all family members
 */
export async function sendRemotePushNotification(params: {
  title: string;
  body: string;
  data?: Record<string, any>;
}): Promise<{ success: boolean; count: number }> {
  try {
    const familyId = await AsyncStorage.getItem('familyId');
    let targetTokens: string[] = [];

    // Query Expo Push Tokens for family members from Supabase
    if (familyId) {
      const { data: members } = await supabase
        .from('family_members')
        .select('user_id')
        .eq('family_id', familyId);

      if (members && members.length > 0) {
        const userIds = members.map((m) => m.user_id).filter(Boolean);
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('expo_push_token')
            .in('id', userIds)
            .not('expo_push_token', 'is', null);

          if (profiles) {
            targetTokens = profiles.map((p) => p.expo_push_token).filter(Boolean);
          }
        }
      }
    }

    // Fallback: use local saved token if no remote tokens retrieved
    if (targetTokens.length === 0) {
      const localToken = await AsyncStorage.getItem(STORAGE_KEY_EXPO_PUSH_TOKEN);
      if (localToken) targetTokens.push(localToken);
    }

    if (targetTokens.length === 0) {
      return { success: false, count: 0 };
    }

    // Construct Expo Push Payloads
    const messages = targetTokens.map((token) => ({
      to: token,
      sound: 'default',
      title: params.title,
      body: params.body,
      data: params.data || { type: 'fall_alert', timestamp: new Date().toISOString() },
      priority: 'high',
      channelId: 'emergency-fall-channel',
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    await response.json();
    return { success: response.ok, count: targetTokens.length };
  } catch (e) {
    console.log('Error dispatching remote Expo push notification:', e);
    return { success: false, count: 0 };
  }
}

/**
 * Trigger high-priority local & remote OS Lock Screen notification for Fall Events
 */
export async function sendLocalFallNotification(params: {
  personName?: string;
  cameraName?: string;
  groundDuration?: number;
}): Promise<void> {
  const attribution = params.personName || 'ยังไม่ยืนยันตัวบุคคล';
  const location = params.cameraName || 'กล้องวงจรปิด';
  const duration = params.groundDuration !== undefined ? ` (ประเมินเวลา ${params.groundDuration} วินาที)` : '';

  const title = '🚨 [LLC Alert] AI สงสัยว่าอาจเกิดการล้ม';
  const body = `ภาพจาก ${location} · ${attribution} อาจมีเหตุล้ม${duration} กรุณาตรวจสอบทันที`;

  // Local notification
  const Notifications = getNotificationsModule();
  if (Notifications && typeof Notifications.scheduleNotificationAsync === 'function') {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
          data: { type: 'fall_alert', timestamp: new Date().toISOString() },
        },
        trigger: null,
      });
    } catch (e) {
      console.log('Error sending local fall notification:', e);
    }
  }

  // Remote Push notification broadcast to family members
  void sendRemotePushNotification({ title, body });
}

/**
 * Trigger high-priority local & remote OS Lock Screen notification for Emergency SOS
 */
export async function sendLocalSOSNotification(): Promise<void> {
  const title = '🚨 [LLC SOS] สัญญาณขอความช่วยเหลือฉุกเฉิน!';
  const body = `มีผู้กดปุ่ม SOS ขอความช่วยเหลือในแอป กรุณาติดต่อกลับทันที และโทร ${getEmergencyPhoneNumber()} หากเป็นเหตุฉุกเฉิน`;

  const Notifications = getNotificationsModule();
  if (Notifications && typeof Notifications.scheduleNotificationAsync === 'function') {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
          data: { type: 'sos_alert', timestamp: new Date().toISOString() },
        },
        trigger: null,
      });
    } catch (e) {
      console.log('Error sending local SOS notification:', e);
    }
  }

  // Remote Push notification broadcast to family members
  void sendRemotePushNotification({ title, body });
}

/**
 * Show a harmless notification on this device only.
 * This is intentionally separate from SOS so a setup check cannot alert family members.
 */
export async function sendLocalTestNotification(): Promise<boolean> {
  const Notifications = getNotificationsModule();
  if (!Notifications || typeof Notifications.scheduleNotificationAsync !== 'function') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '✅ ทดสอบการแจ้งเตือนสำเร็จ',
      body: 'การแจ้งเตือนบนมือถือเครื่องนี้ทำงานแล้ว',
      sound: true,
      priority: Notifications.AndroidNotificationPriority?.HIGH ?? 'high',
      data: { type: 'notification_test', timestamp: new Date().toISOString() },
    },
    trigger: null,
  });
  return true;
}
