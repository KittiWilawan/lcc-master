import { hasNativeCameraMonitoring, testNativeCameraSource } from './cameraMonitoring';

import { isLoopback } from './cameraLinkGuidance';

export interface CameraConnectionResult {
  success: boolean;
  message: string;
}

export function getCameraAddressIssue(source: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(source.trim());
  } catch {
    return null;
  }

  if (!isLoopback(parsed.hostname.toLowerCase())) return null;
  return 'ลิงก์ localhost เปิดได้เฉพาะอุปกรณ์เครื่องนั้น บนมือถือให้เปลี่ยน localhost เป็น IP ของคอม เช่น 192.168.1.25 และเชื่อม Wi-Fi วงเดียวกัน';
}

function getTimeoutMs(): number {
  const timeoutMs = Number(process.env.EXPO_PUBLIC_CAMERA_TEST_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('ยังไม่ได้ตั้งค่าเวลาทดสอบกล้อง');
  }
  return timeoutMs;
}

export async function testSnapshotConnection(
  snapshotUrl: string,
  allowComputerOnlyAddress = false,
): Promise<CameraConnectionResult> {
  const source = snapshotUrl.trim();
  if (!source) return { success: false, message: 'กรุณากรอกลิงก์ภาพนิ่งจากกล้อง' };

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return { success: false, message: 'รูปแบบลิงก์ไม่ถูกต้อง' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { success: false, message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' };
  }
  if (!allowComputerOnlyAddress) {
    const addressIssue = getCameraAddressIssue(source);
    if (addressIssue) return { success: false, message: addressIssue };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(source, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
    });
    if (!response.ok) {
      return { success: false, message: `กล้องตอบกลับไม่สำเร็จ (${response.status})` };
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) {
      return { success: false, message: 'ลิงก์นี้ไม่ได้ส่งภาพ JPEG หรือ PNG' };
    }
    const image = await response.blob();
    if (image.size === 0) return { success: false, message: 'กล้องตอบกลับมาแต่ไม่มีข้อมูลภาพ' };
    return { success: true, message: 'เครื่องนี้เปิดภาพนิ่งได้แล้ว ดูสถานะ AI เพื่อยืนยันว่าเริ่มวิเคราะห์ภาพ' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'กล้องใช้เวลาตอบกลับนานเกินไป กรุณาตรวจเครือข่าย' };
    }
    return { success: false, message: 'เชื่อมต่อกล้องไม่ได้ กรุณาตรวจลิงก์และเครือข่าย' };
  } finally {
    clearTimeout(timer);
  }
}

// HLS playlists start with the EXTM3U line, including when served as plain text.
async function hasPlaylistHeader(response: Response): Promise<boolean> {
  const tag = '#EXTM3U';
  const matches = (prefix: string) => prefix === tag || prefix.startsWith(tag + '\r') || prefix.startsWith(tag + '\n');
  const reader = response.body?.getReader?.();
  if (!reader) return matches((await response.text()).slice(0, tag.length + 1));
  let prefix = '';
  try {
    while (prefix.length <= tag.length) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value.subarray(0, tag.length + 1 - prefix.length)) prefix += String.fromCharCode(byte);
      if (!tag.startsWith(prefix) && !prefix.startsWith(tag)) break;
    }
    return matches(prefix);
  } finally {
    await reader.cancel();
  }
}

export async function testCameraConnection(
  cameraUrl: string,
  optionalSnapshotUrl = '',
  allowComputerOnlyAddress = false,
): Promise<CameraConnectionResult> {
  if (optionalSnapshotUrl.trim() && !hasNativeCameraMonitoring()) {
    return testSnapshotConnection(optionalSnapshotUrl, allowComputerOnlyAddress);
  }
  const source = cameraUrl.trim();
  if (!source) return { success: false, message: 'กรุณากรอกลิงก์กล้อง' };
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return { success: false, message: 'วางลิงก์ภาพสดเต็มบรรทัด โดยให้มี http:// หรือ https:// ด้านหน้า' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { success: false, message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' };
  }
  if (!allowComputerOnlyAddress) {
    const addressIssue = getCameraAddressIssue(source);
    if (addressIssue) return { success: false, message: addressIssue };
  }

  if (hasNativeCameraMonitoring() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker') {
    return testNativeCameraSource(source);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,video/*,multipart/*,image/*' },
    });
    if (!response.ok) return { success: false, message: `กล้องตอบกลับไม่สำเร็จ (${response.status})` };
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const hlsPath = parsed.pathname.toLowerCase().endsWith('.m3u8');
    if (contentType.includes('html')) {
      await response.body?.cancel();
      return { success: false, message: 'กล้องส่งหน้าเว็บกลับมา ให้คัดลอกลิงก์ภาพสดจากการตั้งค่ากล้องแทนลิงก์หน้าเว็บ' };
    }
    const playlist = hlsPath || contentType.includes('mpegurl');
    const supported = playlist ? await hasPlaylistHeader(response)
      : contentType.startsWith('video/') || contentType.startsWith('multipart/x-mixed-replace') ||
        contentType.startsWith('image/') || (contentType.startsWith('application/octet-stream') && parsed.pathname.toLowerCase().endsWith('.mp4'));
    if (!playlist) await response.body?.cancel();
    if (supported && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker') {
      return { success: false, message: 'เปิดลิงก์ได้ แต่ต้องทดสอบการถอดภาพใน APK Android รุ่นล่าสุดก่อนใช้ตรวจล้ม' };
    }
    return supported
      ? { success: true, message: 'เครื่องนี้เข้าถึงลิงก์แล้ว ดูสถานะ AI เพื่อยืนยันว่าคอมได้รับภาพและเริ่มวิเคราะห์' }
      : { success: false, message: 'ลิงก์ตอบกลับมา แต่ไม่พบภาพหรือวิดีโอที่รองรับ' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'กล้องใช้เวลาตอบกลับนานเกินไป กรุณาตรวจเครือข่าย' };
    }
    return { success: false, message: 'เชื่อมต่อกล้องไม่ได้ กรุณาตรวจลิงก์และเครือข่าย' };
  } finally {
    clearTimeout(timer);
  }
}
