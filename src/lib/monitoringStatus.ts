import type { CameraMonitorState } from './cameraMonitoring';
import { getCameraTargetMemberIds, type MonitoringCamera } from './monitoringPolicy';
import runtime from '../../android/app/src/main/assets/monitoring/runtime.json';
import identity from '../../android/app/src/main/assets/monitoring/identity.json';

export type StatusTone = 'ready' | 'waiting' | 'attention';
export interface MonitoringStatusRow { id: 'camera' | 'ai' | 'person'; title: string; detail: string; tone: StatusTone }
export interface MonitoringSummary { title: string; detail: string; tone: StatusTone; rows: MonitoringStatusRow[] }
interface StatusInput {
  cameras: (MonitoringCamera & { id: string })[];
  states: Readonly<Record<string, CameraMonitorState>>;
  targetIds: Set<string>;
  singleTarget?: { id: string; name: string };
  scopeUnavailable?: boolean;
  nativeMode: boolean;
  workerOnline?: boolean;
  loading?: boolean;
  now: number;
}

function fresh(timestamp: number | undefined, now: number, maximumAge: number): boolean {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 && now >= timestamp && now-timestamp <= maximumAge;
}

/** Connection, inference and identity are separate observations; configuration alone proves none of them. */
export function describeLiveMonitoring(input: StatusInput): MonitoringSummary {
  const { cameras, states, targetIds, nativeMode, now } = input;
  const selected = targetIds.size > 0;
  const mode = selected ? 'selected_people' : 'all_people';
  const receiving = cameras.filter(camera => {
    const state = states[camera.id];
    return nativeMode && (state?.state === 'ready' || state?.state === 'ai_error') && fresh(state.lastFrameAt, now, runtime.frameStaleMs);
  });
  const analyzing = receiving.filter(camera => {
    const state = states[camera.id];
    return state.state === 'ready' && fresh(state.lastAnalysisAt, now, runtime.frameStaleMs) &&
      typeof state.inferenceMs === 'number' && Number.isFinite(state.inferenceMs) && state.inferenceMs >= 0 &&
      state.inferenceMs <= runtime.maxRealtimeInferenceMs && !state.healthIssues?.includes('IMAGE_UNCHANGED') &&
      state.analysis?.monitoringMode === mode;
  });
  const verified = new Set<string>();
  for (const camera of analyzing) {
    const state = states[camera.id];
    if (!state.analysis?.identityReady || !fresh(state.lastAnalysisAt, now, identity.retentionMs)) continue;
    const allowed = new Set(getCameraTargetMemberIds(camera, targetIds));
    for (const person of state.analysis.detections ?? []) {
      if (person.memberId && allowed.has(person.memberId) &&
        (person.identityState === 'face_confirmed' || person.identityState === 'recent_face')) verified.add(person.memberId);
    }
  }
  const allAnalyzing = cameras.length > 0 && analyzing.length === cameras.length;
  const camera: MonitoringStatusRow = { id: 'camera', title: 'ภาพจากกล้อง',
    detail: input.loading ? 'กำลังตรวจภาพล่าสุด' : !cameras.length ? 'ยังไม่เพิ่มกล้อง' : !nativeMode
      ? `ตั้งกล้องไว้ ${cameras.length} ตัว · เปิดกล้องเพื่อตรวจภาพจริง` : `ได้รับภาพล่าสุด ${receiving.length} จาก ${cameras.length} กล้อง`,
    tone: input.loading ? 'waiting' : receiving.length === cameras.length && cameras.length > 0 ? 'ready' : 'attention' };
  const ai: MonitoringStatusRow = { id: 'ai', title: 'การตรวจภาพด้วย AI',
    detail: input.loading ? 'กำลังตรวจผลวิเคราะห์' : !nativeMode
      ? input.workerOnline ? 'คอมส่งสถานะมาแล้ว · ตรวจผลวิเคราะห์รายกล้องอีกครั้ง' : 'ยังไม่มีผลวิเคราะห์สดบนเครื่องนี้'
      : !cameras.length ? 'รอเชื่อมกล้องก่อนเริ่มวิเคราะห์' : allAnalyzing ? `กำลังวิเคราะห์ ${analyzing.length} กล้อง` : `มีผลวิเคราะห์สด ${analyzing.length} จาก ${cameras.length} กล้อง`,
    tone: !input.loading && allAnalyzing ? 'ready' : 'waiting' };
  const namedTarget = targetIds.size === 1 && input.singleTarget && targetIds.has(input.singleTarget.id)
    ? input.singleTarget.name.trim() : '';
  const person: MonitoringStatusRow = { id: 'person', title: 'คนที่เฝ้าดู',
    detail: input.loading ? 'กำลังตรวจโหมดเฝ้าดู' : input.scopeUnavailable ? 'ยังอ่านรายชื่อคนที่ตั้งให้เฝ้าดูไม่ได้' : !selected ? 'ตรวจการล้มของทุกคนในภาพ' : namedTarget
      ? `ตั้งให้เฝ้าดู${namedTarget}\n${verified.size ? 'ยืนยันใบหน้าล่าสุดได้แล้ว' : `ตอนนี้ยังยืนยัน${namedTarget}ไม่ได้`}` : verified.size === targetIds.size
      ? `ยืนยันตัวบุคคลล่าสุดได้ ${verified.size} คน` : `เลือกไว้ ${targetIds.size} คน · ยืนยันล่าสุดได้ ${verified.size} คน`,
    tone: input.loading ? 'waiting' : input.scopeUnavailable ? 'attention' : !selected ? 'ready' : verified.size === targetIds.size ? 'ready' : 'attention' };
  return { title: input.loading ? 'กำลังตรวจสถานะ' : input.scopeUnavailable ? 'ยังตรวจการตั้งค่าคนที่เฝ้าดูไม่ได้' : !cameras.length ? 'เริ่มจากเพิ่มกล้อง' : !allAnalyzing
    ? 'ตรวจภาพและการทำงานของ AI' : selected && verified.size < targetIds.size ? 'AI ตรวจภาพอยู่ · รอยืนยันบุคคล' : 'AI กำลังตรวจภาพ',
    detail: input.scopeUnavailable ? 'ตรวจการเชื่อมต่อแล้วกลับมาดูสถานะอีกครั้ง' : selected ? 'โหมดเฉพาะคนจะแจ้งเหตุเมื่อยืนยันได้ว่าเป็นคนที่เลือก หากยังยืนยันไม่ได้จะไม่เปลี่ยนไปตรวจทุกคน'
      : 'โหมดตรวจทุกคนจะแจ้งเมื่อ AI สงสัยการล้ม โดยไม่เดาชื่อบุคคล',
    tone: input.loading ? 'waiting' : !input.scopeUnavailable && allAnalyzing && (!selected || verified.size === targetIds.size) ? 'ready' : 'attention', rows: [camera, ai, person] };
}
