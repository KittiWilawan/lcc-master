import forms from '../config/forms.json';
import { AppAlert } from './appAlert';
import { getFriendlyErrorMessage } from './friendlyError';
import { saveScheduledTest } from './localNotificationHistory';
import { scheduleLocalTestNotification } from './pushNotifications';
import { supabase } from './supabase';

export async function testDeviceNotification(): Promise<boolean> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) {
      AppAlert.error('ยังทดสอบไม่ได้', 'กรุณาเข้าสู่ระบบก่อนทดสอบการแจ้งเตือน');
      return false;
    }
    const id = await scheduleLocalTestNotification();
    if (!id) {
      AppAlert.error('ยังทดสอบไม่ได้', 'กรุณาอนุญาตการแจ้งเตือนในการตั้งค่ามือถือ แล้วลองอีกครั้ง');
      return false;
    }
    try {
      await saveScheduledTest(session.user.id, { id, createdAt: Date.now() });
    } catch {
      AppAlert.error('ตั้งเวลาแล้ว แต่บันทึกประวัติไม่ได้', 'ยังดูการแจ้งเตือนได้ในแถบแจ้งเตือนของมือถือ');
      return false;
    }
    AppAlert.success('ตั้งเวลาทดสอบแล้ว', `ดูแถบแจ้งเตือนในอีก ${forms.notificationTestDelaySeconds} วินาที บันทึกการทดสอบในหน้าการแจ้งเตือนของเครื่องนี้แล้ว`);
    return true;
  } catch (error) {
    AppAlert.error('ทดสอบไม่สำเร็จ', getFriendlyErrorMessage(error));
    return false;
  }
}
