import { useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import config from '../../android/app/src/main/assets/monitoring/cloud.json';

export function EventDeliveryStatus({ eventId }: { eventId: string }) {
  const { colors } = useTheme();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const check = async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(config.functionName, { body: { action: 'delivery-status', eventId } });
      if (error || !data) throw new Error('Unavailable');
      if (Array.isArray(data.receipts) && data.receipts.length) {
        const lines = data.receipts.map((row: { name: string; acknowledgedAt: string }) =>
          `${row.name} · แอปตอบรับเมื่อ ${new Date(row.acknowledgedAt).toLocaleString('th-TH')}`);
        if (data.failedCount > 0) lines.push(`ส่งไม่สำเร็จอีก ${data.failedCount} เครื่อง`);
        setMessage(lines.join('\n'));
        return;
      }
      setMessage(data.receivedCount > 0 ? `แอปผู้ดูแลตอบรับแล้ว ${data.receivedCount} บัญชี · ยังไม่ยืนยันว่าได้อ่าน${data.failedCount > 0 ? ` · ส่งไม่สำเร็จอีก ${data.failedCount} เครื่อง` : ''}`
        : data.failedCount > 0 ? 'ส่งแจ้งเตือนบางเครื่องไม่สำเร็จ · กรุณาตรวจสิทธิ์และการตั้งค่ามือถือ'
        : data.state === 'provider_confirmed' ? 'บริการมือถือรับข้อความแล้ว · ยังไม่มีการตอบรับจากแอปผู้ดูแล'
        : data.state === 'receipt_pending' ? 'ระบบรับคำขอแล้ว · กำลังตรวจผลการส่งไปมือถือ'
        : data.state === 'no_recipients' ? 'ยังไม่มีมือถือผู้ดูแลที่เปิดรับแจ้งเตือน'
        : 'ยังไม่มีหลักฐานว่าส่งถึงมือถือผู้ดูแล · โปรดตรวจสอบเหตุโดยตรง');
    } catch { setMessage('ตรวจสถานะส่งไม่ได้ · ยังไม่ยืนยันการรับบนมือถือผู้ดูแล'); }
    finally { busy.current = false; setLoading(false); }
  };
  return <View style={{ gap: 6, marginVertical: 8 }}>
    {message ? <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22 }}>{message}</Text> : null}
    <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void check()}
      style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.inputBg }}>
      {loading ? <ActivityIndicator color={colors.accentText} /> : <Text style={{ color: colors.accentText, fontSize: 15, fontWeight: '700' }}>ตรวจสถานะส่งแจ้งเตือน</Text>}
    </TouchableOpacity>
  </View>;
}
