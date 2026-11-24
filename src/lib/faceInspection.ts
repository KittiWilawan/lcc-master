import { NativeModules, Platform } from 'react-native';

export interface DetectedFace { left: number; top: number; width: number; height: number; confidence: number }
export interface FacePhotoResult { faces: DetectedFace[]; minFaceWidthRatio: number; maxFaceWidthRatio: number; quality?: { brightness: number; sharpness: number; issue: string | null } }
interface FaceEnrollmentBridge {
  inspectPhoto(base64: string): Promise<FacePhotoResult>;
  matchesRetainedReferences?(candidate: string, retained: string[]): Promise<boolean>;
}
const bridge: FaceEnrollmentBridge | undefined = Platform.OS === 'android' ? NativeModules.FaceEnrollment : undefined;
export class FacePhotoError extends Error { constructor(message: string) { super(message); this.name = 'FacePhotoError'; } }
export function supportsFaceInspection(): boolean { return typeof bridge?.inspectPhoto === 'function'; }
export function supportsPoseRetake(): boolean { return typeof bridge?.matchesRetainedReferences === 'function'; }
export async function checkPoseReplacement(candidate: string, retained: string[]): Promise<void> {
  if (!await bridge?.matchesRetainedReferences?.(candidate, retained)) {
    throw new FacePhotoError('ยังเทียบกับรูปมุมเดิมไม่ได้ ให้คนเดิมถ่ายมุมนี้อีกครั้ง');
  }
}

export function facePhotoError(result: FacePhotoResult, fullBody: boolean): string | null {
  if (!Array.isArray(result.faces)) return 'ตรวจรูปไม่ได้ กรุณาลองใหม่';
  if (result.quality?.issue === 'dark') return 'ภาพมืดเกินไป กรุณาถ่ายในที่สว่าง';
  if (result.quality?.issue === 'bright') return 'ภาพสว่างเกินไป กรุณาหลีกเลี่ยงแสงจ้าตรงใบหน้า';
  if (result.quality?.issue === 'blur') return 'ภาพไม่ชัด กรุณาเช็ดเลนส์และถือกล้องให้นิ่ง';
  if (!result.faces.length) return fullBody ? null : 'ยังไม่พบใบหน้า กรุณาหันหน้าเข้าหากล้องและถ่ายในที่สว่าง';
  if (result.faces.length !== 1) return 'พบมากกว่าหนึ่งใบหน้า กรุณาถ่ายเฉพาะคนที่ต้องการเพิ่ม';
  const face = result.faces[0];
  if (![face.left, face.top, face.width, face.height, face.confidence].every(Number.isFinite) || face.width <= 0 || face.height <= 0) return 'ตรวจรูปไม่ได้ กรุณาลองใหม่';
  if (face.left < 0 || face.top < 0 || face.left + face.width > 1 || face.top + face.height > 1) return 'ใบหน้าติดขอบภาพ กรุณาจัดให้เห็นใบหน้าครบ';
  if (!fullBody && face.width < result.minFaceWidthRatio) return 'ใบหน้าเล็กเกินไป กรุณาขยับกล้องเข้าใกล้';
  if (!fullBody && face.width > result.maxFaceWidthRatio) return 'ใบหน้าใกล้เกินไป กรุณาขยับกล้องออกเล็กน้อย';
  return null;
}

export async function validateFacePhoto(base64: string, fullBody: boolean): Promise<{ verified: boolean }> {
  if (!bridge) return { verified: false };
  const result = await bridge.inspectPhoto(base64);
  const error = facePhotoError(result, fullBody);
  if (error) throw new FacePhotoError(error);
  return { verified: result.faces.length === 1 };
}
