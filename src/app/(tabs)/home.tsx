import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MonitoredCameraFeed } from '../../components/MonitoredCameraFeed';
import { FalseAlarmCountdownModal } from '../../components/FalseAlarmCountdownModal';
import { FullScreenCameraModal } from '../../components/FullScreenCameraModal';
import { useTheme } from '../../context/ThemeContext';
import { recordFallEvent } from '../../lib/fallEvidence';
import {
  registerForPushNotificationsAsync,
  sendLocalFallNotification,
  sendLocalSOSNotification,
} from '../../lib/pushNotifications';
import { playEmergencySiren, speakCalmingMessage } from '../../lib/emergencyAudio';
import { describeCameraAttribution, getAnalysisIntervalMs, getCaptureQuality } from '../../lib/cameraAnalysis';
import { supabase } from '../../lib/supabase';
import { describeMonitorHealth, loadMonitorHealth } from '../../lib/monitorHealth';
import { getFriendlyErrorMessage } from '../../lib/friendlyError';
import { testCameraConnection } from '../../lib/cameraConnectionTest';
import { callPhoneNumber, getEmergencyPhoneNumber } from '../../lib/phone';
import { startBackgroundMonitoring, stopBackgroundMonitoring } from '../../lib/backgroundMonitoring';
import { getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from '../../lib/monitoringPolicy';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface CameraItem {
  id: string;
  name: string;
  type: 'video' | 'device' | 'rtsp';
  url?: string;
  snapshot_url?: string;
  protocol?: 'rtsp' | 'rtmp' | 'hls' | 'mp4' | 'unknown';
  assigned_member_id?: string;
  assigned_member_name?: string;
}

export default function DashboardScreen() {
  const router = useRouter();
  const { openCameraSetup } = useLocalSearchParams<{ openCameraSetup?: string }>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode, seniorMode } = useTheme();
  const homeWorkerMode = process.env.EXPO_PUBLIC_AI_MODE === 'home_worker';
  const emergencyPhoneLabel = process.env.EXPO_PUBLIC_EMERGENCY_PHONE_NUMBER ?? 'เบอร์ฉุกเฉิน';
  const [monitorSummary, setMonitorSummary] = useState({
    title: 'กำลังตรวจสถานะคอมบ้าน', subtitle: 'รอข้อมูลล่าสุดจากระบบ', online: false,
  });

  // Camera State
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loadingCameras, setLoadingCameras] = useState(true);
  const [backgroundMonitoringActive, setBackgroundMonitoringActive] = useState(false);
  const [backgroundMonitoringError, setBackgroundMonitoringError] = useState('');
  const [fullscreenCam, setFullscreenCam] = useState<CameraItem | null>(null);
  const [activeAlertCamId, setActiveAlertCamId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [newCamName, setNewCamName] = useState('');
  const [newCamType, setNewCamType] = useState<'video' | 'device' | 'rtsp'>('rtsp');
  const [newCamUrl, setNewCamUrl] = useState('');
  const [newSnapshotUrl, setNewSnapshotUrl] = useState('');
  const [showAdvancedCamera, setShowAdvancedCamera] = useState(false);
  const [assignedMemberId, setAssignedMemberId] = useState<string>('');
  const [cameraTest, setCameraTest] = useState<{ state: 'idle' | 'testing' | 'success' | 'error'; message: string }>({ state: 'idle', message: '' });
  const [savingCamera, setSavingCamera] = useState(false);
  const [showFalseAlarmModal, setShowFalseAlarmModal] = useState(false);
  const [pendingFallInfo, setPendingFallInfo] = useState<{ camName?: string; personName?: string; imageUri?: string } | null>(null);
  const pendingAlertRef = useRef(false);

  const [events, setEvents] = useState<{ id: number; time: string; title: string; subtitle: string; isAlert: boolean }[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [emergencyContact, setEmergencyContact] = useState<{ name: string; phone: string } | null>(null);

  useEffect(() => {
    if (!isFocused || openCameraSetup !== 'true') return;
    const openTimer = setTimeout(() => {
      setShowAddCameraModal(true);
      router.setParams({ openCameraSetup: '' });
    }, 0);
    return () => clearTimeout(openTimer);
  }, [isFocused, openCameraSetup, router]);

  useEffect(() => {
    if (!isFocused || !homeWorkerMode) return;
    const pollMs = Number(process.env.EXPO_PUBLIC_MONITOR_STATUS_POLL_MS);
    const staleAfterMs = Number(process.env.EXPO_PUBLIC_MONITOR_STATUS_STALE_MS);
    let active = true;
    const refresh = async () => {
      try {
        const familyId = await AsyncStorage.getItem('familyId');
        if (!Number.isSafeInteger(pollMs) || pollMs <= 0 ||
            !Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
          throw new Error('ตั้งค่าเวลาตรวจสถานะไม่ถูกต้อง');
        }
        const health = familyId ? await loadMonitorHealth(familyId) : null;
        if (active) setMonitorSummary(describeMonitorHealth(health, Date.now(), staleAfterMs));
      } catch {
        if (active) setMonitorSummary({
          title: 'ตรวจสถานะคอมบ้านไม่ได้', subtitle: 'ตรวจอินเทอร์เน็ตและการตั้งค่าระบบ', online: false,
        });
      }
    };
    void refresh();
    const timer = Number.isSafeInteger(pollMs) && pollMs > 0
      ? setInterval(() => void refresh(), pollMs) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [isFocused, homeWorkerMode]);

  // Animations
  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const glowAnim = useMemo(() => new Animated.Value(0.3), []);

  const loadCameras = useCallback(async () => {
    setLoadingCameras(true);
    try {
      const familyId = await AsyncStorage.getItem('familyId');

      if (familyId) {
        const { data: dbCameras, error } = await supabase
          .from('cameras')
          .select('*, family_members(display_name)')
          .eq('family_id', familyId)
          .order('created_at', { ascending: true });

        if (!error && dbCameras) {
          const mapped: CameraItem[] = dbCameras.map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type || 'rtsp',
            url: c.url || undefined,
            snapshot_url: c.snapshot_url || undefined,
            protocol: c.protocol || 'rtsp',
            assigned_member_id: c.assigned_member_id || undefined,
            assigned_member_name: c.family_members?.display_name || undefined,
          }));
          setCameras(mapped);
          await AsyncStorage.setItem('@family_cameras', JSON.stringify(mapped));
          return;
        }
      }

      setCameras([]);
    } catch (e) {
      console.log('Error loading cameras', e);
    } finally {
      setLoadingCameras(false);
    }
  }, []);

  const handleAddCamera = async () => {
    if (trackedCount > 0 && !assignedMemberId) {
      Alert.alert('เลือกผู้รับการดูแล', 'กล้องต้องมีผู้รับการดูแลหลัก เพื่อให้ข้อความแจ้งเตือนไม่ระบุชื่อผิดคน');
      return;
    }
    const assignedMember = careRecipients.find((member) => member.id === assignedMemberId);
    if (trackedCount > 0 && !assignedMember) {
      Alert.alert('ไม่พบผู้รับการดูแล', 'กรุณาเพิ่มผู้รับการดูแลก่อนเพิ่มกล้อง');
      return;
    }
    if (trackedCount > 0 && assignedMember && !assignedMember.is_tracked) {
      Alert.alert('ยังไม่ได้เลือกให้เฝ้าดู', `เปิด “รวมในการเฝ้าดู” ให้ ${assignedMember.display_name} ก่อน`);
      return;
    }
    if (newCamType === 'device' && cameras.some((camera) => camera.type === 'device')) {
      Alert.alert('มีกล้องมือถือแล้ว', 'อุปกรณ์หนึ่งเครื่องเปิดกล้องได้ครั้งละหนึ่งตัว');
      return;
    }
    if (newCamType !== 'device') {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(newCamUrl.trim());
      } catch {
        Alert.alert('URL ไม่ถูกต้อง', 'กรุณาระบุ URL ของสตรีมกล้อง');
        return;
      }
      if (newCamType === 'video' && !newSnapshotUrl.trim()) {
        Alert.alert('ยังไม่มีภาพสำหรับ AI', 'วิดีโอทดสอบต้องมีลิงก์ภาพนิ่งสำหรับ AI');
        return;
      }
      if (cameraTest.state !== 'success') {
        Alert.alert('กรุณาทดสอบกล้องก่อน', 'กด “ทดสอบการเชื่อมต่อ” และรอให้ขึ้นว่าพร้อมใช้งาน');
        return;
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        Alert.alert('สตรีมยังไม่รองรับ', 'กรุณาแปลง RTSP/RTMP เป็น HLS ผ่านเกตเวย์ แล้วใส่ URL HTTP หรือ HTTPS');
        return;
      }
    }
    if (newSnapshotUrl.trim()) {
      try {
        const parsedSnapshot = new URL(newSnapshotUrl.trim());
        if (parsedSnapshot.protocol !== 'https:' && parsedSnapshot.protocol !== 'http:') throw new Error();
      } catch {
        Alert.alert('URL ภาพนิ่งไม่ถูกต้อง', 'กรุณาใช้ URL HTTP หรือ HTTPS ที่ส่งภาพ JPEG/PNG');
        return;
      }
    }
    if (newCamType === 'device') {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          alert('ต้องอนุญาตให้แอปใช้กล้องเพื่อใช้งานโหมดนี้ครับ');
          return;
        }
      }
    }

    let protocol: 'rtsp' | 'rtmp' | 'hls' | 'mp4' | 'unknown' = 'unknown';
    if (newCamType === 'rtsp') {
      const urlLower = newCamUrl.toLowerCase();
      if (urlLower.startsWith('rtsp://')) protocol = 'rtsp';
      else if (urlLower.startsWith('rtmp://')) protocol = 'rtmp';
      else if (urlLower.includes('.m3u8')) protocol = 'hls';
    } else if (newCamType === 'video') {
      protocol = 'mp4';
    }

    const cameraName = newCamName || (newCamType === 'device' ? 'กล้องมือถือ' : newCamType === 'rtsp' ? 'กล้องภายนอก' : 'วิดีโอ');

    setSavingCamera(true);
    try {
      const familyId = await AsyncStorage.getItem('familyId');
      if (!familyId) throw new Error('กรุณาเข้าร่วมครอบครัวก่อนเพิ่มกล้อง');
      const { data, error } = await supabase
          .from('cameras')
          .insert({
            family_id: familyId,
            name: cameraName,
            type: newCamType,
            url: (newCamType === 'video' || newCamType === 'rtsp') ? newCamUrl : null,
            snapshot_url: newSnapshotUrl.trim() || (newCamType === 'rtsp' ? newCamUrl.trim() : null),
            protocol,
            assigned_member_id: assignedMemberId || null,
          })
          .select()
          .single();

        if (error) throw error;
        if (!data?.id) throw new Error('บันทึกกล้องไม่สำเร็จ');
      const newCam: CameraItem = {
        id: data.id,
        name: cameraName,
        type: newCamType,
        url: (newCamType === 'video' || newCamType === 'rtsp') ? newCamUrl : undefined,
        snapshot_url: newSnapshotUrl.trim() || (newCamType === 'rtsp' ? newCamUrl.trim() : undefined),
        protocol,
        assigned_member_id: assignedMemberId || undefined,
        assigned_member_name: assignedMember?.display_name,
      };

      const updated = [...cameras, newCam];
      setCameras(updated);
      try {
        await AsyncStorage.setItem('@family_cameras', JSON.stringify(updated));
      } catch (cacheError) {
        console.log('Camera cache notice:', cacheError);
      }
      setShowAddCameraModal(false);
      setNewCamName('');
      setNewCamUrl('');
      setNewSnapshotUrl('');
      setShowAdvancedCamera(false);
      setAssignedMemberId('');
      setCameraTest({ state: 'idle', message: '' });
    } catch (err) {
      Alert.alert('เพิ่มกล้องไม่สำเร็จ', getFriendlyErrorMessage(err, 'ตรวจข้อมูลกล้องแล้วลองอีกครั้ง'));
    } finally {
      setSavingCamera(false);
    }
  };

  const handleTestCamera = async () => {
    setCameraTest({ state: 'testing', message: 'กำลังรับภาพจากกล้อง...' });
    try {
      const result = await testCameraConnection(newCamUrl, newSnapshotUrl);
      setCameraTest({ state: result.success ? 'success' : 'error', message: result.message });
    } catch (error) {
      setCameraTest({ state: 'error', message: getFriendlyErrorMessage(error, 'ทดสอบกล้องไม่สำเร็จ กรุณาลองอีกครั้ง') });
    }
  };

  const loadUserProfile = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const [profileResult, contactResult] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url').eq('id', session.user.id).single(),
        supabase.from('emergency_contacts')
          .select('name, phone')
          .eq('profile_id', session.user.id)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!profileResult.error && profileResult.data) setUserProfile(profileResult.data);
      if (!contactResult.error) setEmergencyContact(contactResult.data);
    } catch (e) {
      console.log('Error loading user profile:', e);
    }
  }, []);

  const loadFamilyMembers = useCallback(async () => {
    try {
      setLoadingMembers(true);
      const familyId = await AsyncStorage.getItem('familyId');
      if (!familyId) return;

      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('family_id', familyId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setMembers(data);
      }
    } catch (e) {
      console.log('Error loading members:', e);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    const refreshId = setTimeout(() => {
      void loadFamilyMembers();
      void loadCameras();
      void loadUserProfile();
    }, 0);
    return () => clearTimeout(refreshId);
  }, [isFocused, loadFamilyMembers, loadCameras, loadUserProfile]);

  useEffect(() => {
    void registerForPushNotificationsAsync();

    // Pulse animation for AI status dot
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    // Glow animation for live indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim, glowAnim]);

  const toggleTracking = async (id: string, currentVal: boolean) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, is_tracked: !currentVal } : m));

    const { error } = await supabase
      .from('family_members')
      .update({ is_tracked: !currentVal })
      .eq('id', id);

    if (error) {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, is_tracked: currentVal } : m));
      console.error(error);
    }
  };

  const confirmDeleteCamera = (camId: string, camName: string) => {
    Alert.alert(
      'ยืนยันการลบกล้อง',
      `คุณแน่ใจหรือไม่ว่าต้องการลบกล้อง "${camName}" ออก?`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบกล้อง',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('cameras').delete().eq('id', camId);
              if (error) throw error;
              const updated = cameras.filter(c => c.id !== camId);
              setCameras(updated);
              await AsyncStorage.setItem('@family_cameras', JSON.stringify(updated));
            } catch (delErr) {
              Alert.alert('ลบกล้องไม่สำเร็จ', getFriendlyErrorMessage(delErr));
            }
          },
        },
      ]
    );
  };

  const clearEvents = () => setEvents([]);
  const callEmergencyService = async () => {
    try {
      const opened = await callPhoneNumber(getEmergencyPhoneNumber());
      if (!opened) Alert.alert('โทรออกไม่ได้', 'อุปกรณ์นี้ไม่รองรับการโทร กรุณาใช้โทรศัพท์โทรหาเบอร์ฉุกเฉิน');
    } catch (error) {
      Alert.alert('โทรออกไม่ได้', getFriendlyErrorMessage(error));
    }
  };

  const callPrimaryContact = async () => {
    if (!emergencyContact) {
      setShowSOSModal(false);
      router.push({ pathname: '/profile', params: { section: 'contacts', action: 'add' } });
      return;
    }
    const opened = await callPhoneNumber(emergencyContact.phone);
    if (!opened) Alert.alert('โทรออกไม่ได้', 'กรุณาตรวจเบอร์ผู้ติดต่อฉุกเฉินในหน้าโปรไฟล์');
  };

  const triggerEmergencySOS = async () => {
    playEmergencySiren();
    void speakCalmingMessage(careRecipients.find(m => m.is_tracked)?.display_name);
    setShowSOSModal(true);
    const timeNow = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    setEvents(prev => [
      { id: Date.now(), time: timeNow, title: '🚨 สัญญาณ SOS ขอความช่วยเหลือ', subtitle: 'ผู้ใช้กดปุ่มฉุกเฉินบนหน้าจอ', isAlert: true },
      ...prev
    ]);

    const currentActivePerson = careRecipients.find(m => m.is_tracked)?.display_name || 'ยังไม่ยืนยันตัวบุคคล';

    // Send OS lock-screen notification through the app.
    void sendLocalSOSNotification();
    void recordFallEvent({ memberName: currentActivePerson, cameraName: 'ปุ่ม SOS', eventType: 'sos', details: 'ผู้ใช้กดปุ่มขอความช่วยเหลือ' });
  };

  const handleInitiateFallAlert = (camName?: string, personName?: string, imageUri?: string) => {
    if (pendingAlertRef.current) return;
    pendingAlertRef.current = true;
    setPendingFallInfo({ camName, personName, imageUri });
    setShowFalseAlarmModal(true);
  };

  const handleCancelFallAlert = async () => {
    pendingAlertRef.current = false;
    setActiveAlertCamId(null);
    setShowFalseAlarmModal(false);
    setPendingFallInfo(null);
    const timeNow = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    setEvents(prev => [
      { id: Date.now(), time: timeNow, title: 'ยกเลิกการแจ้งเตือน (False Alarm)', subtitle: 'ผู้ใช้กดยกเลิก "ฉันสบายดี"', isAlert: false },
      ...prev
    ]);
  };

  const handleConfirmFallAlert = async () => {
    pendingAlertRef.current = false;
    setActiveAlertCamId(null);
    setShowFalseAlarmModal(false);
    const targetPerson = pendingFallInfo?.personName || 'ยังไม่ยืนยันตัวบุคคล';
    const targetCam = pendingFallInfo?.camName || 'กล้องวงจรปิด';
    const evidenceImage = pendingFallInfo?.imageUri;
    setPendingFallInfo(null);

    const timeNow = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    setEvents(prev => [
      { id: Date.now(), time: timeNow, title: '🚨 แจ้งเตือนเหตุที่ AI สงสัยว่าอาจล้ม', subtitle: `ภาพจาก ${targetCam}`, isAlert: true },
      ...prev
    ]);

    playEmergencySiren();
    void speakCalmingMessage();

    // Send local and remote app notifications.
    void sendLocalFallNotification({
      personName: targetPerson,
      cameraName: targetCam,
    });

    // Record Fall Event with Evidence Photo to Supabase & Local DB
    void recordFallEvent({
      memberName: targetPerson,
      cameraName: targetCam,
      imageUri: evidenceImage,
      eventType: 'actual',
    });
  };

  const addEvent = async (camName?: string, personName?: string, imageUri?: string) => {
    handleInitiateFallAlert(camName, personName, imageUri);
  };

  const careRecipients = members.filter(m => !m.user_id);
  const trackedCount = careRecipients.filter(m => m.is_tracked).length;
  const trackedMemberIds = getTrackedMemberIds(careRecipients);
  const allPeopleMode = usesAllPeopleMode(trackedMemberIds);
  const aiConfigured = Boolean(!homeWorkerMode && process.env.EXPO_PUBLIC_AI_FUNCTION_NAME && getAnalysisIntervalMs() && getCaptureQuality() &&
    Number(process.env.EXPO_PUBLIC_AI_FALL_CONFIDENCE) > 0 && Number(process.env.EXPO_PUBLIC_AI_FALL_CONFIDENCE) <= 1 &&
    Number.isInteger(Number(process.env.EXPO_PUBLIC_AI_CONFIRMATIONS)) && Number(process.env.EXPO_PUBLIC_AI_CONFIRMATIONS) > 0);
  const monitoringCount = aiConfigured
    ? cameras.filter((camera) => shouldMonitorCamera(camera, trackedMemberIds)).length : 0;

  useEffect(() => {
    if (Platform.OS !== 'android' || loadingMembers || loadingCameras) return;
    let active = true;
    const syncBackgroundMonitoring = async () => {
      try {
        if (monitoringCount > 0) {
          await startBackgroundMonitoring();
          if (active) setBackgroundMonitoringActive(true);
        } else {
          await stopBackgroundMonitoring();
          if (active) setBackgroundMonitoringActive(false);
        }
        if (active) setBackgroundMonitoringError('');
      } catch (error) {
        if (!active) return;
        setBackgroundMonitoringActive(false);
        setBackgroundMonitoringError(error instanceof Error ? error.message : 'เปิดการเฝ้าระวังเบื้องหลังไม่สำเร็จ');
      }
    };
    void syncBackgroundMonitoring();
    return () => { active = false; };
  }, [loadingCameras, loadingMembers, monitoringCount]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.safeArea}>

        {/* =========================================================
            HEADER - Glassmorphism style
           ========================================================= */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 14), backgroundColor: colors.headerBg, borderBottomColor: colors.cardBorder }]}>
          <View style={styles.headerLeft}>
            <View style={styles.logoContainer}>
              <Image
                source={require('@/assets/images/iconlnw.png')}
                style={styles.logo}
                contentFit="cover"
              />
              <View style={styles.logoOnlineDot} />
            </View>
            <View>
              <Text style={[styles.appName, seniorMode && styles.seniorAppName, { color: colors.textPrimary }]}>LookLanCare</Text>
              <Text style={[styles.familyName, seniorMode && styles.seniorFamilyName, { color: colors.textSecondary }]}>ดูแลคนที่คุณรัก</Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={[styles.notifBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc', borderColor: colors.cardBorder }]} onPress={() => router.push('/alerts')} accessibilityLabel="เปิดการแจ้งเตือน">
              <MaterialCommunityIcons name="bell-outline" size={22} color={colors.textSecondary} />
              {events.length > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{events.length}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileBtn} onPress={() => router.push('/profile')}>
              {userProfile?.avatar_url ? (
                <Image source={{ uri: userProfile.avatar_url }} style={styles.profileAvatar} />
              ) : (
                <MaterialCommunityIcons name="account" size={22} color="#059669" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>

          {seniorMode ? (
            <View style={styles.seniorDashboard}>
              <View style={[styles.seniorWelcomeCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <MaterialCommunityIcons name="hand-wave-outline" size={36} color="#047857" />
                <Text style={[styles.seniorWelcomeTitle, { color: colors.textPrimary }]}>สวัสดี วันนี้ระบบเป็นอย่างไร</Text>
                <View style={[styles.seniorStatusPill, (homeWorkerMode ? monitorSummary.online : monitoringCount > 0) && styles.seniorStatusPillReady]}>
                  <MaterialCommunityIcons
                    name={(homeWorkerMode ? monitorSummary.online : monitoringCount > 0) ? 'check-circle' : 'alert-circle'}
                    size={26}
                    color={(homeWorkerMode ? monitorSummary.online : monitoringCount > 0) ? '#166534' : '#92400e'}
                  />
                  <Text style={styles.seniorStatusText}>
                    {(homeWorkerMode ? monitorSummary.online : monitoringCount > 0) ? 'ระบบกำลังดูแลอยู่' : 'มีบางอย่างที่ต้องตั้งค่า'}
                  </Text>
                </View>
                <Text style={[styles.seniorInstruction, { color: colors.textSecondary }]}>แตะปุ่มใหญ่ด้านล่างตามสิ่งที่ต้องการทำ</Text>
              </View>

              <TouchableOpacity
                style={[styles.seniorActionButton, styles.seniorStatusButton]}
                onPress={() => router.push('/setup-guide')}
                accessibilityRole="button"
                accessibilityLabel="ดูสถานะระบบ"
              >
                <View style={styles.seniorActionIcon}>
                  <MaterialCommunityIcons name="shield-check-outline" size={34} color="#ffffff" />
                </View>
                <View style={styles.seniorActionText}>
                  <Text style={styles.seniorActionTitle}>ดูสถานะระบบ</Text>
                  <Text style={styles.seniorActionSubtitle}>ตรวจว่ากล้องและการแจ้งเตือนพร้อมหรือไม่</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={32} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.seniorActionButton, styles.seniorContactButton]}
                onPress={() => void callPrimaryContact()}
                accessibilityRole="button"
                accessibilityLabel={emergencyContact ? `โทรหา ${emergencyContact.name}` : 'เพิ่มผู้ติดต่อฉุกเฉิน'}
              >
                <View style={styles.seniorActionIcon}>
                  <MaterialCommunityIcons name="phone-in-talk-outline" size={34} color="#ffffff" />
                </View>
                <View style={styles.seniorActionText}>
                  <Text style={styles.seniorActionTitle}>{emergencyContact ? `โทรหา ${emergencyContact.name}` : 'ตั้งค่าเบอร์ผู้ดูแล'}</Text>
                  <Text style={styles.seniorActionSubtitle}>{emergencyContact ? emergencyContact.phone : 'เพิ่มเบอร์ญาติหรือผู้ดูแลหลัก'}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={32} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.seniorActionButton, styles.seniorEmergencyButton]}
                onPress={triggerEmergencySOS}
                accessibilityRole="button"
                accessibilityLabel="ขอความช่วยเหลือฉุกเฉิน"
              >
                <View style={styles.seniorActionIcon}>
                  <MaterialCommunityIcons name="alert-octagon" size={36} color="#ffffff" />
                </View>
                <View style={styles.seniorActionText}>
                  <Text style={styles.seniorActionTitle}>ขอความช่วยเหลือ</Text>
                  <Text style={styles.seniorActionSubtitle}>แจ้งผู้ดูแลทันทีเมื่อเกิดเหตุฉุกเฉิน</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={32} color="#ffffff" />
              </TouchableOpacity>
            </View>
          ) : (
            <>

          {/* =========================================================
              AI STATUS BANNER - Gradient-like card
             ========================================================= */}
          <View style={styles.aiBanner}>
            <View style={styles.aiBannerBg}>
              {/* Decorative circles */}
              <View style={[styles.decorCircle, { top: -20, right: -20, opacity: 0.08 }]} />
              <View style={[styles.decorCircle, { bottom: -30, left: -10, opacity: 0.05, width: 100, height: 100 }]} />

              <View style={styles.aiBannerContent}>
                <View style={styles.aiBannerLeft}>
                  <View style={styles.aiIconCircle}>
                    <MaterialCommunityIcons name="shield-check" size={28} color="#ffffff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aiBannerTitle}>{homeWorkerMode ? monitorSummary.title : backgroundMonitoringActive ? 'AI กำลังเฝ้าระวังเบื้องหลัง' : monitoringCount > 0 ? 'กำลังเปิดการเฝ้าระวัง' : 'ยังไม่ได้เปิดการตรวจภาพด้วย AI'}</Text>
                    <Text style={styles.aiBannerSubtitle}>
                      {homeWorkerMode ? monitorSummary.subtitle : backgroundMonitoringError || (monitoringCount > 0
                        ? `กล้อง ${monitoringCount} ตัว · ${allPeopleMode ? 'ตรวจทุกคนในภาพ' : `ดูแลบุคคลเป้าหมาย ${trackedCount} คน`}`
                        : 'ยังไม่มีกล้องที่พร้อมให้ AI ตรวจภาพ')}
                    </Text>
                  </View>
                </View>
                <View style={styles.aiStatusIndicator}>
                  {(homeWorkerMode ? monitorSummary.online : monitoringCount > 0) && <Animated.View style={[styles.aiPulse, { transform: [{ scale: pulseAnim }] }]} />}
                  <View style={[styles.aiDotActive, !(homeWorkerMode ? monitorSummary.online : monitoringCount > 0) && { backgroundColor: '#cbd5e1' }]} />
                </View>
              </View>

              {/* Quick action chips */}
              <View style={styles.chipRow}>
                <View style={styles.chip}>
                  <MaterialCommunityIcons name="cctv" size={14} color="#059669" />
                  <Text style={styles.chipText}>กล้อง {cameras.length} ตัว</Text>
                </View>
                <View style={styles.chip}>
                  <MaterialCommunityIcons name="wifi" size={14} color="#059669" />
                  <Text style={styles.chipText}>{homeWorkerMode ? monitorSummary.online ? 'คอมออนไลน์' : 'คอมยังไม่พร้อม' : 'ตรวจสอบสถานะบนภาพ'}</Text>
                </View>
                <View style={[styles.chip, monitoringCount > 0 && styles.chipActive]}>
                  <MaterialCommunityIcons name="brain" size={14} color={monitoringCount > 0 ? '#ffffff' : '#059669'} />
                  <Text style={[styles.chipText, monitoringCount > 0 && { color: '#ffffff' }]}>{homeWorkerMode ? monitorSummary.online ? 'AI กำลังตรวจภาพ' : 'AI ยังไม่พร้อม' : monitoringCount > 0 ? 'ดูผล AI บนภาพ' : 'AI ยังไม่พร้อม'}</Text>
                </View>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.readinessButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={() => router.push('/setup-guide')}
            accessibilityRole="button"
            accessibilityLabel="ตรวจสอบความพร้อมของระบบทั้งหมด"
          >
            <View style={styles.readinessButtonIcon}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={23} color="#ffffff" />
            </View>
            <View style={styles.readinessButtonText}>
              <Text style={[styles.readinessButtonTitle, { color: colors.textPrimary }]}>ตรวจสอบความพร้อมของระบบ</Text>
              <Text style={[styles.readinessButtonSubtitle, { color: colors.textSecondary }]}>เช็กบัญชี คนที่ดูแล กล้อง คอม และการแจ้งเตือนในหน้าเดียว</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          {/* =========================================================
              3-STEP USER-FRIENDLY QUICK GUIDE CARD
             ========================================================= */}
          <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 17, marginBottom: 23, borderWidth: 1, borderColor: colors.cardBorder }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <MaterialCommunityIcons name="compass-outline" size={21} color={colors.accentText} />
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.textPrimary }}>เริ่มดูแลใน 3 ขั้นตอน</Text>
            </View>

            <View style={{ gap: 10 }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isDarkMode ? '#1e293b' : '#f3f8f5', padding: 13, borderRadius: 13 }} onPress={() => router.push('/members')}>
                <View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: '#168765', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textPrimary }}>เลือกบุคคลเป้าหมาย (ถ้าต้องการ)</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>ไม่เลือกใคร AI จะตรวจทุกคนในภาพ</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isDarkMode ? '#1e293b' : '#f3f8f5', padding: 13, borderRadius: 13 }} onPress={() => setShowAddCameraModal(true)}>
                <View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: '#168765', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textPrimary }}>เพิ่มกล้องที่ต้องการเฝ้าดู</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>เลือกชื่อเมื่อใช้โหมดบุคคลเป้าหมาย</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isDarkMode ? '#1e293b' : '#f3f8f5', padding: 13, borderRadius: 13 }} onPress={() => router.push('/profile')}>
                <View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: '#168765', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>3</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textPrimary }}>เปิดรับแจ้งเตือน</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>ผู้ดูแลเปิดในมือถือของตนเอง</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* =========================================================
              CAMERA SECTION - Premium dark card
             ========================================================= */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <MaterialCommunityIcons name="cctv" size={18} color="#059669" />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>กล้องวงจรปิด</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <TouchableOpacity onPress={() => setShowAddCameraModal(true)}>
                <Text style={styles.sectionAction}>+ เพิ่มกล้อง</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/all-cameras')}>
                <Text style={[styles.sectionAction, { color: '#64748b' }]}>ดูทั้งหมด</Text>
              </TouchableOpacity>
            </View>
          </View>

          {cameras.length === 0 && (
            <View style={{ padding: 21, marginBottom: 18, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center', marginBottom: 11 }}>
                <MaterialCommunityIcons name="cctv" size={26} color={colors.accentText} />
              </View>
              <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '800' }}>ยังไม่มีกล้องในบ้าน</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', fontSize: 12, marginTop: 5, marginBottom: 15 }}>เชื่อมเว็บแคมหรือ CCTV แล้วเลือกผู้สูงอายุที่กล้องนี้ดูแล</Text>
              <TouchableOpacity onPress={() => setShowAddCameraModal(true)} style={{ backgroundColor: '#168765', borderRadius: 11, paddingHorizontal: 19, paddingVertical: 10 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>เพิ่มกล้อง</Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {cameras.map(cam => {
              const isCamAlerting = activeAlertCamId === cam.id;
              return (
                <View
                  key={cam.id}
                  style={[
                    styles.cameraCard,
                    { width: SCREEN_WIDTH - 40, marginRight: 16, marginBottom: 0 },
                    isCamAlerting && { borderWidth: 3, borderColor: '#ef4444' }
                  ]}
                >
                  <View style={styles.cameraView}>
                    {isFocused && !fullscreenCam && (cam.type !== 'device' || cameras.find((item) => item.type === 'device')?.id === cam.id) ? (
                      <MonitoredCameraFeed
                        camera={cam}
                        style={styles.videoPlayer}
                        monitoring={shouldMonitorCamera(cam, trackedMemberIds)}
                        analysisEnabled={Platform.OS !== 'android'}
                        onFallDetected={(imageUri, analysis) => {
                          if (pendingAlertRef.current) return;
                          setActiveAlertCamId(cam.id);
                          const targetName = allPeopleMode ? undefined : cam.assigned_member_name;
                          void addEvent(cam.name, describeCameraAttribution(targetName, analysis), imageUri);
                        }}
                      />
                    ) : (
                      <View style={styles.videoPlayer} />
                    )}

                    <View style={styles.liveBadge}>
                      <Animated.View style={[styles.liveDot, { opacity: glowAnim }]} />
                      <Text style={styles.liveText}>กล้อง</Text>
                    </View>

                    <View style={styles.roomLabel}>
                      <MaterialCommunityIcons name={cam.type === 'device' ? "cellphone" : "cctv"} size={14} color="#ffffff" />
                      <Text style={styles.roomLabelText}>{cam.name}</Text>
                    </View>

                    {/* Bottom Right: Fullscreen Expand Only */}
                    <View style={[styles.cameraOverlayControls, { right: 8, bottom: 8, top: undefined }]}>
                      <TouchableOpacity
                        style={styles.cameraControlBtn}
                        onPress={() => setFullscreenCam(cam)}
                      >
                        <MaterialCommunityIcons name="fullscreen" size={18} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Camera Info Footer - Clean & Sleek */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialCommunityIcons name={cam.type === 'device' ? "cellphone" : "cctv"} size={14} color="#059669" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textPrimary }}>{cam.name}</Text>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {(allPeopleMode || cam.assigned_member_name) && (
                        <View style={{ backgroundColor: colors.accentBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCommunityIcons name="account-heart" size={12} color={colors.accentText} />
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.accentText }}>
                            {allPeopleMode ? 'ตรวจทุกคนในภาพ' : `พื้นที่ของ ${cam.assigned_member_name}`}
                          </Text>
                        </View>
                      )}
                      <View style={{ backgroundColor: cam.type === 'device' ? '#fef3c7' : '#f1f5f9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: cam.type === 'device' ? '#92400e' : '#64748b' }}>
                          {cam.type === 'device' ? 'มือถือ' : 'CCTV'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => confirmDeleteCamera(cam.id, cam.name)}
                        style={{ padding: 4 }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={15} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* =========================================================
              FAMILY MEMBERS - Modern list card
             ========================================================= */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <MaterialCommunityIcons name="account-group" size={18} color="#059669" />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>ผู้รับการดูแล</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/members')} style={styles.manageBtn}>
              <Text style={styles.manageBtnText}>จัดการ</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color="#059669" />
            </TouchableOpacity>
          </View>

          <View style={[styles.membersCard, { backgroundColor: colors.card }]}>
            {loadingMembers ? (
              <ActivityIndicator color="#059669" style={{ marginVertical: 24 }} />
            ) : careRecipients.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-plus-outline" size={40} color="#cbd5e1" />
                <Text style={styles.emptyText}>ยังไม่มีผู้รับการดูแล</Text>
                <TouchableOpacity style={styles.addMemberBtn} onPress={() => router.push('/members')}>
                  <Text style={styles.addMemberText}>+ เพิ่มผู้รับการดูแล</Text>
                </TouchableOpacity>
              </View>
            ) : (
              careRecipients.map((member, index) => (
                <View key={member.id} style={[styles.memberItem, { borderBottomColor: colors.separator }, index === careRecipients.length - 1 && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
                  <View style={[styles.memberAvatar, member.is_tracked && styles.memberAvatarActive]}>
                    {member.avatar_url ? (
                      <Image source={{ uri: member.avatar_url }} style={styles.memberAvatarImg} />
                    ) : (
                      <MaterialCommunityIcons name="account" size={22} color={member.is_tracked ? '#059669' : '#94a3b8'} />
                    )}
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={[styles.memberName, { color: colors.textPrimary }]}>{member.display_name}</Text>
                    <View style={styles.memberRoleRow}>
                      <View style={[styles.roleBadge, member.is_tracked && styles.roleBadgeActive]}>
                        <Text style={[styles.roleBadgeText, member.is_tracked && styles.roleBadgeTextActive]}>{member.role}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.trackingToggle}>
                    <Text style={[styles.trackingLabel, member.is_tracked && styles.trackingLabelActive]}>
                      {member.is_tracked ? 'กำลังดูแล' : 'ปิดอยู่'}
                    </Text>
                    <Switch
                      value={member.is_tracked || false}
                      onValueChange={() => toggleTracking(member.id, member.is_tracked)}
                      trackColor={{ false: '#e2e8f0', true: '#86efac' }}
                      thumbColor={member.is_tracked ? '#059669' : '#cbd5e1'}
                      style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                    />
                  </View>
                </View>
              ))
            )}
          </View>

          {/* =========================================================
              RECENT EVENTS - Timeline
             ========================================================= */}
          {events.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <MaterialCommunityIcons name="clock-outline" size={18} color="#059669" />
                  <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>เหตุการณ์ล่าสุด</Text>
                </View>
                <TouchableOpacity onPress={clearEvents}>
                  <Text style={styles.sectionAction}>ล้าง</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.eventsCard, { backgroundColor: colors.card }]}>
                {events.map((event, index) => (
                  <View key={event.id} style={[styles.eventItem, { borderBottomColor: colors.separator }, index === events.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={[styles.eventDot, event.isAlert ? styles.eventDotAlert : styles.eventDotNormal]} />
                    <View style={styles.eventContent}>
                      <View style={styles.eventTopRow}>
                        <Text style={[styles.eventTitle, { color: colors.textPrimary }]}>{event.title}</Text>
                        <Text style={styles.eventTime}>{event.time}</Text>
                      </View>
                      <Text style={[styles.eventSubtitle, { color: colors.textSecondary }]}>{event.subtitle}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
            </>
          )}

          {/* =========================================================
              SOS BUTTON - Premium emergency button
             ========================================================= */}
          {/* =========================================================
              SOS BUTTON - Premium emergency button
             ========================================================= */}
          {!seniorMode ? <TouchableOpacity style={styles.sosButton} activeOpacity={0.8} onPress={triggerEmergencySOS}>
            <View style={styles.sosInner}>
              <View style={styles.sosIconContainer}>
                <MaterialCommunityIcons name="alert-octagon" size={28} color="#ffffff" />
              </View>
              <View style={styles.sosTextContent}>
                <Text style={styles.sosTitle}>🚨 กดปุ่มฉุกเฉิน SOS</Text>
                <Text style={styles.sosSubtitle}>ส่งสัญญาณเตือนภัย + โทรด่วน {emergencyPhoneLabel}</Text>
              </View>
              <View style={styles.sosBadge}>
                <Text style={styles.sosBadgeText}>SOS</Text>
              </View>
            </View>
          </TouchableOpacity> : null}

          <View style={{ height: 20 }} />
        </ScrollView>
      </View>

      {/* Add Camera Modal */}
      <Modal
        visible={showAddCameraModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddCameraModal(false)}
      >
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.top}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>เพิ่มกล้องวงจรปิด</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowAddCameraModal(false)}
                accessibilityRole="button"
                accessibilityLabel="ปิดหน้าต่างเพิ่มกล้อง"
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalForm}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>ชื่อกล้อง / จุดติดตั้ง</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.textPrimary }]}
              placeholder="เช่น ห้องนั่งเล่น, หน้าบ้าน"
              placeholderTextColor={colors.textMuted}
              value={newCamName}
              onChangeText={setNewCamName}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>พื้นที่นี้ดูแลใคร {trackedCount > 0 && <Text style={{ color: '#dc2626' }}>*</Text>}</Text>
            {allPeopleMode && (
              <View style={{ backgroundColor: colors.accentBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: colors.accentText, fontSize: 13, fontWeight: '800' }}>โหมดตรวจทุกคนเปิดอยู่</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 3 }}>
                  ไม่จำเป็นต้องเลือกชื่อ ระบบจะตรวจการล้มของทุกคนที่เห็นในภาพ
                </Text>
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {careRecipients.map((m) => {
                const isSel = assignedMemberId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.typeBtn, isSel && styles.typeBtnActive, { marginRight: 8 }]}
                    onPress={() => setAssignedMemberId(isSel ? '' : m.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSel }}
                    accessibilityLabel={`เลือกพื้นที่ดูแลของ ${m.display_name}`}
                  >
                    <MaterialCommunityIcons name="account-heart" size={16} color={isSel ? '#059669' : '#64748b'} />
                    <Text style={[styles.typeBtnText, isSel && styles.typeBtnTextActive]}>{m.display_name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: -5, marginBottom: 13 }}>
              {allPeopleMode
                ? 'เมื่อเปิดเลือกดูแลบุคคลใด ระบบจะเปลี่ยนไปตรวจเฉพาะบุคคลเป้าหมายโดยอัตโนมัติ'
                : 'ระบบติดตามคนต่อเนื่องแม้หันหลัง แต่จะแจ้งว่าเป็น “พื้นที่ของ...” เพื่อไม่เดาชื่อเมื่อมีหลายคนหรือภาพไม่ชัด'}
            </Text>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>ประเภทกล้อง</Text>
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeBtn, newCamType === 'rtsp' && styles.typeBtnActive]}
                onPress={() => {
                  setNewCamType('rtsp');
                  setCameraTest({ state: 'idle', message: '' });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: newCamType === 'rtsp' }}
                accessibilityLabel="เลือกกล้อง CCTV หรือเว็บแคม"
              >
                <MaterialCommunityIcons name="ip-network-outline" size={18} color={newCamType === 'rtsp' ? '#059669' : '#64748b'} />
                <Text style={[styles.typeBtnText, newCamType === 'rtsp' && styles.typeBtnTextActive]}>CCTV / เว็บแคม</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, newCamType === 'video' && styles.typeBtnActive]}
                onPress={() => {
                  setNewCamType('video');
                  setCameraTest({ state: 'idle', message: '' });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: newCamType === 'video' }}
                accessibilityLabel="เลือกวิดีโอ MP4"
              >
                <MaterialCommunityIcons name="cctv" size={18} color={newCamType === 'video' ? '#059669' : '#64748b'} />
                <Text style={[styles.typeBtnText, newCamType === 'video' && styles.typeBtnTextActive]}>Video MP4</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, newCamType === 'device' && styles.typeBtnActive]}
                onPress={() => {
                  setNewCamType('device');
                  setCameraTest({ state: 'idle', message: '' });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: newCamType === 'device' }}
                accessibilityLabel="เลือกกล้องมือถือเครื่องนี้"
              >
                <MaterialCommunityIcons name="webcam" size={18} color={newCamType === 'device' ? '#059669' : '#64748b'} />
                <Text style={[styles.typeBtnText, newCamType === 'device' && styles.typeBtnTextActive]}>กล้องมือถือเครื่องนี้</Text>
              </TouchableOpacity>
            </View>

            {newCamType === 'rtsp' && (
              <>
                <Text style={styles.inputLabel}>ลิงก์กล้อง</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://camera-gateway.example/live.m3u8"
                  value={newCamUrl}
                  onChangeText={(value) => {
                    setNewCamUrl(value);
                    setCameraTest({ state: 'idle', message: '' });
                  }}
                  autoCapitalize="none"
                />
                <Text style={{ fontSize: 10, color: '#64748b', marginTop: -6, marginBottom: 12 }}>
                  ใส่ HLS (.m3u8) หรือ MJPEG เพียงช่องเดียว ระบบจะดึงภาพให้ AI อัตโนมัติ
                </Text>
                <TouchableOpacity
                  style={styles.advancedCameraButton}
                  onPress={() => setShowAdvancedCamera((current) => !current)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAdvancedCamera }}
                >
                  <MaterialCommunityIcons name="tune-variant" size={18} color="#475569" />
                  <Text style={styles.advancedCameraButtonText}>ตัวเลือกเพิ่มเติม</Text>
                  <MaterialCommunityIcons name={showAdvancedCamera ? 'chevron-up' : 'chevron-down'} size={20} color="#64748b" />
                </TouchableOpacity>
              </>
            )}

            {newCamType === 'video' && (
              <>
                <Text style={styles.inputLabel}>ลิงก์วิดีโอ MP4 (URL)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://commondatastorage.googleapis.com/.../sample.mp4"
                  value={newCamUrl}
                  onChangeText={(value) => {
                    setNewCamUrl(value);
                    setCameraTest({ state: 'idle', message: '' });
                  }}
                  autoCapitalize="none"
                />
              </>
            )}

            {newCamType !== 'device' && (
              <>
                {(newCamType === 'video' || showAdvancedCamera) ? (
                  <>
                    <Text style={styles.inputLabel}>
                      ลิงก์ภาพนิ่ง JPEG/PNG {newCamType === 'video' ? 'สำหรับ AI' : '(ถ้ามี)'}
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="https://camera-gateway.example/snapshot.jpg"
                      value={newSnapshotUrl}
                      onChangeText={(value) => {
                        setNewSnapshotUrl(value);
                        setCameraTest({ state: 'idle', message: '' });
                      }}
                      autoCapitalize="none"
                    />
                    <Text style={{ fontSize: 10, color: '#64748b', marginTop: -6, marginBottom: 12 }}>
                      ถ้ามีลิงก์ภาพนิ่ง ระบบจะเลือกใช้ก่อนเพื่อประหยัดแรงคอม
                    </Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={[styles.cameraTestButton, cameraTest.state === 'testing' && { opacity: 0.65 }]}
                  onPress={() => void handleTestCamera()}
                  disabled={cameraTest.state === 'testing'}
                  accessibilityRole="button"
                  accessibilityLabel="ทดสอบการเชื่อมต่อกล้อง"
                >
                  {cameraTest.state === 'testing'
                    ? <ActivityIndicator size="small" color="#065f46" />
                    : <MaterialCommunityIcons name="camera-outline" size={20} color="#065f46" />}
                  <Text style={styles.cameraTestButtonText}>
                    {cameraTest.state === 'testing' ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
                  </Text>
                </TouchableOpacity>
                {cameraTest.message ? (
                  <View style={[styles.cameraTestResult, cameraTest.state === 'success' ? styles.cameraTestSuccess : styles.cameraTestError]}>
                    <MaterialCommunityIcons
                      name={cameraTest.state === 'success' ? 'check-circle' : 'alert-circle-outline'}
                      size={18}
                      color={cameraTest.state === 'success' ? '#15803d' : '#b91c1c'}
                    />
                    <Text style={[styles.cameraTestResultText, { color: cameraTest.state === 'success' ? '#166534' : '#991b1b' }]}>{cameraTest.message}</Text>
                  </View>
                ) : null}
                {cameraTest.state === 'success' && newSnapshotUrl.trim() ? (
                  <View style={styles.cameraPreviewCard}>
                    <Image
                      source={{ uri: newSnapshotUrl }}
                      style={styles.cameraPreviewImage}
                      contentFit="cover"
                      cachePolicy="none"
                    />
                    <Text style={styles.cameraPreviewLabel}>ภาพล่าสุดที่ AI จะได้รับ</Text>
                  </View>
                ) : null}
              </>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, savingCamera && styles.saveBtnDisabled]}
              onPress={handleAddCamera}
              disabled={savingCamera}
              accessibilityRole="button"
              accessibilityLabel="บันทึกกล้อง"
              accessibilityState={{ disabled: savingCamera }}
            >
              {savingCamera ? <ActivityIndicator color="#ffffff" /> : null}
              <Text style={styles.saveBtnText}>{savingCamera ? 'กำลังบันทึก...' : 'บันทึกกล้อง'}</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Emergency SOS 1669 Modal */}
      <Modal visible={showSOSModal} animationType="fade" transparent onRequestClose={() => setShowSOSModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: '#0f172a', borderColor: '#ef4444', borderWidth: 2 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="alert-decagram" size={26} color="#ef4444" />
                <Text style={[styles.modalTitle, { color: '#ffffff', fontSize: 18 }]}>🚨 แจ้งเตือนฉุกเฉิน SOS</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSOSModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={{ color: '#cbd5e1', fontSize: 13, marginVertical: 12, lineHeight: 18 }}>
              ส่งสัญญาณขอความช่วยเหลือแล้ว! เลือกช่องทางติดต่อเพื่อรับความช่วยเหลือด่วน:
            </Text>

            {/* 1669 Medical Emergency Call */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#dc2626',
                padding: 14,
                borderRadius: 12,
                marginBottom: 10,
                gap: 12,
              }}
              onPress={() => { void callEmergencyService(); }}
            >
              <MaterialCommunityIcons name="phone-in-talk" size={26} color="#ffffff" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '900' }}>โทร {emergencyPhoneLabel} (การแพทย์ฉุกเฉิน)</Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>สายด่วนกู้ชีพ ฟรี 24 ชั่วโมง</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#ffffff" />
            </TouchableOpacity>

            {/* Caregiver Phone Call */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#059669',
                padding: 14,
                borderRadius: 12,
                marginBottom: 16,
                gap: 12,
              }}
              onPress={() => { void callPrimaryContact(); }}
            >
              <MaterialCommunityIcons name="account-heart" size={26} color="#ffffff" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '900' }}>
                  {emergencyContact ? `โทรหา ${emergencyContact.name}` : 'เพิ่มผู้ติดต่อฉุกเฉิน'}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>
                  {emergencyContact ? emergencyContact.phone : 'ตั้งค่าเบอร์ที่ต้องการโทรหาในหน้าโปรไฟล์'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#ffffff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
              onPress={() => setShowSOSModal(false)}
            >
              <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700' }}>ปิดหน้าต่างฉุกเฉิน</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 10-Second False Alarm Cancellation Countdown Modal */}
      <FalseAlarmCountdownModal
        visible={showFalseAlarmModal}
        personName={pendingFallInfo?.personName || 'ยังไม่ยืนยันตัวบุคคล'}
        locationName={pendingFallInfo?.camName || 'กล้องวงจรปิด'}
        onCancel={handleCancelFallAlert}
        onConfirm={handleConfirmFallAlert}
      />

      {/* Fullscreen YouTube-Style Camera Viewer */}
      <FullScreenCameraModal
        visible={!!fullscreenCam}
        camera={fullscreenCam}
        monitoring={Boolean(fullscreenCam && shouldMonitorCamera(fullscreenCam, trackedMemberIds))}
        onClose={() => setFullscreenCam(null)}
        onFallDetected={(imageUri, analysis) => {
          if (!fullscreenCam || pendingAlertRef.current) return;
          setActiveAlertCamId(fullscreenCam.id);
          const targetName = allPeopleMode ? undefined : fullscreenCam.assigned_member_name;
          handleInitiateFallAlert(fullscreenCam.name, describeCameraAttribution(targetName, analysis), imageUri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f0fdf4',
  },
  safeArea: {
    flex: 1,
  },
  seniorAppName: {
    fontSize: 22,
    lineHeight: 28,
  },
  seniorFamilyName: {
    fontSize: 15,
    lineHeight: 21,
  },
  seniorDashboard: {
    gap: 16,
    paddingBottom: 20,
  },
  seniorWelcomeCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  seniorWelcomeTitle: {
    fontSize: 23,
    lineHeight: 31,
    fontWeight: '900',
    textAlign: 'center',
  },
  seniorStatusPill: {
    width: '100%',
    minHeight: 60,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#fef3c7',
  },
  seniorStatusPillReady: {
    backgroundColor: '#dcfce7',
  },
  seniorStatusText: {
    color: '#0f172a',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
  },
  seniorInstruction: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  seniorActionButton: {
    minHeight: 96,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  seniorStatusButton: {
    backgroundColor: '#047857',
  },
  seniorContactButton: {
    backgroundColor: '#1d4ed8',
  },
  seniorEmergencyButton: {
    backgroundColor: '#b91c1c',
  },
  seniorActionIcon: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seniorActionText: {
    flex: 1,
    gap: 4,
  },
  seniorActionTitle: {
    color: '#ffffff',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
  },
  seniorActionSubtitle: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  readinessButton: {
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  readinessButtonIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readinessButtonText: {
    flex: 1,
  },
  readinessButtonTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  readinessButtonSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  cameraTestButton: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#6ee7b7',
    backgroundColor: '#ecfdf5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  advancedCameraButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 14,
  },
  advancedCameraButtonText: {
    flex: 1,
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  cameraTestButtonText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '800',
  },
  cameraTestResult: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cameraTestSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  cameraTestError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cameraTestResultText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  cameraPreviewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    marginBottom: 12,
  },
  cameraPreviewImage: {
    width: '100%',
    height: 160,
    backgroundColor: '#d1fae5',
  },
  cameraPreviewLabel: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    position: 'relative',
    marginRight: 12,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  logoOnlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  appName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  familyName: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  notifBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 11,
  },

  scrollContent: {
    padding: 16,
    paddingBottom: 30,
  },

  // ── AI Banner ──
  aiBanner: {
    marginBottom: 20,
  },
  aiBannerBg: {
    backgroundColor: '#059669',
    borderRadius: 20,
    padding: 18,
    overflow: 'hidden',
  },
  decorCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ffffff',
  },
  aiBannerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  aiBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  aiIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  aiBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  aiBannerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
  },
  aiStatusIndicator: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
    height: 32,
  },
  aiPulse: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  aiDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#86efac',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  chipActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#064e3b',
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },

  // ── Camera ──
  cameraCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#0f172a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  cameraView: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
  },
  cameraDarkBg: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  cameraPlaceholderText: {
    color: '#475569',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '600',
  },
  liveBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  liveText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  hdBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  hdText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cameraOverlayControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  cameraControlBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  roomLabel: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
  },
  roomLabelText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Members ──
  membersCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 12,
  },
  addMemberBtn: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  addMemberText: {
    color: '#059669',
    fontWeight: '700',
    fontSize: 13,
  },
  addMemberNavTextActive: {
    color: '#059669',
    fontWeight: '700',
  },

  // ── Modal Styles ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 400,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCloseButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalForm: {
    paddingBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 16,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    gap: 8,
  },
  typeBtnActive: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#059669',
  },
  typeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  typeBtnTextActive: {
    color: '#059669',
  },
  saveBtn: {
    backgroundColor: '#059669',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  saveBtnDisabled: {
    opacity: 0.65,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  memberAvatar: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  memberAvatarActive: {
    borderColor: '#86efac',
    backgroundColor: '#ecfdf5',
  },
  memberAvatarImg: {
    width: 42,
    height: 42,
    borderRadius: 13,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  memberRoleRow: {
    flexDirection: 'row',
  },
  roleBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleBadgeActive: {
    backgroundColor: '#ecfdf5',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
  },
  roleBadgeTextActive: {
    color: '#059669',
  },
  trackingToggle: {
    alignItems: 'flex-end',
  },
  trackingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 2,
  },
  trackingLabelActive: {
    color: '#059669',
  },

  // ── Events ──
  eventsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  eventItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    marginRight: 12,
  },
  eventDotAlert: {
    backgroundColor: '#22c55e',
  },
  eventDotNormal: {
    backgroundColor: '#cbd5e1',
  },
  eventContent: {
    flex: 1,
  },
  eventTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  eventTime: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    marginLeft: 8,
  },
  eventSubtitle: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },

  // ── SOS Button ──
  sosButton: {
    marginTop: 4,
  },
  sosInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#fecaca',
  },
  sosIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sosTextContent: {
    flex: 1,
  },
  sosTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 2,
  },
  sosSubtitle: {
    fontSize: 11,
    color: '#b91c1c',
  },
  sosBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  sosBadgeText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
});
