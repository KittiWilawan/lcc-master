import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { checkSystemReadiness, ReadinessStep, SystemReadiness } from '../lib/systemReadiness';
import { registerForPushNotificationsAsync, sendLocalTestNotification } from '../lib/pushNotifications';
import {
  canManageMonitorDevices,
  createMonitorPairingCode,
  listMonitorDevices,
  MonitorDevice,
  MonitorPairingCode,
  revokeMonitorDevice,
} from '../lib/monitorDevices';

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
  const [familyId, setFamilyId] = useState('');
  const [devices, setDevices] = useState<MonitorDevice[]>([]);
  const [canManageDevices, setCanManageDevices] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deviceError, setDeviceError] = useState('');
  const [creatingPairing, setCreatingPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState<MonitorPairingCode | null>(null);

  const loadMonitorDevices = useCallback(async () => {
    setLoadingDevices(true);
    setDeviceError('');
    try {
      const storedFamilyId = await AsyncStorage.getItem('familyId');
      setFamilyId(storedFamilyId ?? '');
      if (!storedFamilyId) {
        setDevices([]);
        setCanManageDevices(false);
        return;
      }
      const [availableDevices, mayManage] = await Promise.all([
        listMonitorDevices(storedFamilyId),
        canManageMonitorDevices(storedFamilyId),
      ]);
      setDevices(availableDevices.filter((device) => !device.revoked_at));
      setCanManageDevices(mayManage);
    } catch {
      setDeviceError('ยังอ่านสถานะคอมไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setErrorMessage('');
    try {
      const readiness = await checkSystemReadiness();
      setResult(readiness);
    } catch {
      setErrorMessage('ตรวจสอบระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    } finally {
      setChecking(false);
    }
    await loadMonitorDevices();
  }, [loadMonitorDevices]);

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

  const createPairingCode = async () => {
    if (!familyId || !canManageDevices) return;
    setCreatingPairing(true);
    try {
      setPairingCode(await createMonitorPairingCode(familyId));
    } catch {
      Alert.alert('สร้างรหัสไม่สำเร็จ', 'กรุณาตรวจอินเทอร์เน็ตและสิทธิ์เจ้าของครอบครัว แล้วลองอีกครั้ง');
    } finally {
      setCreatingPairing(false);
    }
  };

  const sharePairingCode = async () => {
    if (!pairingCode) return;
    await Share.share({
      message: `รหัสเชื่อมคอม LookLanCare: ${pairingCode.code}\nที่คอม ดับเบิลคลิกไฟล์ Start LookLanCare Hub.cmd แล้วกรอกรหัสนี้`,
    });
  };

  const removeDevice = (device: MonitorDevice) => {
    Alert.alert(
      'ยกเลิกการเชื่อมต่อคอม',
      `ต้องการยกเลิก “${device.name}” ใช่ไหม คอมเครื่องนี้จะหยุดส่งผลตรวจเข้าครอบครัว`,
      [
        { text: 'กลับ', style: 'cancel' },
        {
          text: 'ยกเลิกการเชื่อมต่อ',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await revokeMonitorDevice(familyId, device.id);
                setDevices((current) => current.filter((item) => item.id !== device.id));
              } catch {
                Alert.alert('ยกเลิกไม่สำเร็จ', 'กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
              }
            })();
          },
        },
      ],
    );
  };

  const deviceState = (device: MonitorDevice) => {
    if (device.state === 'running') return { label: 'กำลังทำงาน', color: '#15803d', background: '#dcfce7' };
    if (device.state === 'degraded') return { label: 'ต้องตรวจสอบ', color: '#b45309', background: '#fef3c7' };
    if (device.state === 'idle') return { label: 'พร้อมรอใช้งาน', color: '#1d4ed8', background: '#dbeafe' };
    return { label: 'หยุดทำงาน', color: '#b91c1c', background: '#fee2e2' };
  };

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

        <View style={[styles.computerCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.computerHeader}>
            <View style={[styles.computerIcon, { backgroundColor: colors.accentBg }]}>
              <MaterialCommunityIcons name="desktop-tower-monitor" size={26} color={colors.accentText} />
            </View>
            <View style={styles.computerHeaderText}>
              <Text style={[styles.computerTitle, { color: colors.textPrimary }]}>คอมที่ใช้ตรวจภาพ</Text>
              <Text style={[styles.computerSubtitle, { color: colors.textSecondary }]}>เชื่อมคอมที่เปิดค้างไว้เพื่อให้ AI ตรวจภาพจากกล้อง</Text>
            </View>
          </View>

          {loadingDevices ? (
            <View style={styles.computerLoading}>
              <ActivityIndicator color={colors.accentText} />
              <Text style={[styles.computerLoadingText, { color: colors.textSecondary }]}>กำลังตรวจคอมที่เชื่อมไว้...</Text>
            </View>
          ) : !familyId ? (
            <View style={[styles.computerNotice, { backgroundColor: colors.accentBg }]}>
              <Text style={[styles.computerNoticeText, { color: colors.accentText }]}>สร้างหรือเข้าร่วมครอบครัวก่อน แล้วจึงเชื่อมคอมได้</Text>
            </View>
          ) : deviceError ? (
            <View style={styles.deviceErrorRow}>
              <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#b91c1c" />
              <Text style={styles.deviceErrorText}>{deviceError}</Text>
            </View>
          ) : (
            <>
              {devices.length ? (
                <View style={styles.deviceList}>
                  {devices.map((device) => {
                    const state = deviceState(device);
                    return (
                      <View key={device.id} style={[styles.deviceRow, { borderColor: colors.cardBorder }]}>
                        <View style={styles.deviceDetails}>
                          <Text style={[styles.deviceName, { color: colors.textPrimary }]}>{device.name}</Text>
                          <View style={styles.deviceMetaRow}>
                            <View style={[styles.deviceBadge, { backgroundColor: state.background }]}>
                              <Text style={[styles.deviceBadgeText, { color: state.color }]}>{state.label}</Text>
                            </View>
                            <Text style={[styles.deviceCount, { color: colors.textSecondary }]}>กล้อง {device.camera_count} ตัว</Text>
                          </View>
                          {device.detail ? <Text style={[styles.deviceDetail, { color: colors.textSecondary }]}>{device.detail}</Text> : null}
                        </View>
                        {canManageDevices ? (
                          <TouchableOpacity
                            style={styles.removeDeviceButton}
                            onPress={() => removeDevice(device)}
                            accessibilityRole="button"
                            accessibilityLabel={`ยกเลิกการเชื่อมต่อ ${device.name}`}
                          >
                            <MaterialCommunityIcons name="link-off" size={22} color="#b91c1c" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.computerNotice, { backgroundColor: colors.accentBg }]}>
                  <Text style={[styles.computerNoticeTitle, { color: colors.textPrimary }]}>ยังไม่มีคอมที่เชื่อมต่อ</Text>
                  <Text style={[styles.computerNoticeText, { color: colors.textSecondary }]}>เจ้าของครอบครัวสามารถสร้างรหัสแล้วนำไปกรอกที่คอมได้</Text>
                </View>
              )}

              {pairingCode ? (
                <View style={styles.pairingBox}>
                  <Text style={styles.pairingLabel}>รหัสเชื่อมต่อคอม</Text>
                  <Text selectable style={styles.pairingCode}>{pairingCode.code}</Text>
                  <Text style={styles.pairingExpiry}>
                    ใช้รหัสนี้ก่อน {new Date(pairingCode.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                  </Text>
                  <TouchableOpacity style={styles.shareButton} onPress={() => void sharePairingCode()} accessibilityRole="button">
                    <MaterialCommunityIcons name="share-variant-outline" size={20} color="#065f46" />
                    <Text style={styles.shareButtonText}>ส่งรหัสไปที่คอม</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {canManageDevices ? (
                <TouchableOpacity
                  style={[styles.pairButton, creatingPairing && styles.checkButtonDisabled]}
                  onPress={() => void createPairingCode()}
                  disabled={creatingPairing}
                  accessibilityRole="button"
                  accessibilityLabel="สร้างรหัสเชื่อมต่อคอมเครื่องใหม่"
                >
                  {creatingPairing
                    ? <ActivityIndicator color="#ffffff" />
                    : <MaterialCommunityIcons name="link-plus" size={22} color="#ffffff" />}
                  <Text style={styles.pairButtonText}>{pairingCode ? 'สร้างรหัสใหม่' : 'เชื่อมต่อคอมเครื่องใหม่'}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.ownerOnlyText, { color: colors.textSecondary }]}>เจ้าของครอบครัวเป็นผู้เชื่อมต่อหรือยกเลิกคอม</Text>
              )}
            </>
          )}
        </View>

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
  computerCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 14 },
  computerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  computerIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  computerHeaderText: { flex: 1 },
  computerTitle: { fontSize: 17, fontWeight: '900' },
  computerSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  computerLoading: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  computerLoadingText: { fontSize: 12 },
  computerNotice: { borderRadius: 14, padding: 14 },
  computerNoticeTitle: { fontSize: 14, fontWeight: '900' },
  computerNoticeText: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  deviceErrorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, backgroundColor: '#fef2f2', padding: 13 },
  deviceErrorText: { flex: 1, color: '#b91c1c', fontSize: 12, lineHeight: 18 },
  deviceList: { gap: 10 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 13, gap: 8 },
  deviceDetails: { flex: 1 },
  deviceName: { fontSize: 14, fontWeight: '900' },
  deviceMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  deviceBadge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 },
  deviceBadgeText: { fontSize: 10, fontWeight: '800' },
  deviceCount: { fontSize: 11, fontWeight: '700' },
  deviceDetail: { fontSize: 11, lineHeight: 17, marginTop: 6 },
  removeDeviceButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pairingBox: { borderRadius: 16, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#6ee7b7', padding: 16, alignItems: 'center' },
  pairingLabel: { color: '#065f46', fontSize: 12, fontWeight: '800' },
  pairingCode: { color: '#064e3b', fontSize: 34, letterSpacing: 6, fontWeight: '900', marginTop: 6 },
  pairingExpiry: { color: '#047857', fontSize: 11, marginTop: 5 },
  shareButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, paddingHorizontal: 14 },
  shareButtonText: { color: '#065f46', fontSize: 13, fontWeight: '900' },
  pairButton: { minHeight: 52, borderRadius: 15, backgroundColor: '#059669', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  pairButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  ownerOnlyText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  homeButton: { minHeight: 52, borderRadius: 16, backgroundColor: '#d1fae5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  homeButtonText: { color: '#065f46', fontSize: 15, fontWeight: '900' },
  helpCard: { borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  helpText: { flex: 1, fontSize: 12, lineHeight: 19, fontWeight: '600' },
});
