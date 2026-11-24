import type { CameraMonitorState } from './cameraMonitoring';

const messages: Record<string, string> = {
  CAMERA_UNAVAILABLE: 'รับภาพกล้องไม่ได้ · การตรวจอาจขาดช่วง',
  VIDEO_ENDED: 'วิดีโอสิ้นสุด · ไม่มีภาพใหม่ให้ตรวจ',
  IMAGE_UNCHANGED: 'ภาพไม่เปลี่ยน · โปรดตรวจว่ากล้องยังส่งภาพสด',
  AI_UNAVAILABLE: 'AI วิเคราะห์ภาพไม่ได้ · กรุณาตรวจสถานะระบบ',
  ANALYSIS_STALE: 'ภาพมาแต่ AI ไม่มีผลใหม่ · การตรวจอาจขาดช่วง',
  EVENT_SAVE_FAILED: 'บันทึกภาพเหตุไม่สำเร็จ · กรุณาตรวจพื้นที่เครื่อง',
};

export function describeMonitoringHealth(state: CameraMonitorState | undefined): string[] {
  return (state?.healthIssues ?? []).flatMap((issue) => {
    if (issue === 'QUEUE_NEAR_FULL') return [`มีเหตุรอส่งจำนวนมาก ${state?.pendingEventCount ?? 0} เหตุ · ตรวจอินเทอร์เน็ตและสถานะส่ง`];
    if (issue === 'QUEUE_DISCARDED') return [`มีเหตุในคิวเก่าถูกลบ ${state?.queueDiscardedEvents ?? 0} เหตุเพราะคิวเต็ม`];
    if (issue === 'EVIDENCE_UNAVAILABLE') return [`มี ${state?.eventsWithoutEvidence ?? 0} เหตุที่ไม่มีภาพ · ข้อมูลเหตุยังเก็บไว้ โปรดตรวจพื้นที่เครื่อง`];
    return messages[issue] ? [messages[issue]] : [];
  });
}
