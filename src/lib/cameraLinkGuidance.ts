export function isLoopback(host: string) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' ||
    host === '::1' || host === '0.0.0.0' || (host.startsWith('127.') && host.split('.').every(part => part !== '' && Number.isInteger(Number(part))));
}

export function cameraLinkGuidance(source: string, mobile: boolean, homeWorker: boolean): string | null {
  if (!source.trim()) return null;
  const needsAddress = 'วางลิงก์ภาพสดเต็มบรรทัด โดยให้มี http:// หรือ https:// ด้านหน้า';
  let url: URL;
  try { url = new URL(source.trim()); } catch { return needsAddress; }
  const hints: string[] = [];
  if (mobile && isLoopback(url.hostname.toLowerCase())) hints.push('ใช้ IP ของคอมแทน localhost แล้วเชื่อมมือถือกับคอมใน Wi-Fi วงเดียวกัน');
  const path = url.pathname.toLowerCase();
  if (url.protocol === 'rtsp:' || url.protocol === 'rtmp:') hints.push('เปิด HLS ในกล้องหรือโปรแกรมส่งภาพ แล้วคัดลอกลิงก์ภาพสด HTTP หรือ HTTPS มาวาง');
  else if (url.protocol !== 'http:' && url.protocol !== 'https:') hints.push(needsAddress);
  else if (!homeWorker && (path.endsWith('.mjpg') || path.endsWith('.mjpeg'))) hints.push('ลิงก์นี้มีนามสกุล MJPEG ถ้ากล้องส่งภาพแบบนี้ ให้โปรแกรมส่งภาพแปลงเป็น HLS แล้ววางลิงก์ใหม่');
  return hints.join('\n') || null;
}
