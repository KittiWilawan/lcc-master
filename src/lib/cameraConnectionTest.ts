export interface CameraConnectionResult {
  success: boolean;
  message: string;
}

function getTimeoutMs(): number {
  const timeoutMs = Number(process.env.EXPO_PUBLIC_CAMERA_TEST_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('ยังไม่ได้ตั้งค่าเวลาทดสอบกล้อง');
  }
  return timeoutMs;
}

export async function testSnapshotConnection(snapshotUrl: string): Promise<CameraConnectionResult> {
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
    return { success: true, message: 'รับภาพจากกล้องสำเร็จ พร้อมใช้ตรวจจับ' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'กล้องใช้เวลาตอบกลับนานเกินไป กรุณาตรวจเครือข่าย' };
    }
    return { success: false, message: 'เชื่อมต่อกล้องไม่ได้ กรุณาตรวจลิงก์และเครือข่าย' };
  } finally {
    clearTimeout(timer);
  }
}

export async function testCameraConnection(
  cameraUrl: string,
  optionalSnapshotUrl = '',
): Promise<CameraConnectionResult> {
  if (optionalSnapshotUrl.trim()) return testSnapshotConnection(optionalSnapshotUrl);
  const source = cameraUrl.trim();
  if (!source) return { success: false, message: 'กรุณากรอกลิงก์กล้อง' };
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return { success: false, message: 'รูปแบบลิงก์กล้องไม่ถูกต้อง' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { success: false, message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' };
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
    const supported = hlsPath || contentType.includes('mpegurl') || contentType.startsWith('video/') ||
      contentType.startsWith('multipart/') || contentType.startsWith('image/') ||
      contentType.startsWith('application/octet-stream');
    await response.body?.cancel();
    return supported
      ? { success: true, message: 'เชื่อมกล้องสำเร็จ คอมสามารถดึงภาพให้ AI ได้' }
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
