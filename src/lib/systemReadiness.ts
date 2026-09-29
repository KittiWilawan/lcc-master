import AsyncStorage from '@react-native-async-storage/async-storage';
import { listFamilyMembers } from './familyMembers';
import { IDENTITY_POSES } from './identityReferences';
import { STORAGE_KEY_EXPO_PUSH_TOKEN } from './pushNotifications';
import { supabase } from './supabase';
import { isBackgroundMonitoringRunning } from './backgroundMonitoring';
import { getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from './monitoringPolicy';
import { describeMonitorHealth, loadMonitorHealth } from './monitorHealth';

export type ReadinessStepId =
  | 'account'
  | 'family'
  | 'recipient'
  | 'identity'
  | 'camera'
  | 'background'
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
  const identityReady = trackedRecipients.length === 0 || trackedRecipients.every((member) =>
    Boolean(member.identity_consent_at) && member.identity_reference_count >= IDENTITY_POSES.length
  );

  const { data: cameras, error: cameraError } = familyId
    ? await supabase
      .from('cameras')
      .select('id,assigned_member_id,url,snapshot_url,type')
      .eq('family_id', familyId)
    : { data: [], error: null };
  if (cameraError) throw cameraError;

  const trackedIds = getTrackedMemberIds(trackedRecipients);
  const allPeopleMode = usesAllPeopleMode(trackedIds);
  const assignedCameras = (cameras ?? []).filter((camera) =>
    camera.type !== 'device' && Boolean(camera.snapshot_url || camera.url) &&
    shouldMonitorCamera(camera, trackedIds)
  );
  const cameraReady = assignedCameras.length > 0;

  const homeWorkerMode = process.env.EXPO_PUBLIC_AI_MODE === 'home_worker';
  let backgroundReady = false;
  let backgroundDescription = 'เปิดหน้าหลักหนึ่งครั้ง เพื่อเริ่มการเฝ้าระวังเบื้องหลัง';
  if (cameraReady && homeWorkerMode && familyId) {
    const staleAfterMs = Number(process.env.EXPO_PUBLIC_MONITOR_STATUS_STALE_MS);
    if (Number.isSafeInteger(staleAfterMs) && staleAfterMs > 0) {
      const monitor = describeMonitorHealth(await loadMonitorHealth(familyId), Date.now(), staleAfterMs);
      backgroundReady = monitor.online;
      backgroundDescription = monitor.online ? monitor.subtitle : `${monitor.title} · ${monitor.subtitle}`;
    } else {
      backgroundDescription = 'ยังไม่ได้ตั้งค่าเวลาตรวจสถานะคอม';
    }
  } else if (cameraReady) {
    backgroundReady = await isBackgroundMonitoringRunning().catch(() => false);
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
      description: identityReady
        ? allPeopleMode ? 'โหมดตรวจทุกคนไม่ต้องสแกนบุคคล' : 'สแกนบุคคลครบสำหรับทุกคนที่เลือกเฝ้าดู'
        : 'สแกนหน้าตรง ซ้าย ขวา และเต็มตัวให้ครบ',
      ready: identityReady,
      actionLabel: 'เริ่มสแกนบุคคล',
      route: '/members',
    },
    {
      id: 'camera',
      title: 'กล้องที่ใช้ดูแล',
      description: cameraReady
        ? `AI อ่านภาพจากกล้อง ${assignedCameras.length} ตัว · ${allPeopleMode ? 'ตรวจทุกคน' : 'ตรวจบุคคลเป้าหมาย'}`
        : 'เพิ่มกล้องภายนอกและทดสอบลิงก์กล้อง',
      ready: cameraReady,
      actionLabel: 'เพิ่มกล้อง',
      route: '/home',
    },
    {
      id: 'background',
      title: homeWorkerMode ? 'คอม AI กำลังทำงาน' : 'เฝ้าระวังเมื่อปิดหน้าจอ',
      description: backgroundReady
        ? homeWorkerMode ? backgroundDescription : `กำลังเฝ้าระวังกล้อง ${assignedCameras.length} ตัว ปิดหน้าจอได้`
        : backgroundDescription,
      ready: backgroundReady,
      actionLabel: 'เปิดการเฝ้าระวัง',
      route: '/home',
    },
    {
      id: 'notification',
      title: 'การแจ้งเตือนฉุกเฉิน',
      description: pushToken ? 'มือถือพร้อมรับการแจ้งเตือน' : 'เปิดการแจ้งเตือนในโปรไฟล์ของผู้ดูแล',
      ready: Boolean(pushToken),
      actionLabel: 'เปิดการแจ้งเตือน',
      route: '/profile',
    },
  ]);
}
