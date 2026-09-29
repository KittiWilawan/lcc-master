import { supabase } from './supabase';

export interface MonitorHealth {
  state: 'idle' | 'running' | 'degraded' | 'stopped';
  camera_count: number;
  analyzed_count: number;
  error_count: number;
  detail: string | null;
  checked_at: string;
}

export async function loadMonitorHealth(familyId: string): Promise<MonitorHealth | null> {
  const { data, error } = await supabase.from('monitor_health')
    .select('state,camera_count,analyzed_count,error_count,detail,checked_at')
    .eq('family_id', familyId)
    .maybeSingle();
  if (error) throw error;
  return data as MonitorHealth | null;
}

export function describeMonitorHealth(health: MonitorHealth | null, now: number, staleAfterMs: number) {
  if (!health) return { title: 'คอมบ้านยังไม่เชื่อมต่อ', subtitle: 'ตั้งค่าและเปิดโปรแกรมเฝ้าระวังบนคอม', online: false };
  const checkedAt = Date.parse(health.checked_at);
  if (!Number.isFinite(checkedAt) || now - checkedAt > staleAfterMs || checkedAt > now + staleAfterMs) {
    return { title: 'คอมบ้านออฟไลน์', subtitle: 'ไม่ได้รับสถานะล่าสุดจากคอม กรุณาตรวจโปรแกรมและอินเทอร์เน็ต', online: false };
  }
  if (health.state === 'stopped') {
    return { title: 'คอมบ้านหยุดทำงาน', subtitle: health.detail || 'เปิดโปรแกรมเฝ้าระวังบนคอมอีกครั้ง', online: false };
  }
  if (health.state === 'degraded') {
    return { title: 'ระบบกล้องหรือ AI ขัดข้อง', subtitle: health.detail || 'ตรวจสถานะโปรแกรมบนคอม', online: false };
  }
  if (health.state === 'idle') {
    return { title: 'คอมบ้านออนไลน์ แต่ยังไม่ตรวจภาพ', subtitle: health.detail || 'เพิ่มกล้องและทดสอบลิงก์กล้อง', online: false };
  }
  if (health.analyzed_count === 0) {
    return { title: 'คอมบ้านกำลังเริ่มตรวจภาพ', subtitle: health.detail || 'รอภาพแรกจากกล้อง', online: false };
  }
  return {
    title: 'คอมบ้านกำลังตรวจภาพ',
    subtitle: `ตรวจสำเร็จ ${health.analyzed_count}/${health.camera_count} กล้องในรอบล่าสุด`,
    online: true,
  };
}
