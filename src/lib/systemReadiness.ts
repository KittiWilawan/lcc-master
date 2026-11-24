import AsyncStorage from '@react-native-async-storage/async-storage';
import { listFamilyMembers } from './familyMembers';
import { STORAGE_KEY_EXPO_PUSH_TOKEN } from './pushNotifications';
import { lastPhoneTest } from './selfTestReceipts';
import { supabase } from './supabase';
import { isBackgroundMonitoringRunning } from './backgroundMonitoring';
import { getAnalysisIntervalMs, getCaptureQuality } from './cameraAnalysis';
import { getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from './monitoringPolicy';
import { describeMonitorHealth, loadMonitorHealth } from './monitorHealth';
import { getCameraMonitorStates, getIdentityGalleryStatus, getNativeCameraCapabilities, hasNativeCameraMonitoring, isCameraMonitorReady, isCameraMonitorSlow, refreshCameraMonitorStates, supportsMonitoringIdentity } from './cameraMonitoring';
import { describeLiveMonitoring, type MonitoringSummary } from './monitoringStatus';

export type ReadinessStepId =
  | 'account'
  | 'family'
  | 'recipient'
  | 'identity'
  | 'camera'
  | 'analysis'
  | 'notification'
  | 'phoneReceipt';

export interface ReadinessStep {
  id: ReadinessStepId;
  title: string;
  description: string;
  ready: boolean;
  actionLabel: string;
  route?: '/login' | '/family-setup' | '/members' | '/profile' | '/home' | '/identity-enrollment';
  params?: { memberId: string; memberName: string };
}

export interface SystemReadiness {
  checkedAt: string;
  completedCount: number;
  totalCount: number;
  progress: number;
  ready: boolean;
  steps: ReadinessStep[];
  monitoring?: MonitoringSummary;
  selectedPeople?: number;
  monitoringContext?: {
    cameras: { id: string; type: 'video' | 'device' | 'rtsp'; assigned_member_id?: string | null }[];
    targetIds: string[];
    singleTarget?: { id: string; name: string };
    nativeMode: boolean;
    workerOnline: boolean;
  };
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
  const nativeIdentityMode = hasNativeCameraMonitoring() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker';
  const nativeIdentityUnsupported = nativeIdentityMode && !supportsMonitoringIdentity() && trackedRecipients.length > 0;
  const gallery = nativeIdentityMode ? await getIdentityGalleryStatus() : undefined;
  const galleryReady = Boolean(gallery?.familyId === familyId && gallery?.userId === auth.user?.id &&
    (gallery?.expiresAt ?? 0) > Date.now() && trackedRecipients.every((member) => gallery?.memberIds?.includes(member.id)));
  const identityReady = trackedRecipients.length === 0 || (!nativeIdentityUnsupported && nativeIdentityMode && galleryReady);
  const identityTarget = trackedRecipients.find(member => !galleryReady || !gallery?.memberIds?.includes(member.id)) ?? trackedRecipients[0];

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
  const receipt = auth.user ? await lastPhoneTest(auth.user.id).catch(() => null) : null;
  const phoneCanReceive = Boolean(pushToken) && (!nativeMode ||
    (capabilities?.localNotificationsEnabled === true && capabilities.remotePushConfigured === true));
  const receiptReady = Boolean(phoneCanReceive && receipt?.observedAt && receipt.correlated && !receipt.failed);
  const receiptDescription = receiptReady && receipt?.observedAt
    ? 'มือถือเครื่องนี้เคยรับข้อความทดสอบของบัญชีนี้เมื่อ ' + new Date(receipt.observedAt).toLocaleString('th-TH')
    : !phoneCanReceive ? 'เปิดสิทธิ์และลงทะเบียนรับแจ้งเตือนบนมือถือผู้ดูแล แล้วทดสอบรับจากระบบส่วนกลาง'
      : receipt?.sentAt && !receipt.failed ? 'ส่งคำขอแล้ว ยังยืนยันการรับบนมือถือเครื่องนี้ไม่ได้'
        : 'กดทดสอบรับจากระบบส่วนกลางบนมือถือผู้ดูแล เพื่อยืนยันว่าข้อความมาถึง';
  const notificationReady = nativeMode ? capabilities?.localNotificationsEnabled === true : receiptReady;
  const notificationDescription = nativeMode
    ? !capabilities?.localNotificationsEnabled ? 'เปิดสิทธิ์แจ้งเตือนบนเครื่องตรวจในตั้งค่ามือถือ'
      : !capabilities.remotePushConfigured ? 'เปิดเตือนบนเครื่องตรวจแล้ว · ยังไม่ได้ตั้งค่ารับแจ้งเตือนจากเครื่องอื่น'
        : !capabilities.remoteDeliveryConfigured ? 'เตือนบนเครื่องตรวจได้ · ยังลงทะเบียนส่งเหตุเบื้องหลังไม่สำเร็จ'
          : 'ตั้งค่าส่งเหตุเบื้องหลังแล้ว · ต้องทดสอบการรับแจ้งเตือนบนมือถือผู้ดูแล'
    : receiptDescription;
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
      if (!monitoringReady && capabilities?.recovery?.recoveryState === 'needs_app_open') monitoringDescription = 'การเฝ้าระวังหยุดลง · เปิดหน้าหลักและตรวจสถานะภาพเพื่อเริ่มอีกครั้ง';
    } else {
      monitoringReady = appAiConfigured && await isBackgroundMonitoringRunning().catch(() => false);
    }
  }

  const result = createReadiness([
    {
      id: 'account',
      title: 'บัญชีผู้ดูแล',
      description: hasAccount ? 'เข้าสู่ระบบเรียบร้อย' : 'เข้าสู่ระบบเพื่อเก็บการตั้งค่าอย่างปลอดภัย',
      ready: hasAccount,
      actionLabel: 'เข้าสู่ระบบ',
      route: hasAccount ? '/profile' : '/login',
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
      title: 'เลือกว่าจะเฝ้าดูใคร',
      description: trackedRecipients.length > 0
        ? `ตรวจเฉพาะคนที่เลือก ${trackedRecipients.length} คน · ต้องยืนยันใบหน้าก่อนแจ้งเหตุ`
        : 'ตรวจทุกคนในภาพ · ไม่ต้องเพิ่มชื่อหรือสแกนหน้า',
      ready: true,
      actionLabel: 'เลือกหรือเปลี่ยนคนที่เฝ้าดู',
      route: '/members',
    },
    {
      id: 'identity',
      title: 'เตรียมรูปใบหน้าคนที่เลือก',
      description: !allPeopleMode && !nativeIdentityMode ? 'โหมดนี้ยังยืนยันบุคคลในกล้องไม่ได้ · ใช้แอปรุ่นที่รองรับก่อนตรวจเฉพาะคน'
        : nativeIdentityUnsupported ? 'แอปรุ่นนี้ยังยืนยันบุคคลไม่ได้ กรุณาอัปเดตก่อนใช้โหมดเฉพาะคน' : identityReady
        ? allPeopleMode ? 'โหมดตรวจทุกคนไม่ต้องสแกนใบหน้า' : 'เตรียมรูปแล้ว · ยังต้องเห็นหน้าในกล้องเพื่อยืนยันว่าเป็นใคร'
        : 'สแกนหน้าที่ชัดเจนและให้ระบบเตรียมใบหน้า · โหมดเฉพาะคนจะไม่แจ้งเหตุจากคนที่ยืนยันไม่ได้',
      ready: identityReady,
      actionLabel: 'เริ่มสแกนบุคคล',
      route: identityTarget ? '/identity-enrollment' : '/members',
      params: identityTarget ? { memberId: identityTarget.id, memberName: identityTarget.display_name } : undefined,
    },
    {
      id: 'camera',
      title: 'เชื่อมกล้องที่ใช้ดูแล',
      description: cameraReady ? `บันทึกกล้องไว้ ${assignedCameras.length} ตัว · ดูสถานะรับภาพจริงแยกด้านล่าง` : 'เพิ่มลิงก์กล้องและทดสอบการรับภาพก่อนบันทึก',
      ready: cameraReady,
      actionLabel: cameraReady ? 'จัดการกล้อง' : 'เพิ่มกล้อง',
      route: '/home',
    },
    {
      id: 'analysis',
      title: 'ตรวจว่า AI ได้รับภาพจริง',
      description: !cameraReady ? 'เชื่อมกล้องก่อน แล้วกลับมาตรวจผลวิเคราะห์' : !monitoringReady
          ? homeWorkerMode || hasNativeCameraMonitoring() ? monitoringDescription : appAiConfigured
            ? 'เชื่อมกล้องแล้ว แต่ AI ยังไม่เริ่มตรวจภาพ'
            : 'ยังไม่ได้ตั้งค่าบริการ AI สำหรับตรวจภาพ'
          : `AI อ่านภาพจากกล้อง ${assignedCameras.length} ตัว · ${allPeopleMode ? 'ตรวจทุกคน' : 'แจ้งเหตุเฉพาะคนที่เลือกและยืนยันใบหน้าได้'}`,
      ready: cameraReady && monitoringReady,
      actionLabel: 'ดูสถานะภาพและ AI',
      route: '/home',
    },
    {
      id: 'notification',
      title: nativeMode ? 'แจ้งเตือนบนเครื่องตรวจ' : 'การแจ้งเตือนฉุกเฉิน',
      description: notificationDescription,
      ready: notificationReady,
      actionLabel: 'เปิดการแจ้งเตือน',
      route: '/profile',
    },
    ...(nativeMode ? [{
      id: 'phoneReceipt' as const,
      title: 'รับแจ้งเตือนจากระบบบนมือถือเครื่องนี้',
      description: receiptDescription,
      ready: receiptReady,
      actionLabel: 'ทดสอบรับจากระบบส่วนกลาง',
      route: '/profile' as const,
    }] : []),
  ]);
  const singleTarget = trackedRecipients.length === 1 ? { id: trackedRecipients[0].id, name: trackedRecipients[0].display_name } : undefined;
  return { ...result, selectedPeople: trackedRecipients.length, monitoringContext: { cameras: assignedCameras, singleTarget,
    targetIds: [...trackedIds], nativeMode, workerOnline: homeWorkerMode && monitoringReady }, monitoring: describeLiveMonitoring({ cameras: assignedCameras,
    states: getCameraMonitorStates(), targetIds: trackedIds, singleTarget, nativeMode, workerOnline: homeWorkerMode && monitoringReady, now: Date.now() }) };
}
