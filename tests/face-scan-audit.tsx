/** Standalone audit entry. Gradle permits this only with a separate application ID. */
import { registerRootComponent } from 'expo';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FaceCaptureModal } from '../src/components/FaceCaptureModal';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { IDENTITY_POSES, type IdentityPose } from '../src/lib/identityReferences';
import { supportsFaceInspection } from '../src/lib/faceInspection';
import { supportsGuidedFaceScan, type FaceScanTarget } from '../src/lib/guidedFaceScan';
import { decode } from 'base64-arraybuffer';


function AuditScreen() {
  const insets = useSafeAreaInsets();
  const { colors, toggleDarkMode, isDarkMode } = useTheme();
  const [pose, setPose] = useState<IdentityPose | FaceScanTarget | null>(null);
  const [saved, setSaved] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [failSave, setFailSave] = useState(false);
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>ทดสอบสแกนใบหน้า</Text>
      <Text style={[styles.text, { color: colors.textSecondary }]}>แอปทดสอบแยก · ภาพตัวอย่างสาธารณะ · ไม่บันทึกลงบัญชี</Text>
      <Text style={[styles.text, { color: supportsFaceInspection() ? colors.accentText : colors.dangerText }]}>{supportsFaceInspection() ? 'โมดูลตรวจใบหน้า: พร้อม' : 'โมดูลตรวจใบหน้า: ไม่พร้อม'}</Text>
      <Text style={[styles.text, { color: colors.textPrimary }]}>รูปที่บันทึกทดสอบ: {saved}</Text>
      <Text style={[styles.text, { color: colors.textPrimary }]}>ขนาดรูปที่ปรับแล้ว: {bytes} bytes</Text>
      {supportsGuidedFaceScan() && <TouchableOpacity accessibilityRole="button" accessibilityLabel="เปิดสแกนอัตโนมัติสามมุม" style={[styles.button, { backgroundColor: colors.accent }]} onPress={() => setPose('all')}><Text style={styles.buttonText}>เปิดสแกนอัตโนมัติสามมุม</Text></TouchableOpacity>}
      {IDENTITY_POSES.map(item => <TouchableOpacity key={item.key} accessibilityRole="button" accessibilityLabel={`เปิดสแกน ${item.label}`}
        style={[styles.button, { backgroundColor: colors.accent }]} onPress={() => setPose(item.key)}><Text style={styles.buttonText}>เปิดสแกน {item.label}</Text></TouchableOpacity>)}
      <TouchableOpacity accessibilityRole="button" style={[styles.button, { backgroundColor: colors.inputBg }]} onPress={() => setFailSave(value => !value)}>
        <Text style={{ color: colors.textPrimary }}>จำลองบันทึกล้มเหลว: {failSave ? 'เปิด' : 'ปิด'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={[styles.button, { backgroundColor: colors.inputBg }]} onPress={toggleDarkMode}>
        <Text style={{ color: colors.textPrimary }}>ธีม: {isDarkMode ? 'มืด' : 'สว่าง'}</Text>
      </TouchableOpacity>
    </ScrollView>
    <FaceCaptureModal pose={pose} onClose={() => setPose(null)} onSave={async (_pose, base64) => {
      if (failSave) throw new Error('Synthetic save failure');
      setBytes(decode(base64).byteLength); setSaved(value => value + 1);
    }} onSaveSet={async (photos, options) => {
      if (failSave) throw new Error('Synthetic save failure');
      setBytes(Object.values(photos).reduce((sum, value) => sum + decode(value).byteLength, 0));
      setSaved(value => value + Object.keys(photos).length);
      options.onProgress(['front', 'left', 'right']);
    }} />
  </View>;
}
function AuditApp() { return <SafeAreaProvider><ThemeProvider><AuditScreen /></ThemeProvider></SafeAreaProvider>; }
registerRootComponent(AuditApp);
const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 }, title: { fontSize: 24, fontWeight: '800' }, text: { fontSize: 16, lineHeight: 24 },
  button: { minHeight: 52, padding: 16, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});
