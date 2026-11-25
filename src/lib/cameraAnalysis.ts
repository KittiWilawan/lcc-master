import { supabase } from './supabase';
import { getTrackedMemberIds } from './monitoringPolicy';

export interface CameraAnalysis {
  status: 'normal' | 'possible_fall' | 'fall' | 'uncertain';
  confidence: number;
  reason: string;
  peopleCount: number;
  monitoredPeopleCount?: number;
  monitoringMode?: 'all_people' | 'selected_people';
  subjectContinuity: 'single_continuous_person' | 'multiple_people' | 'uncertain';
  fallingPersonMatch?: 'confirmed_target' | 'possible_target' | 'not_target' | 'uncertain';
  identityConfidence?: number;
  identityReady?: boolean;
  identityState?: 'uncertain' | 'face_confirmed' | 'recent_face';
  fallingMemberId?: string | null;
  fallingMemberName?: string | null;
  faceSimilarity?: number | null;
  detections?: PersonDetection[];
  previewDetections?: PersonDetection[];
  recoveryRegions?: DetectionRegion[];
}

export type DetectionRegion = Pick<PersonDetection, 'x' | 'y' | 'width' | 'height'>;

export interface PersonDetection {
  collapseConfirmed?: boolean;
  trackId?: number;
  memberId?: string | null;
  memberName?: string | null;
  identityState?: 'uncertain' | 'face_confirmed' | 'recent_face';
  monitoringScope?: 'included' | 'known_other';
  faceSimilarity?: number | null;
  label: 'person';
  state: 'normal' | 'possible_fall' | 'fall' | 'uncertain';
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isDetectionRegion(value: unknown): value is DetectionRegion {
  if (typeof value !== 'object' || value === null) return false;
  const box = value as Partial<DetectionRegion>;
  return isNormalizedNumber(box.x) && isNormalizedNumber(box.y) &&
    isNormalizedNumber(box.width) && isNormalizedNumber(box.height) &&
    box.width > 0 && box.height > 0 && box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001;
}

function isPersonDetection(value: unknown): value is PersonDetection {
  if (typeof value !== 'object' || value === null) return false;
  const detection = value as Record<string, unknown>;
  return detection.label === 'person' &&
    (detection.state === 'normal' || detection.state === 'possible_fall' ||
      detection.state === 'fall' || detection.state === 'uncertain') &&
    isNormalizedNumber(detection.confidence) && isNormalizedNumber(detection.x) &&
    isNormalizedNumber(detection.y) && isNormalizedNumber(detection.width) &&
    isNormalizedNumber(detection.height) &&
    Number(detection.width) > 0 && Number(detection.height) > 0 &&
    Number(detection.x) + Number(detection.width) <= 1 &&
    Number(detection.y) + Number(detection.height) <= 1;
}

export function describeCameraAttribution(assignedName: string | undefined, analysis: CameraAnalysis): string {
  if (analysis.fallingMemberName && (analysis.identityState === 'face_confirmed' || analysis.identityState === 'recent_face')) {
    return `อาจเป็น ${analysis.fallingMemberName}${analysis.identityState === 'recent_face' ? ' · จากใบหน้าที่เห็นล่าสุด' : ' · เปรียบเทียบใบหน้าแล้ว'}`;
  }
  const identityThreshold = Number(process.env.EXPO_PUBLIC_AI_IDENTITY_CONFIDENCE);
  if (assignedName && analysis.fallingPersonMatch === 'confirmed_target' &&
      typeof analysis.identityConfidence === 'number' &&
      Number.isFinite(identityThreshold) && analysis.identityConfidence >= identityThreshold) {
    return `AI เปรียบเทียบแล้วว่าอาจเป็น ${assignedName}`;
  }
  return assignedName ? `ยังไม่ยืนยันตัวบุคคล · กำลังเฝ้าดู ${assignedName}` : 'ตรวจพบบุคคลในพื้นที่ · โหมดตรวจทุกคน';
}

function isCameraAnalysis(value: unknown): value is CameraAnalysis {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    (result.status === 'normal' || result.status === 'possible_fall' ||
      result.status === 'fall' || result.status === 'uncertain') &&
    typeof result.confidence === 'number' &&
    Number.isFinite(result.confidence) &&
    result.confidence >= 0 && result.confidence <= 1 &&
    typeof result.reason === 'string' &&
    Number.isSafeInteger(result.peopleCount) && Number(result.peopleCount) >= 0 && Number(result.peopleCount) <= 20 &&
    (result.recoveryRegions === undefined || (Array.isArray(result.recoveryRegions) && result.recoveryRegions.every(isDetectionRegion))) &&
    (result.subjectContinuity === 'single_continuous_person' ||
      result.subjectContinuity === 'multiple_people' || result.subjectContinuity === 'uncertain') &&
    (result.peopleCount === 1 || result.subjectContinuity !== 'single_continuous_person') &&
    (result.fallingPersonMatch === undefined || result.fallingPersonMatch === 'confirmed_target' ||
      result.fallingPersonMatch === 'possible_target' || result.fallingPersonMatch === 'not_target' ||
      result.fallingPersonMatch === 'uncertain') &&
    (result.identityConfidence === undefined ||
      (typeof result.identityConfidence === 'number' && Number.isFinite(result.identityConfidence) &&
        result.identityConfidence >= 0 && result.identityConfidence <= 1)) &&
    (result.detections === undefined ||
      (Array.isArray(result.detections) && result.detections.length <= 20 && result.detections.every(isPersonDetection)))
  );
}

export function getAnalysisIntervalMs(): number | null {
  const value = Number(process.env.EXPO_PUBLIC_AI_INTERVAL_MS);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function getCaptureQuality(): number | null {
  const value = Number(process.env.EXPO_PUBLIC_AI_CAPTURE_QUALITY);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
}

export async function analyzeCameraImages(
  cameraId: string,
  currentImage: string,
  previousImage?: string
): Promise<CameraAnalysis> {
  const functionName = process.env.EXPO_PUBLIC_AI_FUNCTION_NAME;
  if (!functionName) throw new Error('ยังไม่ได้ตั้งค่าบริการวิเคราะห์ภาพ');

  // The legacy still-image provider has no verified face-identity result. Never treat it as all-people
  // monitoring when a family has selected targets; Android HLS and video tests use native identity.
  const { data: camera, error: cameraError } = await supabase.from('cameras').select('family_id').eq('id', cameraId).maybeSingle();
  if (cameraError || !camera?.family_id) throw new Error('อ่านขอบเขตกล้องไม่ได้ กรุณาลองอีกครั้ง');
  const { data: members, error: memberError } = await supabase.from('family_members').select('id,is_tracked')
    .eq('family_id', camera.family_id).is('user_id', null);
  if (memberError || !Array.isArray(members)) throw new Error('อ่านรายชื่อเฝ้าระวังไม่ได้ กรุณาลองอีกครั้ง');
  if (getTrackedMemberIds(members).size) throw new Error('โหมดเฉพาะคนต้องใช้ AI บนอุปกรณ์ผ่านกล้อง HLS หรือหน้าทดสอบวิดีโอใน APK รุ่นใหม่');

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { cameraId, currentImage, previousImage },
  });
  if (error) throw error;
  if (!isCameraAnalysis(data)) throw new Error('บริการวิเคราะห์ภาพส่งข้อมูลไม่ถูกต้อง');
  return data;
}
