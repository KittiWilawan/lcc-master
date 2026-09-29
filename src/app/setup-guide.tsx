import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { checkSystemReadiness, ReadinessStep, SystemReadiness } from '../lib/systemReadiness';
import { registerForPushNotificationsAsync, sendLocalTestNotification } from '../lib/pushNotifications';

const ICONS: Record<ReadinessStep['id'], keyof typeof MaterialCommunityIcons.glyphMap> = {
  account: 'account-check-outline',
  family: 'home-heart',
  recipient: 'account-heart-outline',
  identity: 'face-recognition',
  camera: 'cctv',
  background: 'cellphone-lock',
  notification: 'bell-ring-outline',
};

export default function SetupGuideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode } = useTheme();
  const [result, setResult] = useState<SystemReadiness | null>(null);
  const [checking, setChecking] = useState(true);
  const [testingNotification, setTestingNotification] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const runCheck = useCallback(async () => {
    setChecking(true);
    setErrorMessage('');
    try {
      setResult(await checkSystemReadiness());
    } catch {
      setErrorMessage('ตรวจสอบระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    } finally {
      setChecking(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void runCheck();
  }, [runCheck]));

  const openStep = (step: ReadinessStep) => {
    if (step.id === 'camera') {
      router.push({ pathname: '/home', params: { openCameraSetup: 'true' } });
      return;
    }
    if (step.route) {
      router.push(step.route);
      return;
    }
    Alert.alert(
      'เปิดการเฝ้าระวังเบื้องหลัง',
      'กลับไปหน้าหลัก รอจนขึ้นว่า AI กำลังเฝ้าระวังเบื้องหลัง แล้วจึงปิดหน้าจอได้'
    );
  };

  const progress = result?.progress ?? 0;

  const testNotification = async () => {
    setTestingNotification(true);
    try {
      const enabled = await registerForPushNotificationsAsync();
      if (!enabled) {
        Alert.alert(
          'ยังเปิดการแจ้งเตือนไม่ได้',
          'เปิดสิทธิ์การแจ้งเตือนให้ LookLanCare ในการตั้งค่ามือถือ แล้วกลับมาทดสอบอีกครั้ง'
        );
        return;
      }
      const sent = await sendLocalTestNotification();
      if (!sent) {
        Alert.alert(
          'ต้องใช้แอปเวอร์ชันทดสอบ',
          'Expo Go บน Android ไม่รองรับการแจ้งเตือนส่วนนี้ กรุณาติดตั้ง Development Build แล้วทดสอบอีกครั้ง'
        );
        return;
      }
      Alert.alert('ทดสอบสำเร็จ', 'มือถือเครื่องนี้พร้อมแสดงการแจ้งเตือนจาก LookLanCare');
      await runCheck();
    } catch {
      Alert.alert('ทดสอบไม่สำเร็จ', 'กรุณาตรวจสิทธิ์การแจ้งเตือนและลองอีกครั้ง');
    } finally {
      setTestingNotification(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.cardBorder }]}>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: colors.accentBg }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="ย้อนกลับ"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.accentText} />
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>เตรียมระบบให้พร้อม</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>ทำตามรายการทีละข้อ ใช้ต่อจากจุดเดิมได้เสมอ</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <View style={styles.progressTextBlock}>
              <Text style={styles.progressEyebrow}>ความพร้อมของระบบ</Text>
              <Text style={styles.progressTitle}>
                {result?.ready ? 'พร้อมเริ่มดูแลแล้ว' : `สำเร็จ ${result?.completedCount ?? 0} จาก ${result?.totalCount ?? 7} ขั้นตอน`}
              </Text>
            </View>
            <Text style={styles.progressPercent}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressHint}>
            {result?.ready
              ? 'กล้อง การเฝ้าระวังเบื้องหลัง และการแจ้งเตือนพร้อมทำงาน'
              : 'แตะรายการที่ยังไม่พร้อมเพื่อไปตั้งค่าต่อ'}
          </Text>
        </View>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <MaterialCommunityIcons name="wifi-alert" size={24} color="#b91c1c" />
            <View style={styles.errorTextBlock}>
              <Text style={styles.errorTitle}>ยังตรวจระบบไม่ได้</Text>
              <Text style={styles.errorDescription}>{errorMessage}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>รายการตั้งค่า</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>ระบบจะตรวจให้อัตโนมัติเมื่อกลับมาหน้านี้</Text>
        </View>

        {checking && !result ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.accentText} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>กำลังตรวจกล้อง ระบบเบื้องหลัง และการแจ้งเตือน...</Text>
          </View>
        ) : (
          <View style={styles.stepList}>
            {result?.steps.map((step, index) => (
              <TouchableOpacity
                key={step.id}
                style={[
                  styles.stepCard,
                  { backgroundColor: colors.card, borderColor: step.ready ? '#86efac' : colors.cardBorder },
                ]}
                onPress={() => step.ready ? undefined : openStep(step)}
                disabled={step.ready}
                accessibilityRole="button"
                accessibilityState={{ disabled: step.ready }}
                accessibilityLabel={`${step.title} ${step.ready ? 'พร้อมแล้ว' : 'ยังไม่พร้อม'}`}
              >
                <View style={[styles.stepNumber, { backgroundColor: step.ready ? '#dcfce7' : colors.accentBg }]}>
                  {step.ready ? (
                    <MaterialCommunityIcons name="check" size={22} color="#15803d" />
                  ) : (
                    <Text style={[styles.stepNumberText, { color: colors.accentText }]}>{index + 1}</Text>
                  )}
                </View>
                <View style={styles.stepBody}>
                  <View style={styles.stepTitleRow}>
                    <MaterialCommunityIcons name={ICONS[step.id]} size={20} color={step.ready ? '#15803d' : colors.accentText} />
                    <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>{step.title}</Text>
                  </View>
                  <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>{step.description}</Text>
                  {!step.ready ? <Text style={[styles.stepAction, { color: colors.accentText }]}>{step.actionLabel}</Text> : null}
                </View>
                {!step.ready ? <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.checkButton, checking && styles.checkButtonDisabled]}
          onPress={() => void runCheck()}
          disabled={checking}
          accessibilityRole="button"
          accessibilityLabel="ตรวจสอบระบบทั้งหมดอีกครั้ง"
        >
          {checking ? <ActivityIndicator color="#ffffff" /> : <MaterialCommunityIcons name="shield-search" size={22} color="#ffffff" />}
          <Text style={styles.checkButtonText}>{checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบระบบทั้งหมดอีกครั้ง'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.notificationButton, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}
          onPress={() => void testNotification()}
          disabled={testingNotification}
          accessibilityRole="button"
          accessibilityLabel="ทดสอบการแจ้งเตือนบนมือถือเครื่องนี้"
        >
          {testingNotification
            ? <ActivityIndicator color={colors.accentText} />
            : <MaterialCommunityIcons name="bell-check-outline" size={22} color={colors.accentText} />}
          <View style={styles.notificationButtonText}>
            <Text style={[styles.notificationButtonTitle, { color: colors.textPrimary }]}>ทดสอบการแจ้งเตือนบนมือถือ</Text>
            <Text style={[styles.notificationButtonSubtitle, { color: colors.textSecondary }]}>ส่งเฉพาะเครื่องนี้ ไม่แจ้งสมาชิกคนอื่น</Text>
          </View>
        </TouchableOpacity>

        {result?.ready ? (
          <TouchableOpacity style={styles.homeButton} onPress={() => router.replace('/home')}>
            <Text style={styles.homeButtonText}>ไปหน้าหลักและเริ่มดูแล</Text>
            <MaterialCommunityIcons name="arrow-right" size={22} color="#065f46" />
          </TouchableOpacity>
        ) : null}

        <View style={[styles.helpCard, { backgroundColor: isDarkMode ? '#172554' : '#eff6ff' }]}>
          <MaterialCommunityIcons name="information-outline" size={22} color="#2563eb" />
          <Text style={[styles.helpText, { color: isDarkMode ? '#bfdbfe' : '#1e3a8a' }]}>
            ถ้าขั้นตอนไหนไม่ผ่าน ให้แตะรายการนั้น ระบบจะพาไปยังหน้าที่ต้องแก้โดยตรง
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  headerSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  content: { padding: 16, gap: 16 },
  progressCard: { borderRadius: 24, backgroundColor: '#065f46', padding: 20 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTextBlock: { flex: 1 },
  progressEyebrow: { color: '#a7f3d0', fontSize: 12, fontWeight: '700' },
  progressTitle: { color: '#ffffff', fontSize: 20, lineHeight: 28, fontWeight: '900', marginTop: 4 },
  progressPercent: { color: '#ffffff', fontSize: 30, fontWeight: '900' },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: '#064e3b', marginTop: 18, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#6ee7b7' },
  progressHint: { color: '#d1fae5', fontSize: 13, lineHeight: 20, marginTop: 12 },
  errorCard: { flexDirection: 'row', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', padding: 16 },
  errorTextBlock: { flex: 1 },
  errorTitle: { color: '#991b1b', fontSize: 15, fontWeight: '800' },
  errorDescription: { color: '#b91c1c', fontSize: 13, lineHeight: 19, marginTop: 3 },
  sectionHeader: { gap: 3 },
  sectionTitle: { fontSize: 18, fontWeight: '900' },
  sectionSubtitle: { fontSize: 12, lineHeight: 18 },
  loadingCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontSize: 13 },
  stepList: { gap: 12 },
  stepCard: { minHeight: 96, borderRadius: 18, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 16, fontWeight: '900' },
  stepBody: { flex: 1 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stepTitle: { fontSize: 15, fontWeight: '900' },
  stepDescription: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  stepAction: { fontSize: 13, fontWeight: '800', marginTop: 8 },
  checkButton: { minHeight: 54, borderRadius: 16, backgroundColor: '#059669', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  checkButtonDisabled: { opacity: 0.65 },
  checkButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  notificationButton: { minHeight: 64, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingVertical: 10 },
  notificationButtonText: { flex: 1 },
  notificationButtonTitle: { fontSize: 14, fontWeight: '900' },
  notificationButtonSubtitle: { fontSize: 11, lineHeight: 17, marginTop: 2 },
  homeButton: { minHeight: 52, borderRadius: 16, backgroundColor: '#d1fae5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  homeButtonText: { color: '#065f46', fontSize: 15, fontWeight: '900' },
  helpCard: { borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  helpText: { flex: 1, fontSize: 12, lineHeight: 19, fontWeight: '600' },
});
