import { CareText as Text } from '../../components/CareText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  useWindowDimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlert as Alert } from '../../lib/appAlert';
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
import { describeCameraAttribution } from '../../lib/cameraAnalysis';
import { supabase } from '../../lib/supabase';
import { describeMonitorHealth, loadMonitorHealth } from '../../lib/monitorHealth';
import { getFriendlyErrorMessage } from '../../lib/friendlyError';
import { testCameraConnection } from '../../lib/cameraConnectionTest';
import { callPhoneNumber, getEmergencyPhoneNumber } from '../../lib/phone';
import { getNativeCameraCapabilities, hasNativeCameraMonitoring, requestCameraMonitoringRefresh, useCameraMonitoringStates } from '../../lib/cameraMonitoring';
import { getCameraTargetMemberIds, getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from '../../lib/monitoringPolicy';
import { describeLiveMonitoring } from '../../lib/monitoringStatus';
import { MonitoringStatusCard } from '../../components/MonitoringStatusCard';
import { CameraSourceFields } from '../../components/CameraSourceFields';
import { SetupReturnButton } from '../../components/SetupReturnButton';
import { useMonitoringClock } from '../../lib/useMonitoringClock';
import readability from '../../config/readability.json';


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
  const { width: screenWidth } = useWindowDimensions();
  const { openCameraSetup, setup } = useLocalSearchParams<{ openCameraSetup?: string; setup?: string }>();
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
  const nativeCameraStates = useCameraMonitoringStates();
  const statusTime = useMonitoringClock();
  const [fullscreenCam, setFullscreenCam] = useState<CameraItem | null>(null);
  const [activeAlertCamId, setActiveAlertCamId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [newCamName, setNewCamName] = useState('');
  const [newCamType, setNewCamType] = useState<'video' | 'device' | 'rtsp'>('rtsp');
  const [newCamUrl, setNewCamUrl] = useState('');
  const [newSnapshotUrl, setNewSnapshotUrl] = useState('');
  const [showCameraPeople, setShowCameraPeople] = useState(false);
  const [assignedMemberId, setAssignedMemberId] = useState<string>('');
  const [cameraTest, setCameraTest] = useState<{ state: 'idle' | 'testing' | 'success' | 'error'; message: string; source?: string }>({ state: 'idle', message: '' });
  const [savingCamera, setSavingCamera] = useState(false);
  const savingCameraRef = useRef(false);
  const [showFalseAlarmModal, setShowFalseAlarmModal] = useState(false);
  const [pendingFallInfo, setPendingFallInfo] = useState<{ camName?: string; personName?: string; imageUri?: string } | null>(null);
  const pendingAlertRef = useRef(false);

  const [events, setEvents] = useState<{ id: number; time: string; title: string; subtitle: string; isAlert: boolean }[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [scopeUnavailable, setScopeUnavailable] = useState(false);
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
    if (savingCameraRef.current) return;
    if (loadingMembers || scopeUnavailable) {
      Alert.error('ยังเพิ่มกล้องไม่ได้', 'กรุณาตรวจว่ามีครอบครัวและโหลดรายชื่อคนที่เฝ้าดูสำเร็จก่อน');
      return;
    }
    const assignedMember = careRecipients.find((member) => member.id === assignedMemberId);
    if (assignedMemberId && !assignedMember) {
      Alert.error('ไม่พบผู้รับการดูแล', 'กรุณาเพิ่มผู้รับการดูแลก่อนเพิ่มกล้อง');
      return;
    }
    if (trackedCount > 0 && assignedMember && !assignedMember.is_tracked) {
      Alert.error('ยังไม่ได้เลือกให้เฝ้าดู', `เปิด “เฝ้าดูคนนี้” ให้ ${assignedMember.display_name} ก่อน`);
      return;
    }
    if (newCamType === 'device' && cameras.some((camera) => camera.type === 'device')) {
      Alert.error('มีกล้องมือถือแล้ว', 'อุปกรณ์หนึ่งเครื่องเปิดกล้องได้ครั้งละหนึ่งตัว');
      return;
    }
    if (newCamType !== 'device') {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(newCamUrl.trim());
      } catch {
        Alert.error('URL ไม่ถูกต้อง', 'กรุณาระบุ URL ของสตรีมกล้อง');
        return;
      }
      if (newCamType === 'video' && homeWorkerMode && !newSnapshotUrl.trim()) {
        Alert.error('ยังไม่มีภาพสำหรับ AI', 'วิดีโอทดสอบต้องมีลิงก์ภาพนิ่งสำหรับ AI');
        return;
      }
      if (cameraTest.state !== 'success' || cameraTest.source !== newCamUrl.trim()) {
        Alert.error('กรุณาทดสอบกล้องก่อน', 'กด “ทดสอบการเชื่อมต่อ” และรอให้ขึ้นว่าพร้อมใช้งาน');
        return;
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        Alert.error('สตรีมยังไม่รองรับ', 'กรุณาแปลง RTSP/RTMP เป็น HLS ผ่านเกตเวย์ แล้วใส่ URL HTTP หรือ HTTPS');
        return;
      }
    }
    if (newSnapshotUrl.trim()) {
      try {
        const parsedSnapshot = new URL(newSnapshotUrl.trim());
        if (parsedSnapshot.protocol !== 'https:' && parsedSnapshot.protocol !== 'http:') throw new Error();
      } catch {
        Alert.error('URL ภาพนิ่งไม่ถูกต้อง', 'กรุณาใช้ URL HTTP หรือ HTTPS ที่ส่งภาพ JPEG/PNG');
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
    if (savingCameraRef.current) return;

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

    savingCameraRef.current = true;
    setSavingCamera(true);
    try {
      if (newCamType !== 'device' && hasNativeCameraMonitoring() && !homeWorkerMode) {
        const capability = await getNativeCameraCapabilities();
        if (cameras.filter((camera) => camera.type !== 'device').length >= capability.maxCameras) {
          throw new Error(`รุ่นนี้รองรับการตรวจพร้อมกัน ${capability.maxCameras} กล้อง กรุณาลบกล้องที่ไม่ได้ใช้ก่อน`);
        }
      }
      const familyId = await AsyncStorage.getItem('familyId');
      if (!familyId) throw new Error('กรุณาเข้าร่วมครอบครัวก่อนเพิ่มกล้อง');
      const { data, error } = await supabase
          .from('cameras')
          .insert({
            family_id: familyId,
            name: cameraName,
            type: newCamType,
            url: (newCamType === 'video' || newCamType === 'rtsp') ? newCamUrl : null,
            snapshot_url: newSnapshotUrl.trim() || null,
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
        snapshot_url: newSnapshotUrl.trim() || undefined,
        protocol,
        assigned_member_id: assignedMemberId || undefined,
        assigned_member_name: assignedMember?.display_name,
      };

      const updated = [...cameras, newCam];
      setCameras(updated);
      requestCameraMonitoringRefresh();
      try {
        await AsyncStorage.setItem('@family_cameras', JSON.stringify(updated));
      } catch (cacheError) {
        console.log('Camera cache notice:', cacheError);
      }
      setShowAddCameraModal(false);
      setNewCamName('');
      setNewCamUrl('');
      setNewSnapshotUrl('');
      setShowCameraPeople(false);
      setAssignedMemberId('');
      setCameraTest({ state: 'idle', message: '' });
      if (setup === 'true') router.navigate('/setup-guide');
    } catch (err) {
      Alert.error('เพิ่มกล้องไม่สำเร็จ', getFriendlyErrorMessage(err, 'ตรวจข้อมูลกล้องแล้วลองอีกครั้ง'));
    } finally {
      savingCameraRef.current = false;
      setSavingCamera(false);
    }
  };

  const handleTestCamera = async () => {
    const source = newCamUrl.trim();
    setCameraTest({ state: 'testing', message: 'กำลังรับภาพจากกล้อง...' });
    try {
      const result = await testCameraConnection(newCamUrl, newSnapshotUrl, Platform.OS === 'web');
      setCameraTest({ state: result.success ? 'success' : 'error', message: result.message, source });
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
      if (!familyId) { setMembers([]); setScopeUnavailable(true); return; }

      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('family_id', familyId)
        .order('created_at', { ascending: true });

      if (error || !data) throw error ?? new Error('ไม่มีข้อมูลครอบครัว');
      setMembers(data);
      setScopeUnavailable(false);
    } catch (e) {
      setMembers([]);
      setScopeUnavailable(true);
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

    // Glow animation for live indicator
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, [glowAnim]);

  const confirmDeleteCamera = (camId: string, camName: string) => {
    Alert.confirm(
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
              requestCameraMonitoringRefresh();
              await AsyncStorage.setItem('@family_cameras', JSON.stringify(updated));
            } catch (delErr) {
              Alert.error('ลบกล้องไม่สำเร็จ', getFriendlyErrorMessage(delErr));
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
      if (!opened) Alert.error('โทรออกไม่ได้', 'อุปกรณ์นี้ไม่รองรับการโทร กรุณาใช้โทรศัพท์โทรหาเบอร์ฉุกเฉิน');
    } catch (error) {
      Alert.error('โทรออกไม่ได้', getFriendlyErrorMessage(error));
    }
  };

  const callPrimaryContact = async () => {
    if (!emergencyContact) {
      setShowSOSModal(false);
      router.push({ pathname: '/profile', params: { section: 'contacts', action: 'add' } });
      return;
    }
    const opened = await callPhoneNumber(emergencyContact.phone);
    if (!opened) Alert.error('โทรออกไม่ได้', 'กรุณาตรวจเบอร์ผู้ติดต่อฉุกเฉินในหน้าโปรไฟล์');
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
    try {
      const record = await recordFallEvent({ memberName: currentActivePerson, cameraName: 'ปุ่ม SOS', eventType: 'sos', details: 'ผู้ใช้กดปุ่มขอความช่วยเหลือ' });
      if (!record.savedLocally && !record.cloudSynced) throw new Error();
    } catch { Alert.error('บันทึก SOS ในประวัติไม่สำเร็จ', 'ตรวจพื้นที่ว่างและการเชื่อมต่อของมือถือ'); }
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
  const onlyTracked = trackedMemberIds.size === 1 ? careRecipients.find(member => trackedMemberIds.has(member.id)) : undefined;
  const allPeopleMode = usesAllPeopleMode(trackedMemberIds);
  const liveSummary = describeLiveMonitoring({ cameras, states: nativeCameraStates, targetIds: trackedMemberIds,
    singleTarget: onlyTracked && { id: onlyTracked.id, name: onlyTracked.display_name }, scopeUnavailable,
    nativeMode: hasNativeCameraMonitoring() && !homeWorkerMode, workerOnline: monitorSummary.online,
    loading: loadingCameras || loadingMembers, now: statusTime });


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
            </View>
            <View style={styles.brandText}>
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
            <TouchableOpacity style={styles.profileBtn} onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="เปิดโปรไฟล์และการตั้งค่า">
              {userProfile?.avatar_url ? (
                <Image source={{ uri: userProfile.avatar_url }} style={styles.profileAvatar} />
              ) : (
                <MaterialCommunityIcons name="account" size={22} color="#059669" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
          {setup === 'true' && <SetupReturnButton />}

          {seniorMode ? (
            <View style={styles.seniorDashboard}>
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
              </TouchableOpacity>

              <MonitoringStatusCard summary={liveSummary} onSettings={() => router.push('/setup-guide')} />

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
              </TouchableOpacity>
            </View>
          ) : (
            <>

          {/* =========================================================
              AI STATUS BANNER - Gradient-like card
             ========================================================= */}
          <MonitoringStatusCard summary={liveSummary} onSettings={() => router.push('/setup-guide')} />

          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <MaterialCommunityIcons name="cctv" size={18} color="#059669" />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>กล้องของฉัน</Text>
            </View>
            <View style={styles.sectionActions}>
              <TouchableOpacity style={styles.sectionActionButton} onPress={() => setShowAddCameraModal(true)} accessibilityRole="button" accessibilityLabel="เพิ่มกล้อง">
                <Text style={styles.sectionAction}>+ เพิ่มกล้อง</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sectionActionButton} onPress={() => router.push('/all-cameras')} accessibilityRole="button" accessibilityLabel="ดูกล้องทั้งหมด">
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
              <Text style={{ color: colors.textSecondary, textAlign: 'center', fontSize: 12, marginTop: 5, marginBottom: 15 }}>เริ่มด้วยลิงก์ภาพสดจากกล้อง เลือกตรวจทุกคนหรือเฉพาะคนได้ในหน้าคนที่ดูแล</Text>
              <TouchableOpacity onPress={() => setShowAddCameraModal(true)} style={{ backgroundColor: '#168765', borderRadius: 11, minHeight: readability.touchTargetSize, justifyContent: 'center', paddingHorizontal: 19, paddingVertical: 10 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>เพิ่มกล้อง</Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {cameras.map(cam => {
              const isCamAlerting = activeAlertCamId === cam.id;
              const cameraTargets = getCameraTargetMemberIds(cam, trackedMemberIds);
              const onlyPerson = cameraTargets.length === 1 ? careRecipients.find(person => person.id === cameraTargets[0]) : undefined;
              const scopeLabel = loadingMembers || scopeUnavailable ? 'ยังตรวจรายชื่อไม่ได้' : allPeopleMode ? 'ตรวจทุกคนในภาพ' : onlyPerson
                ? `เฝ้าดู: ${onlyPerson.display_name}` : `เฝ้าดูคนที่เลือก ${cameraTargets.length} คน`;
              return (
                <View
                  key={cam.id}
                  style={[
                    styles.cameraCard,
                    { width: screenWidth - 40, marginRight: 16, marginBottom: 0 },
                    isCamAlerting && { borderWidth: 3, borderColor: '#ef4444' }
                  ]}
                >
                  <View style={styles.cameraView}>
                    {isFocused && !fullscreenCam && (cam.type !== 'device' || cameras.find((item) => item.type === 'device')?.id === cam.id) ? (
                      <MonitoredCameraFeed
                        camera={cam}
                        style={styles.videoPlayer}
                        monitoring={shouldMonitorCamera(cam, trackedMemberIds)}
                        analysisEnabled={Platform.OS !== 'android' || cam.type === 'device'}
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

                    {/* Bottom Right: Fullscreen Expand Only */}
                    <View style={[styles.cameraOverlayControls, { right: 8, bottom: 8, top: undefined }]}>
                      <TouchableOpacity
                        style={styles.cameraControlBtn}
                        onPress={() => setFullscreenCam(cam)}
                        accessibilityRole="button"
                        accessibilityLabel={`ขยายภาพกล้อง ${cam.name}`}
                      >
                        <MaterialCommunityIcons name="fullscreen" size={18} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Camera Info Footer - Clean & Sleek */}
                  <View style={[styles.cameraFooter, { backgroundColor: colors.card }]}>
                    <View style={styles.cameraFooterHeading}>
                      <MaterialCommunityIcons name={cam.type === 'device' ? 'cellphone' : 'cctv'} size={20} color={colors.accentText} />
                      <Text style={[styles.cameraName, { color: colors.textPrimary }]}>{cam.name}</Text>
                      <TouchableOpacity onPress={() => confirmDeleteCamera(cam.id, cam.name)} style={styles.cameraDelete}
                        accessibilityRole="button" accessibilityLabel={`ลบกล้อง ${cam.name}`}>
                        <MaterialCommunityIcons name="trash-can-outline" size={24} color={colors.dangerText} />
                      </TouchableOpacity>
                    </View>
                    <View style={[styles.cameraScope, { backgroundColor: colors.accentBg }]}>
                      <MaterialCommunityIcons name="account-heart-outline" size={20} color={colors.accentText} />
                      <Text style={[styles.cameraScopeLabel, { color: colors.accentText }]}>{scopeLabel}</Text>
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
                    <Text style={[styles.trackingLabel, { color: member.is_tracked ? colors.accentText : colors.textSecondary }]}>
                      {member.is_tracked ? 'เลือกเฝ้าดูไว้' : 'ไม่ได้เลือกเฉพาะคน'}
                    </Text>
                  </View>
                  <View style={styles.trackingToggle}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`จัดการการเฝ้าดู ${member.display_name}`}
                      style={{ minHeight: readability.touchTargetSize, padding: 8, justifyContent: 'center' }} onPress={() => router.push('/members')}>
                      <Text style={{ color: colors.accentText, fontWeight: '700' }}>ตั้งค่า</Text>
                    </TouchableOpacity>
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
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>เพิ่มกล้อง</Text>
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
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.textPrimary, fontSize: seniorMode ? readability.seniorMinimumFontSize : readability.bodyFontSize }]}
              accessibilityLabel="ชื่อกล้องหรือจุดติดตั้ง"
              placeholder="เช่น ห้องนั่งเล่น, หน้าบ้าน"
              placeholderTextColor={colors.textMuted}
              value={newCamName}
              onChangeText={setNewCamName}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>คนที่กล้องนี้เฝ้าดู</Text>
            {loadingMembers || scopeUnavailable ? <View>
              <Text style={{ color: colors.textSecondary }}>{loadingMembers ? 'กำลังตรวจรายชื่อ…' : 'ยังโหลดรายชื่อคนที่เฝ้าดูไม่ได้'}</Text>
              {!loadingMembers && <TouchableOpacity style={styles.sectionActionButton} accessibilityRole="button" onPress={() => void loadFamilyMembers()}>
                <Text style={{ color: colors.accentText }}>โหลดรายชื่ออีกครั้ง</Text>
              </TouchableOpacity>}
            </View> : <>
            {allPeopleMode && (
              <View style={{ backgroundColor: colors.accentBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: colors.accentText, fontSize: 13, fontWeight: '800' }}>โหมดตรวจทุกคนเปิดอยู่</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 3 }}>
                  ไม่จำเป็นต้องเลือกชื่อ ระบบจะตรวจการล้มของทุกคนที่เห็นในภาพ
                </Text>
              </View>
            )}
            {!allPeopleMode && <>
              <Text style={{ color: colors.textPrimary, marginBottom: 8 }}>{assignedMemberId
                ? `เฉพาะ ${careRecipients.find(member => member.id === assignedMemberId)?.display_name ?? 'คนที่เลือก'}`
                : `ทุกคนที่เปิดเฝ้าดูไว้ ${trackedCount} คน`}</Text>
              <TouchableOpacity onPress={() => setShowCameraPeople(value => !value)} style={styles.sectionActionButton}
                accessibilityRole="button" accessibilityState={{ expanded: showCameraPeople }}>
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>{showCameraPeople ? 'ย่อรายชื่อ' : 'เปลี่ยนคนสำหรับกล้องนี้'}</Text>
              </TouchableOpacity>
            </>}
            {showCameraPeople && !allPeopleMode && (
            <View style={styles.cameraPersonOptions}>
              {!allPeopleMode && <TouchableOpacity style={[styles.typeBtn, { backgroundColor: colors.inputBg, minHeight: readability.touchTargetSize }, !assignedMemberId && styles.typeBtnActive]}
                onPress={() => setAssignedMemberId('')} accessibilityRole="button" accessibilityState={{ selected: !assignedMemberId }}>
                <Text style={[styles.typeBtnText, { color: colors.textSecondary }, !assignedMemberId && styles.typeBtnTextActive]}>ทุกคนที่เปิดเฝ้าดูไว้</Text>
              </TouchableOpacity>}
              {!allPeopleMode && careRecipients.filter(m => m.is_tracked).map((m) => {
                const isSel = assignedMemberId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.typeBtn, { backgroundColor: colors.inputBg, minHeight: readability.touchTargetSize }, isSel && styles.typeBtnActive]}
                    onPress={() => setAssignedMemberId(isSel ? '' : m.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSel }}
                    accessibilityLabel={`ให้กล้องเฝ้าดูเฉพาะ ${m.display_name}`}
                  >
                    <MaterialCommunityIcons name="account-heart" size={16} color={isSel ? '#059669' : '#64748b'} />
                    <Text style={[styles.typeBtnText, { color: colors.textSecondary }, isSel && styles.typeBtnTextActive]}>เฉพาะ {m.display_name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            )}

            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: -5, marginBottom: 13 }}>
              {allPeopleMode ? 'ต้องการเฝ้าดูเฉพาะคน ให้เลือกคนและสแกนเต็มตัวในหน้า “คนที่ดูแล” ก่อน'
                : 'กล้องนี้จะเทียบใบหน้ากับคนที่เลือก และแจ้งเหตุเมื่อยืนยันได้ว่าเป็นคนนั้น ดูสถานะการยืนยันในหน้าหลัก'}
            </Text>

            </>}
            <CameraSourceFields onPickLocalVideo={() => { setShowAddCameraModal(false); router.push('/video-test'); }} type={newCamType} onTypeChange={type => {
              setNewCamType(type); setCameraTest({ state: 'idle', message: '' });
            }} url={newCamUrl} onUrlChange={value => {
              setNewCamUrl(value); setCameraTest({ state: 'idle', message: '' });
            }} snapshotUrl={newSnapshotUrl} onSnapshotChange={value => {
              setNewSnapshotUrl(value); setCameraTest({ state: 'idle', message: '' });
            }} homeWorkerMode={homeWorkerMode} test={cameraTest} onTest={() => void handleTestCamera()} saving={savingCamera} />

            <TouchableOpacity
              style={[styles.saveBtn, (savingCamera || cameraTest.state === 'testing') && styles.saveBtnDisabled]}
              onPress={handleAddCamera}
              disabled={savingCamera || cameraTest.state === 'testing'}
              accessibilityRole="button"
              accessibilityLabel="บันทึกกล้อง"
              accessibilityState={{ disabled: savingCamera || cameraTest.state === 'testing' }}
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
    fontSize: 17,
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
  seniorActionButton: {
    minHeight: 96,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  seniorContactButton: {
    backgroundColor: '#1d4ed8',
  },
  seniorEmergencyButton: {
    backgroundColor: '#b91c1c',
  },
  seniorActionIcon: {
    width: 40,
    height: 48,
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

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    position: 'relative',
    marginRight: 8,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  appName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  brandText: { flex: 1, minWidth: 0 },
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
    width: readability.touchTargetSize,
    height: readability.touchTargetSize,
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
    width: readability.touchTargetSize,
    height: readability.touchTargetSize,
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
    flexWrap: 'wrap',
    gap: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionTitleRow: {
    flexShrink: 1,
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

  sectionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  sectionActionButton: { minHeight: readability.touchTargetSize, paddingVertical: 10, justifyContent: 'center' },
  cameraFooter: { padding: 12, gap: 8 },
  cameraFooterHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cameraName: { flex: 1, fontWeight: '700' },
  cameraDelete: { minWidth: readability.touchTargetSize, minHeight: readability.touchTargetSize, alignItems: 'center', justifyContent: 'center' },
  cameraScope: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10 },
  cameraScopeLabel: { flex: 1, fontWeight: '700' },
  cameraPersonOptions: { gap: 8, marginBottom: 12 },

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
    width: readability.touchTargetSize,
    height: readability.touchTargetSize,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
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
    flex: 1,
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
  typeBtn: {
    alignSelf: 'stretch',
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
    flexShrink: 1,
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
