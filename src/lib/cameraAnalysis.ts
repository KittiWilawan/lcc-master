import { supabase } from './supabase';

export interface CameraAnalysis {
  status: 'normal' | 'possible_fall' | 'fall' | 'uncertain';
  confidence: number;
  reason: string;
  peopleCount: number;
  subjectContinuity: 'single_continuous_person' | 'multiple_people' | 'uncertain';
  fallingPersonMatch?: 'confirmed_target' | 'possible_target' | 'not_target' | 'uncertain';
  identityConfidence?: number;
  detections?: PersonDetection[];
}

export interface PersonDetection {
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

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { cameraId, currentImage, previousImage },
  });
  if (error) throw error;
  if (!isCameraAnalysis(data)) throw new Error('บริการวิเคราะห์ภาพส่งข้อมูลไม่ถูกต้อง');
  return data;
}
