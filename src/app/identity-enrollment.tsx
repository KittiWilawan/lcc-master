import { CareText as Text } from '../components/CareText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hasNativeCameraMonitoring, supportsMonitoringIdentity, requestCameraMonitoringRefresh } from '../lib/cameraMonitoring';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
  confirmIdentityConsent, deleteIdentityReference, IDENTITY_POSES, IdentityPose,
  IdentityReference, listIdentityReferences, saveIdentityReference, saveIdentityReferenceSet, withdrawIdentityConsent,
} from '../lib/identityReferences';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { supabase } from '../lib/supabase';
import { prepareIdentityImage } from '../lib/identityImageProcessing';
import { AppAlert as Alert } from '../lib/appAlert';
import { FaceCaptureModal } from '../components/FaceCaptureModal';
import { FacePhotoError, supportsFaceInspection, validateFacePhoto } from '../lib/faceInspection';
import { supportsGuidedFaceScan, type FaceScanTarget } from '../lib/guidedFaceScan';
import { SetupReturnButton } from '../components/SetupReturnButton';
import readability from '../config/readability.json';
import identityConfig from '../../android/app/src/main/assets/monitoring/identity.json';

const emerald = '#168765';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function IdentityEnrollmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, seniorMode } = useTheme();
  const params = useLocalSearchParams<{ memberId?: string; memberName?: string; setup?: string }>();
  const memberId = firstParam(params.memberId);
  const memberName = firstParam(params.memberName) || 'ผู้รับการดูแล';
  const [familyId, setFamilyId] = useState('');
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [references, setReferences] = useState<IdentityReference[]>([]);
  const nativeIdentity = supportsMonitoringIdentity() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker';
  const requiredPoses = nativeIdentity ? IDENTITY_POSES.filter((pose) => pose.key !== 'full_body') : IDENTITY_POSES;
  const completedPoses = requiredPoses.filter((pose) => references.some((reference) => reference.pose === pose.key)).length;
  const [loading, setLoading] = useState(true);
  const [busyPose, setBusyPose] = useState<IdentityPose | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [capturePose, setCapturePose] = useState<IdentityPose | FaceScanTarget | null>(null);
  const [showBodyReference, setShowBodyReference] = useState(false);
  const [showFacePhotos, setShowFacePhotos] = useState(false);
  const guidedScan = supportsGuidedFaceScan();
  const referencesChanged = useRef(false);

  const referencesByPose = useMemo(() => new Map(
    references.map((reference) => [reference.pose, reference]),
  ), [references]);

  const load = useCallback(async () => {
    if (!memberId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const storedFamilyId = await AsyncStorage.getItem('familyId');
      if (!storedFamilyId) throw new Error('ไม่พบครอบครัว กรุณาเข้าสู่ระบบใหม่');
      setFamilyId(storedFamilyId);
      const [{ data: member, error: memberError }, identityReferences] = await Promise.all([
        supabase.from('family_members')
          .select('identity_consent_at')
          .eq('id', memberId)
          .eq('family_id', storedFamilyId)
          .is('user_id', null)
          .single(),
        listIdentityReferences(memberId),
      ]);
      if (memberError) throw memberError;
      setConsentAt(member.identity_consent_at);
      setReferences(identityReferences);
    } catch (error) {
      Alert.error('โหลดข้อมูลไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const acceptConsent = async () => {
    setConsentBusy(true);
    try {
      await confirmIdentityConsent(memberId);
      await load();
    } catch (error) {
      Alert.error('บันทึกความยินยอมไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setConsentBusy(false);
    }
  };

  const chooseImage = async (pose: IdentityPose) => {
    if (!consentAt) {
      Alert.error('ต้องยืนยันความยินยอมก่อน', 'ข้อมูลจากการสแกนเป็นข้อมูลส่วนบุคคล กรุณายืนยันความยินยอมก่อนเริ่มสแกน');
      return;
    }
    setBusyPose(pose);
    try {
      const fullBody = pose === 'full_body';
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: fullBody ? [3, 4] : [1, 1],
        quality: 1,
        base64: false,
        cameraType: fullBody ? ImagePicker.CameraType.back : ImagePicker.CameraType.front,
      };
      const result = await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const image = result.assets[0];
      if (!image?.uri) throw new Error('อ่านข้อมูลรูปไม่ได้ กรุณาเลือกรูปใหม่');
      const base64 = await prepareIdentityImage(image.uri, fullBody);
      await validateFacePhoto(base64, fullBody);
      await saveIdentityReference({ familyId, memberId, pose, base64 });
      requestCameraMonitoringRefresh();
      await load();
    } catch (error) {
      Alert.error('สแกนไม่สำเร็จ', error instanceof FacePhotoError ? error.message : getFriendlyErrorMessage(error, 'ตรวจว่าภาพชัดเจนแล้วลองอีกครั้ง แอปจะปรับขนาดภาพให้อัตโนมัติ'));
    } finally {
      setBusyPose(null);
    }
  };

  const openImageSource = (pose: IdentityPose) => Alert.alert(
    pose === 'full_body' ? 'สแกนรูปร่าง' : 'สแกนใบหน้า',
    'จัดบุคคลให้อยู่ในกรอบและไม่มีคนอื่นอยู่ในภาพ แอปจะปรับขนาดรูปให้อัตโนมัติ',
    [
      { text: 'เปิดกล้องสแกน', onPress: () => { if (consentAt) setCapturePose(pose); else Alert.error('ต้องยืนยันความยินยอมก่อน', 'กรุณายืนยันความยินยอมก่อนเก็บรูป'); } },
      { text: 'เลือกจากคลังรูป', onPress: () => void chooseImage(pose) },
      { text: 'ยกเลิก', style: 'cancel' },
    ],
  );

  const confirmDelete = (reference: IdentityReference) => Alert.confirm(
    'ลบข้อมูลสแกนมุมนี้?',
    'ระบบจะมีข้อมูลสำหรับยืนยันบุคคลน้อยลง',
    [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบรูป', style: 'destructive', onPress: async () => {
        setBusyPose(reference.pose);
        try {
          await deleteIdentityReference(reference);
          await load();
        } catch (error) {
          Alert.error('ลบรูปไม่สำเร็จ', getFriendlyErrorMessage(error));
        } finally { setBusyPose(null); }
      } },
    ],
  );

  const confirmWithdraw = () => Alert.confirm(
    'ลบข้อมูลยืนยันตัวตนทั้งหมด?',
    'ข้อมูลสแกนทั้งหมดจะถูกลบ โหมดเฉพาะคนจะไม่แจ้งเหตุจากคนนี้จนกว่าจะยืนยันใบหน้าได้อีกครั้ง',
    [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบข้อมูลทั้งหมด', style: 'destructive', onPress: async () => {
        setConsentBusy(true);
        try {
          await withdrawIdentityConsent(memberId);
          await load();
        } catch (error) {
          Alert.error('ลบข้อมูลไม่สำเร็จ', getFriendlyErrorMessage(error));
        } finally { setConsentBusy(false); }
      } },
    ],
  );

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 20), backgroundColor: colors.headerBg, borderBottomColor: colors.headerBorder }]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="ย้อนกลับ">
        <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.headerCopy}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>ยืนยันบุคคลเป้าหมาย</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{memberName}</Text>
      </View>
    </View>

    {loading ? <ActivityIndicator color={emerald} style={styles.loader} /> :
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 30, 40) }]}>
        {params.setup === 'true' && <SetupReturnButton />}
        <View style={[styles.infoCard, { backgroundColor: colors.accentBg }]}>
          <MaterialCommunityIcons name="account-search-outline" size={28} color={colors.accentText} />
          <View style={styles.infoCopy}>
            <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>ใช้ในห้องที่มีหลายคน</Text>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>{hasNativeCameraMonitoring() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker'
              ? nativeIdentity ? `แอปเปรียบเทียบใบหน้ากับคนในกล้อง เมื่อหันหลังจะอ้างอิงใบหน้าที่เห็นล่าสุดได้ไม่เกิน ${identityConfig.retentionMs / 1000} วินาที หากคนบังกันหรือยืนยันไม่ได้ โหมดเฉพาะคนจะไม่แจ้งเหตุจากบุคคลนั้น`
                : 'กรุณาติดตั้ง APK รุ่นที่รองรับการจับคู่บุคคล รูปอ้างอิงจะยังไม่ถูกใช้ยืนยันชื่อในรุ่นนี้'
              : 'รูปเหล่านี้ใช้ประกอบการตรวจสอบเหตุ ระบบจะแสดงว่ายังไม่ยืนยันตัวบุคคลจนกว่าจะมีผลเปรียบเทียบที่รองรับ'}</Text>
          </View>
        </View>

        {!consentAt ? <View style={[styles.consentCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <MaterialCommunityIcons name="shield-account-outline" size={32} color={emerald} />
          <Text style={[styles.consentTitle, { color: colors.textPrimary }]}>ขอความยินยอมก่อนเก็บรูป</Text>
          <Text style={[styles.consentText, { color: colors.textSecondary }]}>ผู้รับการดูแลหรือผู้แทนโดยชอบธรรมยินยอมให้ใช้รูปเพื่อช่วยยืนยันบุคคลในการตรวจเหตุล้ม รูปจะเก็บในพื้นที่ส่วนตัวของครอบครัว</Text>
          <TouchableOpacity style={styles.consentButton} onPress={() => void acceptConsent()} disabled={consentBusy}>
            {consentBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.consentButtonText}>ยืนยันว่าได้รับความยินยอมแล้ว</Text>}
          </TouchableOpacity>
        </View> : <>
          {supportsGuidedFaceScan() && <TouchableOpacity accessibilityRole="button" style={[styles.scanButton, { backgroundColor: colors.accent }]} onPress={() => setCapturePose('all')}>
            <MaterialCommunityIcons name="face-recognition" size={28} color={colors.onAccent} />
            <View style={{ flex: 1 }}><Text style={styles.scanButtonTitle}>เริ่มสแกนใบหน้าทีละมุม</Text><Text style={styles.scanButtonDetail}>แอปถ่ายให้อัตโนมัติ ตรวจรูปแต่ละมุมก่อนบันทึก</Text></View>
          </TouchableOpacity>}
          <View style={styles.progressRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{nativeIdentity ? 'รูปใบหน้าสำหรับยืนยันบุคคล' : 'รูปใบหน้าและเต็มตัว'}</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>{nativeIdentity ? 'สแกนใบหน้าให้ครบ · รูปเต็มตัวเป็นภาพเสริมสำหรับตรวจสอบเหตุ' : supportsGuidedFaceScan() ? 'สแกนใบหน้า 3 มุมในครั้งเดียว · ถ่ายเต็มตัวแยกอีก 1 รูป' : supportsFaceInspection() ? 'ถ่ายรูปในแอปและตรวจใบหน้าก่อนบันทึก' : 'ถ่ายรูปอ้างอิง · ตรวจใบหน้าอัตโนมัติได้ใน APK รุ่นใหม่'}</Text>
            </View>
            <View style={[styles.progressPill, { backgroundColor: completedPoses === requiredPoses.length ? '#DCFCE7' : colors.inputBg }]}>
              <Text style={{ color: completedPoses === requiredPoses.length ? '#15803D' : colors.textSecondary, fontWeight: '800' }}>{completedPoses}/{requiredPoses.length}</Text>
            </View>
          </View>

          {completedPoses === requiredPoses.length && <View style={[styles.infoCard, { backgroundColor: colors.accentBg }]}>
            <View style={{ flex: 1 }}><Text style={{ color: colors.textPrimary, fontWeight: '800' }}>บันทึกรูปอ้างอิงแล้ว</Text>
              <Text style={{ color: colors.textSecondary }}>กลับไปตรวจการเตรียมใบหน้าและกล้อง ระบบอาจใช้เวลาสักครู่ การมีรูปครบยังไม่ใช่ผลยืนยันตัวคนในกล้อง</Text>
              <TouchableOpacity style={{ minHeight: readability.touchTargetSize, justifyContent: 'center', paddingVertical: 10 }}
                accessibilityRole="button" onPress={() => { requestCameraMonitoringRefresh(); router.navigate('/setup-guide'); }}>
                <Text style={{ color: colors.accentText, fontWeight: '800' }}>ต่อไป: ตรวจความพร้อม</Text>
              </TouchableOpacity></View>
          </View>}

          {guidedScan && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showFacePhotos }}
            style={{ minHeight: readability.touchTargetSize, justifyContent: 'center' }} onPress={() => setShowFacePhotos(value => !value)}>
            <Text style={{ color: colors.accentText }}>{showFacePhotos ? 'ย่อรายการรูปใบหน้า' : 'ดูหรือจัดการรูปใบหน้าแต่ละมุม'}</Text>
          </TouchableOpacity>}
          <View style={styles.referenceGrid}>
            {IDENTITY_POSES.filter(pose => pose.key === 'full_body'
              ? !nativeIdentity || showBodyReference || referencesByPose.has('full_body')
              : !guidedScan || showFacePhotos).map((pose) => {
              const reference = referencesByPose.get(pose.key);
              const busy = busyPose === pose.key;
              return <View key={pose.key} style={[styles.referenceCard, seniorMode && { width: '100%' }, { backgroundColor: colors.card, borderColor: reference ? emerald : colors.cardBorder }]}>
                <TouchableOpacity style={[styles.imageArea, { backgroundColor: colors.inputBg }]} onPress={() => openImageSource(pose.key)} disabled={busy}>
                  {busy ? <ActivityIndicator color={emerald} /> : reference?.signed_url
                    ? <Image source={{ uri: reference.signed_url }} style={styles.referenceImage} contentFit="cover" />
                    : <MaterialCommunityIcons name={pose.key === 'full_body' ? 'human-handsup' : 'face-recognition'} size={38} color={colors.textMuted} />}
                </TouchableOpacity>
                <Text style={[styles.poseLabel, { color: colors.textPrimary }]}>{pose.label}</Text>
                <Text style={[styles.poseDescription, { color: colors.textSecondary }]} numberOfLines={2}>{pose.description}</Text>
                <View style={styles.referenceActions}>
                  <TouchableOpacity style={{ minHeight: readability.touchTargetSize, justifyContent: 'center', flex: 1 }} onPress={() => openImageSource(pose.key)} disabled={busy} accessibilityRole="button">
                    <Text style={styles.replaceText}>{reference ? 'สแกนใหม่' : 'เริ่มสแกน'}</Text>
                  </TouchableOpacity>
                  {reference && <TouchableOpacity style={{ minHeight: readability.touchTargetSize, minWidth: readability.touchTargetSize, justifyContent: 'center', alignItems: 'center' }} accessibilityLabel={`ลบรูป ${pose.label}`} onPress={() => confirmDelete(reference)} disabled={busy}>
                    <MaterialCommunityIcons name="trash-can-outline" size={19} color="#B94747" />
                  </TouchableOpacity>}
                </View>
              </View>;
            })}
          </View>

          {nativeIdentity && !referencesByPose.has('full_body') && <TouchableOpacity accessibilityRole="button"
            onPress={() => setShowBodyReference(current => !current)} style={{ minHeight: readability.touchTargetSize, justifyContent: 'center', marginTop: 12 }}>
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>{showBodyReference ? 'ซ่อนรูปเต็มตัวเสริม' : 'เพิ่มรูปเต็มตัวเสริม (ไม่บังคับ)'}</Text>
          </TouchableOpacity>}

          <View style={[styles.warningCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <MaterialCommunityIcons name="information-outline" size={21} color={colors.accentText} />
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>การยืนยันบุคคลใช้ใบหน้า รูปเต็มตัวมีไว้ให้ผู้ดูแลตรวจสอบเหตุ หากหน้าไม่ชัดหรือมีคนบัง ระบบอาจยังยืนยันไม่ได้</Text>
          </View>

          
          <TouchableOpacity style={styles.withdrawButton} onPress={confirmWithdraw} disabled={consentBusy}>
            <Text style={[styles.withdrawText, { color: colors.dangerText }]}>ลบรูปและถอนความยินยอม</Text>
          </TouchableOpacity>
        </>}
      </ScrollView>}
    <FaceCaptureModal pose={capturePose} onClose={() => {
      setCapturePose(null);
      if (referencesChanged.current) { referencesChanged.current = false; void load(); }
    }} onSave={async (pose, base64) => {
      if (!consentAt || !familyId || !memberId) throw new Error('กรุณายืนยันความยินยอมและตรวจข้อมูลครอบครัวก่อน');
      await saveIdentityReference({ familyId, memberId, pose, base64 });
      referencesChanged.current = true;
    }} onSaveSet={async (photos, options) => {
      if (!consentAt || !familyId || !memberId) throw new Error('กรุณายืนยันความยินยอมและตรวจข้อมูลครอบครัวก่อน');
      await saveIdentityReferenceSet({ familyId, memberId, photos, options });
      requestCameraMonitoringRefresh();
      referencesChanged.current = true;
    }} />
  </View>;
}

