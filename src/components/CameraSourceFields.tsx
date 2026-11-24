import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import readability from '../config/readability.json';
import { CareText as Text } from './CareText';
import { cameraLinkGuidance } from '../lib/cameraLinkGuidance';

type CameraType = 'rtsp' | 'video' | 'device';
interface Props {
  type: CameraType;
  onTypeChange: (type: CameraType) => void;
  url: string;
  onUrlChange: (value: string) => void;
  snapshotUrl: string;
  onSnapshotChange: (value: string) => void;
  homeWorkerMode: boolean;
  test: { state: 'idle' | 'testing' | 'success' | 'error'; message: string; source?: string };
  onTest: () => void;
  saving: boolean;
}

/** Presents camera connection options; validation and persistence stay with the caller. */
export function CameraSourceFields(props: Props) {
  const { colors, seniorMode } = useTheme();
  const [showHelp, setShowHelp] = useState(false);
  const [showOtherSources, setShowOtherSources] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const minimumHeight = seniorMode ? readability.seniorTouchTargetSize : readability.touchTargetSize;
  const busy = props.test.state === 'testing' || props.saving;
  const linkHint = props.type === 'rtsp' && props.test.state !== 'success'
    ? cameraLinkGuidance(props.url, Platform.OS !== 'web', props.homeWorkerMode) : null;
  const inputStyle = [styles.input, { backgroundColor: colors.inputBg, color: colors.textPrimary,
    borderColor: colors.cardBorder, minHeight: minimumHeight,
    fontSize: seniorMode ? readability.seniorMinimumFontSize : readability.bodyFontSize }];
  const option = (type: CameraType, label: string, icon: keyof typeof MaterialCommunityIcons.glyphMap) => (
    <TouchableOpacity key={type} onPress={() => props.onTypeChange(type)} disabled={busy}
      accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: props.type === type, disabled: busy }}
      style={[styles.option, { minHeight: minimumHeight, backgroundColor: props.type === type ? colors.accentBg : colors.inputBg,
        borderColor: props.type === type ? colors.accentText : colors.cardBorder }]}>
      <MaterialCommunityIcons name={icon} size={24} color={props.type === type ? colors.accentText : colors.textSecondary} />
      <Text style={[styles.flexLabel, { color: props.type === type ? colors.accentText : colors.textPrimary }]}>{label}</Text>
      <MaterialCommunityIcons name={props.type === type ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={colors.accentText} />
    </TouchableOpacity>
  );
  return <View style={styles.form} testID="camera-source-fields">
    <Text style={[styles.label, { color: colors.textPrimary }]}>รับภาพจากไหน</Text>
    {option('rtsp', 'กล้อง CCTV / เว็บแคม', 'cctv')}
    {props.type === 'rtsp' && <TouchableOpacity onPress={() => setShowOtherSources(value => !value)} accessibilityRole="button"
      accessibilityState={{ expanded: showOtherSources }}
      style={[styles.disclosure, { minHeight: minimumHeight }]}>
      <Text style={[styles.flexLabel, { color: colors.accentText }]}>ใช้กล้องมือถือหรือวิดีโอแทน</Text>
      <MaterialCommunityIcons name={showOtherSources || props.type !== 'rtsp' ? 'chevron-up' : 'chevron-down'} size={24} color={colors.accentText} />
    </TouchableOpacity>}
    {(showOtherSources || props.type !== 'rtsp') && <View style={styles.options}>
      {option('device', 'กล้องมือถือเครื่องนี้', 'cellphone')}
      {option('video', 'วิดีโอผ่านลิงก์ MP4', 'video-outline')}
    </View>}

    {props.type === 'device' ? <Text style={{ color: colors.textSecondary }}>แอปจะขออนุญาตใช้กล้องเมื่อบันทึก ตรวจภาพสดและสถานะการเฝ้าดูหลังเพิ่มกล้อง</Text> : <>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{props.type === 'rtsp' ? 'วางลิงก์ภาพสดจากกล้อง' : 'วางลิงก์วิดีโอ MP4'}</Text>
      <TextInput style={inputStyle} value={props.url} onChangeText={props.onUrlChange} editable={!busy}
        placeholder={props.type === 'rtsp' ? 'ลิงก์ HLS (.m3u8)' : 'ลิงก์ไฟล์ MP4'} placeholderTextColor={colors.textMuted}
        accessibilityLabel={props.type === 'rtsp' ? 'ลิงก์ภาพสดจากกล้อง HLS' : 'ลิงก์วิดีโอ MP4'}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      {linkHint && <Text accessibilityLiveRegion="polite" style={{ color: colors.warningText }}>{linkHint}</Text>}
      <Text style={{ color: colors.textSecondary }}>{props.homeWorkerMode
        ? 'คอมที่เชื่อมไว้จะรับภาพมาวิเคราะห์ ตรวจการเชื่อมต่อก่อนบันทึก'
        : 'ใช้ลิงก์เดียวได้ใน APK Android ไม่ต้องกรอกลิงก์ภาพนิ่งเพิ่ม'}</Text>
      <TouchableOpacity onPress={() => setShowHelp(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showHelp }}
        testID="camera-link-help-toggle" style={[styles.disclosure, { minHeight: minimumHeight }]}>
        <Text style={[styles.flexLabel, { color: colors.accentText }]}>ลิงก์นี้หาจากไหน?</Text>
        <MaterialCommunityIcons name={showHelp ? 'chevron-up' : 'chevron-down'} size={24} color={colors.accentText} />
      </TouchableOpacity>
      {showHelp && <View style={[styles.help, { backgroundColor: colors.accentBg }]} testID="camera-link-help">
        <Text style={{ color: colors.textPrimary }}>{props.type === 'rtsp'
          ? 'เปิดการตั้งค่ากล้องหรือโปรแกรมที่ส่งภาพ แล้วคัดลอกลิงก์ HLS (.m3u8) มาวาง ช่องนี้ใช้ลิงก์สตรีมโดยตรง ไม่ใช่หน้าเว็บดูกล้อง'
          : 'ใช้ลิงก์ไฟล์ MP4 โดยตรง หากคลิปอยู่ในมือถือ ให้ใช้ “ทดสอบ AI ด้วยวิดีโอ” ในหน้าตั้งค่าระบบ'}</Text>
        {props.type === 'rtsp' && <Text style={{ color: colors.textSecondary }}>ถ้ากล้องมีเฉพาะ RTSP หรือ MJPEG ต้องให้โปรแกรมส่งภาพแปลงเป็น HLS ก่อน</Text>}
        {Platform.OS !== 'web' && <Text style={{ color: colors.textSecondary }}>ถ้าส่งภาพจากคอม ให้ใช้ IP ของคอมแทน localhost และเชื่อมมือถือกับกล้องใน Wi-Fi วงเดียวกัน</Text>}
      </View>}
      {props.homeWorkerMode && <>
        {props.type === 'rtsp' && <TouchableOpacity onPress={() => setShowSnapshot(value => !value)} accessibilityRole="button"
          accessibilityState={{ expanded: showSnapshot }} style={[styles.disclosure, { minHeight: minimumHeight }]}>
          <Text style={[styles.flexLabel, { color: colors.accentText }]}>เพิ่มลิงก์ภาพนิ่ง (ถ้ามี)</Text>
          <MaterialCommunityIcons name={showSnapshot ? 'chevron-up' : 'chevron-down'} size={24} color={colors.accentText} />
        </TouchableOpacity>}
        {(props.type === 'video' || showSnapshot || props.snapshotUrl.trim().length > 0) && <>
          <Text style={[styles.label, { color: colors.textPrimary }]}>ลิงก์ภาพนิ่ง JPEG/PNG {props.type === 'video' ? 'สำหรับ AI' : '(ไม่บังคับ)'}</Text>
          <TextInput style={inputStyle} value={props.snapshotUrl} onChangeText={props.onSnapshotChange} editable={!busy}
            placeholder="ลิงก์ภาพนิ่งจากกล้อง" placeholderTextColor={colors.textMuted} accessibilityLabel="ลิงก์ภาพนิ่งสำหรับ AI"
            autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        </>}
      </>}
      <TouchableOpacity onPress={props.onTest} disabled={busy || !props.url.trim()} accessibilityRole="button"
        accessibilityLabel={props.test.state === 'error' ? 'ลองทดสอบการเชื่อมต่ออีกครั้ง' : 'ทดสอบการเชื่อมต่อกล้อง'} accessibilityState={{ disabled: busy || !props.url.trim() }}
        style={[styles.option, { minHeight: minimumHeight, backgroundColor: colors.accentBg, borderColor: colors.cardBorder,
          opacity: busy || !props.url.trim() ? 0.6 : 1 }]}>
        {props.test.state === 'testing' ? <ActivityIndicator color={colors.accentText} /> : <MaterialCommunityIcons name="camera-outline" size={24} color={colors.accentText} />}
        <Text style={[styles.flexLabel, { color: colors.accentText }]}>{props.test.state === 'testing' ? 'กำลังทดสอบ…' : props.test.state === 'error' ? 'ลองอีกครั้ง' : 'ทดสอบการเชื่อมต่อ'}</Text>
      </TouchableOpacity>
      {props.test.message && <View style={[styles.help, { backgroundColor: colors.inputBg }]} accessibilityLiveRegion="polite" testID="camera-test-result">
        <Text style={{ color: props.test.state === 'error' ? colors.dangerText : colors.textPrimary }}>{props.test.message}</Text>
        {props.test.state === 'success' && <Text style={{ color: colors.textSecondary }}>เชื่อมต่อได้แล้ว หลังบันทึกให้ดูสถานะ “AI กำลังตรวจภาพ” อีกครั้ง</Text>}
      </View>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  form: { gap: 10, marginBottom: 16 }, label: { fontWeight: '700' }, flexLabel: { flex: 1, minWidth: 0, fontWeight: '700' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  options: { gap: 10 }, input: { borderWidth: 1, borderRadius: 12, padding: 12 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  help: { borderRadius: 12, padding: 14, gap: 8 },
});
