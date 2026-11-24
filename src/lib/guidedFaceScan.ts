import { Platform, UIManager } from 'react-native';
import scanConfig from '../config/faceScan.json';
import { decode } from 'base64-arraybuffer';

export type FacePose = 'front' | 'left' | 'right';
export type FaceScanTarget = FacePose | 'all';
export interface ScanState { hint: string; pose: string; progress: number; reset: boolean; runId?: number }
export interface ScanCapture { pose: FacePose; base64: string; runId?: number }
export const FACE_SCAN_CONFIG = scanConfig;
export function supportsGuidedFaceScan(): boolean {
  return Platform.OS === 'android' && Boolean(UIManager.getViewManagerConfig('LookLanFaceScan'));
}
export function scanPoses(target: FaceScanTarget): FacePose[] {
  return scanConfig.poses.filter(item => target === 'all' || item.key === target).map(item => item.key as FacePose);
}
export function scanInstruction(state: ScanState): string {
  switch (state.hint) {
    case 'loading': return 'กำลังเปิดกล้อง…';
    case 'checking_face': return 'กำลังตรวจใบหน้า ถือกล้องให้นิ่ง';
    case 'checking_scene': return 'กำลังยืนยันกรอบใบหน้า ถือกล้องให้นิ่งสักครู่';
    case 'checking_live': return 'กำลังตรวจภาพจากกล้อง มองตรงในที่สว่าง';
    case 'suspected_spoof': return 'ยังตรวจภาพจากกล้องไม่ผ่าน ใช้ใบหน้าจริงและจัดแสงแล้วลองใหม่';
    case 'identity_changed': return 'ใบหน้าไม่ตรงกับตอนเริ่ม ให้คนเดิมเริ่มสแกนใหม่';
    case 'challenge_left': return 'ค่อย ๆ หันหน้าไปทางซ้าย แล้วทำตามคำแนะนำถัดไป';
    case 'challenge_right': return 'ค่อย ๆ หันหน้าไปทางขวา แล้วทำตามคำแนะนำถัดไป';
    case 'challenge_timeout': return 'ขั้นตอนใช้เวลานานเกินไป มองตรงเพื่อเริ่มใหม่';
    case 'permission': return 'กรุณาอนุญาตให้แอปใช้กล้อง';
    case 'no_face': return 'ให้ใบหน้าอยู่ในกรอบ';
    case 'multiple': return 'พบหลายใบหน้า ให้คนอื่นออกจากกรอบก่อน';
    case 'dark': return 'แสงน้อยเกินไป หันหน้าเข้าหาแสง';
    case 'bright': return 'แสงจ้าเกินไป ขยับออกจากแสงตรง';
    case 'blur': return 'ภาพยังไม่ชัด เช็ดเลนส์และถือกล้องให้นิ่ง';
    case 'eyes_blur': return 'ภาพบริเวณดวงตายังไม่คม ถือกล้องให้นิ่งและมองตรง';
    case 'lower_blur': return 'ภาพบริเวณจมูกและปากยังไม่คม ถือกล้องให้นิ่ง';
    case 'eyes_dark': return 'บริเวณดวงตาแสงยังไม่พอ หันหน้าเข้าหาแสง';
    case 'lower_dark': return 'บริเวณจมูกและปากแสงยังไม่พอ หันหน้าเข้าหาแสง';
    case 'features_missing': return 'ยังเห็นรายละเอียดใบหน้าไม่ครบ มองตรงและจัดใบหน้าในกรอบ';
    case 'camera_stalled': return 'ภาพจากกล้องค้าง ขยับกล้องหรือเริ่มสแกนใหม่';
    case 'occluded_eyes': return 'ดวงตายังไม่ชัด จัดแสงและถอดสิ่งบังใบหน้า';
    case 'occluded_lower': return 'จมูกและปากยังไม่ชัด จัดแสงและถอดสิ่งบังใบหน้า';
    case 'near': return 'ขยับกล้องออกเล็กน้อย';
    case 'far': return 'ขยับกล้องเข้าใกล้อีกนิด';
    case 'center': return 'ขยับใบหน้าเข้ากลางกรอบ';
    case 'cropped': return 'ให้เห็นใบหน้าครบทั้งหน้า';
    case 'level': return 'ถือกล้องระดับสายตา ไม่ก้มหรือเอียงหน้า';
    case 'look_front': case 'turn_front': return 'มองตรงเข้ากล้อง';
    case 'turn_left': return 'ค่อย ๆ หันหน้าไปทางซ้ายของคุณ';
    case 'turn_right': return 'ค่อย ๆ หันหน้าไปทางขวาของคุณ';
    case 'blink': return 'กระพริบตาหนึ่งครั้งตามปกติ';
    case 'open_eyes': return 'ลืมตาและมองเข้ากล้อง';
    case 'hold': return 'อยู่ท่านี้และถือกล้องให้นิ่ง';
    case 'reset': return 'ใบหน้าหลุดจากการสแกน เริ่มมองตรงอีกครั้ง';
    case 'paused': return 'พักสแกนแล้ว กลับมาเริ่มใหม่ได้';
    case 'complete': return 'เก็บภาพครบแล้ว กรุณาตรวจรูปก่อนบันทึก';
    default: return 'เปิดกล้องสแกนไม่ได้ กรุณาลองใหม่';
  }
}

/** A late or malformed native event must never become a stored reference. */
export function validScanCapture(value: ScanCapture, target: FaceScanTarget): boolean {
  if (!value || !scanPoses(target).includes(value.pose) || typeof value.base64 !== 'string' || !value.base64.length) return false;
  if (value.base64.length > Math.ceil(scanConfig.camera.maxPhotoBytes / 3) * 4) return false;
  for (const character of value.base64) {
    const code = character.charCodeAt(0);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || character === '+' || character === '/' || character === '=')) return false;
  }
  if (value.base64.length % 4 !== 0) return false;
  const firstPadding = value.base64.indexOf('=');
  if (firstPadding >= 0 && (firstPadding < value.base64.length - 2 || [...value.base64.slice(firstPadding)].some(character => character !== '='))) return false;
  try {
    const bytes = new Uint8Array(decode(value.base64));
    return bytes.length <= scanConfig.camera.maxPhotoBytes && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  } catch { return false; }
}