const styles = StyleSheet.create({
  scanButton: { minHeight: 72, borderRadius: 18, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, marginVertical: 8 },
  scanButtonTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  scanButtonDetail: { color: '#ffffff', fontSize: 14, lineHeight: 22, marginTop: 4 },
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: readability.touchTargetSize, height: readability.touchTargetSize, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loader: { marginTop: 80 },
  content: { padding: 18 },
  infoCard: { borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, marginBottom: 16 },
  infoCopy: { flex: 1 },
  infoTitle: { fontSize: 15, fontWeight: '800', marginBottom: 5 },
  infoText: { fontSize: 12, lineHeight: 19 },
  consentCard: { borderWidth: 1, borderRadius: 20, padding: 22, alignItems: 'center' },
  consentTitle: { fontSize: 18, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  consentText: { fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  consentButton: { backgroundColor: emerald, borderRadius: 14, minHeight: 50, paddingHorizontal: 20, marginTop: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  consentButtonText: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  sectionSubtitle: { fontSize: 12, marginTop: 4 },
  progressPill: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  referenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  referenceCard: { width: '48%', borderWidth: 1.5, borderRadius: 18, padding: 10 },
  imageArea: { width: '100%', aspectRatio: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  referenceImage: { width: '100%', height: '100%' },
  poseLabel: { fontSize: 14, fontWeight: '800', marginTop: 10 },
  poseDescription: { fontSize: 11, lineHeight: 16, minHeight: 32, marginTop: 3 },
  referenceActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, minHeight: 24 },
  replaceText: { color: emerald, fontSize: 12, fontWeight: '800' },
  warningCard: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10, marginTop: 18 },
  warningText: { flex: 1, fontSize: 12, lineHeight: 19 },
  withdrawButton: { alignItems: 'center', paddingVertical: 16, marginTop: 10 },
  withdrawText: { color: '#B94747', fontWeight: '800' },
});
