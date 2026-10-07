import AsyncStorage from '@react-native-async-storage/async-storage';
import { listFamilyMembers } from './familyMembers';
import { IDENTITY_POSES } from './identityReferences';
import { STORAGE_KEY_EXPO_PUSH_TOKEN } from './pushNotifications';
import { supabase } from './supabase';
import { isBackgroundMonitoringRunning } from './backgroundMonitoring';
import { getAnalysisIntervalMs, getCaptureQuality } from './cameraAnalysis';
import { getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from './monitoringPolicy';
import { describeMonitorHealth, loadMonitorHealth } from './monitorHealth';
import { getCameraMonitorStates, getNativeCameraCapabilities, hasNativeCameraMonitoring, isCameraMonitorReady, isCameraMonitorSlow, refreshCameraMonitorStates } from './cameraMonitoring';

export type ReadinessStepId =
  | 'account'
  | 'family'
  | 'recipient'
  | 'identity'
  | 'camera'
  | 'notification';

export interface ReadinessStep {
  id: ReadinessStepId;
  title: string;
  description: string;
  ready: boolean;
  actionLabel: string;
  route?: '/login' | '/family-setup' | '/members' | '/profile' | '/home';
}

export interface SystemReadiness {
  checkedAt: string;
  completedCount: number;
  totalCount: number;
  progress: number;
  ready: boolean;
  steps: ReadinessStep[];
}

function createReadiness(steps: ReadinessStep[]): SystemReadiness {
  const completedCount = steps.filter((step) => step.ready).length;
  return {
    checkedAt: new Date().toISOString(),
    completedCount,
    totalCount: steps.length,
    progress: Math.round((completedCount / steps.length) * 100),
    ready: completedCount === steps.length,
    steps,
  };
}

export async function checkSystemReadiness(): Promise<SystemReadiness> {
  const [{ data: auth }, familyId, pushToken] = await Promise.all([
    supabase.auth.getUser(),
    AsyncStorage.getItem('familyId'),
    AsyncStorage.getItem(STORAGE_KEY_EXPO_PUSH_TOKEN),
  ]);

  const hasAccount = Boolean(auth.user);
  const hasFamily = Boolean(familyId);
  const members = familyId ? await listFamilyMembers(familyId) : [];
  const recipients = members.filter((member) => member.user_id === null);
  const trackedRecipients = recipients.filter((member) => member.is_tracked);
  const nativeIdentityUnsupported = hasNativeCameraMonitoring() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker' && trackedRecipients.length > 0;
  const identityReady = !nativeIdentityUnsupported && (trackedRecipients.length === 0 || trackedRecipients.every((member) =>
    Boolean(member.identity_consent_at) && member.identity_reference_count >= IDENTITY_POSES.length
  ));

  const { data: cameras, error: cameraError } = familyId
    ? await supabase
      .from('cameras')
      .select('id,assigned_member_id,url,snapshot_url,type')
      .eq('family_id', familyId)
    : { data: [], error: null };
  if (cameraError) throw cameraError;

  const trackedIds = getTrackedMemberIds(trackedRecipients);
  const allPeopleMode = usesAllPeopleMode(trackedIds);
  const homeWorkerMode = process.env.EXPO_PUBLIC_AI_MODE === 'home_worker';
  const nativeMode = hasNativeCameraMonitoring() && !homeWorkerMode;
  const capabilities = nativeMode ? await getNativeCameraCapabilities().catch(() => undefined) : undefined;
  const notificationReady = nativeMode ? capabilities?.localNotificationsEnabled === true : Boolean(pushToken);
  const notificationDescription = nativeMode
    ? !capabilities?.localNotificationsEnabled ? 'เปิดสิทธิ์แจ้งเตือนบนเครื่องตรวจในตั้งค่ามือถือ'
      : !capabilities.remotePushConfigured ? 'เปิดเตือนบนเครื่องตรวจแล้ว · ยังไม่ได้ตั้งค่ารับแจ้งเตือนจากเครื่องอื่น'
        : !capabilities.remoteDeliveryConfigured ? 'เตือนบนเครื่องตรวจได้ · ยังลงทะเบียนส่งเหตุเบื้องหลังไม่สำเร็จ'
          : 'ตั้งค่าส่งเหตุเบื้องหลังแล้ว · ต้องทดสอบการรับแจ้งเตือนบนมือถือผู้ดูแล'
    : pushToken ? 'มือถือมีโทเคนรับแจ้งเตือน · ยังต้องทดสอบการส่งจริง' : 'เปิดการแจ้งเตือนในโปรไฟล์ของผู้ดูแล';
  const assignedCameras = (cameras ?? []).filter((camera) =>
    camera.type !== 'device' &&
    Boolean(camera.snapshot_url || camera.url) &&
    shouldMonitorCamera(camera, trackedIds)
  );
  const cameraReady = assignedCameras.length > 0;

  const confidenceThreshold = Number(process.env.EXPO_PUBLIC_AI_FALL_CONFIDENCE);
  const confirmationsRequired = Number(process.env.EXPO_PUBLIC_AI_CONFIRMATIONS);
  const appAiConfigured = Boolean(
    process.env.EXPO_PUBLIC_AI_FUNCTION_NAME && getAnalysisIntervalMs() && getCaptureQuality() &&
    confidenceThreshold > 0 && confidenceThreshold <= 1 &&
    Number.isInteger(confirmationsRequired) && confirmationsRequired > 0
  );
  let monitoringReady = false;
  let monitoringDescription = 'AI ยังไม่เริ่มตรวจภาพ';
  if (cameraReady && homeWorkerMode && familyId) {
    const staleAfterMs = Number(process.env.EXPO_PUBLIC_MONITOR_STATUS_STALE_MS);
    if (Number.isSafeInteger(staleAfterMs) && staleAfterMs > 0) {
      const monitor = describeMonitorHealth(await loadMonitorHealth(familyId), Date.now(), staleAfterMs);
      monitoringReady = monitor.online;
      monitoringDescription = monitor.online ? monitor.subtitle : `${monitor.title} · ${monitor.subtitle}`;
    } else {
      monitoringDescription = 'ยังไม่ได้ตั้งค่าเวลาตรวจสถานะคอม';
    }
  } else if (cameraReady) {
    if (hasNativeCameraMonitoring()) {
      await refreshCameraMonitorStates().catch(() => undefined);
      const states = getCameraMonitorStates();
      monitoringReady = assignedCameras.every((camera) => isCameraMonitorReady(states[camera.id]));
      monitoringDescription = assignedCameras.some((camera) => isCameraMonitorSlow(states[camera.id]))
        ? 'AI ประมวลผลช้าและอาจพลาดเหตุล้ม · ลองลดจำนวนกล้องหรือใช้เครื่องที่เร็วขึ้น'
        : monitoringReady ? 'AI บนอุปกรณ์ได้รับภาพและวิเคราะห์แล้ว' : 'AI ยังไม่ได้รับภาพสดครบทุกกล้อง';
    } else {
      monitoringReady = appAiConfigured && await isBackgroundMonitoringRunning().catch(() => false);
    }
  }

  return createReadiness([
    {
      id: 'account',
      title: 'บัญชีผู้ดูแล',
      description: hasAccount ? 'เข้าสู่ระบบเรียบร้อย' : 'เข้าสู่ระบบเพื่อเก็บการตั้งค่าอย่างปลอดภัย',
      ready: hasAccount,
      actionLabel: 'เข้าสู่ระบบ',
      route: '/login',
    },
    {
      id: 'family',
      title: 'ครอบครัว',
      description: hasFamily ? 'เชื่อมต่อกลุ่มครอบครัวแล้ว' : 'สร้างครอบครัวหรือกรอกรหัสเชิญ',
      ready: hasFamily,
      actionLabel: 'ตั้งค่าครอบครัว',
      route: '/family-setup',
    },
    {
      id: 'recipient',
      title: 'คนที่ต้องการดูแล',
      description: trackedRecipients.length > 0
        ? `เลือกเฝ้าดูแล้ว ${trackedRecipients.length} คน`
        : 'ยังไม่เลือกบุคคลเป้าหมาย · AI จะตรวจทุกคนในภาพ',
      ready: true,
      actionLabel: 'เพิ่มคนที่ดูแล',
      route: '/members',
    },
    {
      id: 'identity',
      title: 'สอนระบบให้จำบุคคล',
      description: nativeIdentityUnsupported ? 'AI บนอุปกรณ์ตรวจคนในกล้องที่เลือก แต่ยังไม่ยืนยันชื่อจากรูปอ้างอิง' : identityReady
        ? allPeopleMode ? 'โหมดตรวจทุกคนไม่ต้องสแกนบุคคล' : 'สแกนบุคคลครบสำหรับทุกคนที่เลือกเฝ้าดู'
        : 'สแกนหน้าตรง ซ้าย ขวา และเต็มตัวให้ครบ',
      ready: identityReady,
      actionLabel: 'เริ่มสแกนบุคคล',
      route: '/members',
    },
    {
      id: 'camera',
      title: 'กล้องที่ใช้ดูแล',
      description: !cameraReady
        ? 'เพิ่มลิงก์กล้องและทดสอบการรับภาพ'
        : !monitoringReady
          ? homeWorkerMode || hasNativeCameraMonitoring() ? monitoringDescription : appAiConfigured
            ? 'เชื่อมกล้องแล้ว แต่ AI ยังไม่เริ่มตรวจภาพ'
            : 'ยังไม่ได้ตั้งค่าบริการ AI สำหรับตรวจภาพ'
          : `AI อ่านภาพจากกล้อง ${assignedCameras.length} ตัว · ${allPeopleMode ? 'ตรวจทุกคน' : 'เฝ้าดูพื้นที่ที่เลือก · ยังไม่ยืนยันตัวบุคคล'}`,
      ready: cameraReady && monitoringReady,
      actionLabel: cameraReady ? 'ตรวจสถานะ AI' : 'เพิ่มกล้อง',
      route: '/home',
    },
    {
      id: 'notification',
      title: 'การแจ้งเตือนฉุกเฉิน',
      description: notificationDescription,
      ready: notificationReady,
      actionLabel: 'เปิดการแจ้งเตือน',
      route: '/profile',
    },
  ]);
}
