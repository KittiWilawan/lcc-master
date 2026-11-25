import { CareText as Text } from '../components/CareText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hasNativeCameraMonitoring, supportsMonitoringIdentity, requestCameraMonitoringRefresh } from '../lib/cameraMonitoring';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
  confirmIdentityConsent, deleteIdentityReference, IDENTITY_POSES, IdentityPose,
  IdentityReference, listIdentityReferences, withdrawIdentityConsent,
} from '../lib/identityReferences';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { supabase } from '../lib/supabase';
import { AppAlert as Alert } from '../lib/appAlert';
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
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ memberId?: string; memberName?: string; setup?: string }>();
  const memberId = firstParam(params.memberId);
  const memberName = firstParam(params.memberName) || 'ผู้รับการดูแล';
  const [familyId, setFamilyId] = useState('');
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [references, setReferences] = useState<IdentityReference[]>([]);
  const nativeIdentity = supportsMonitoringIdentity() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker';
  const [loading, setLoading] = useState(true);
  const [busyPose, setBusyPose] = useState<IdentityPose | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
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

  const confirmDelete = (reference: IdentityReference) => Alert.confirm(
    'ลบข้อมูลสแกนมุมนี้?',
    'ระบบจะมีข้อมูลสำหรับยืนยันบุคคลน้อยลง',
    [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบรูป', style: 'destructive', onPress: async () => {
        setBusyPose(reference.pose);
        try {
          await deleteIdentityReference(reference);
          requestCameraMonitoringRefresh();
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
          requestCameraMonitoringRefresh();
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
          <TouchableOpacity accessibilityRole="button" style={[styles.scanButton, { backgroundColor: colors.accent }]}
            onPress={() => router.push({ pathname: '/body-enrollment', params: { familyId, memberId, name: memberName } })}>
            <MaterialCommunityIcons name="human" size={28} color={colors.onAccent} />
            <View style={{ flex: 1 }}><Text style={styles.scanButtonTitle}>สแกนเต็มตัวอัตโนมัติ</Text>
            <Text style={styles.scanButtonDetail}>ยืนหรือนั่งให้เห็นตั้งแต่ศีรษะถึงเท้า กล้องจะถ่ายให้เมื่ออยู่ในกรอบ</Text></View>
          </TouchableOpacity>
          {references.map(ref => <View key={ref.id} style={[styles.infoCard, { backgroundColor: colors.card }]}>
            {ref.signed_url && <Image source={{ uri: ref.signed_url }} style={{ width: 60, height: 75 }} contentFit="contain" cachePolicy="none" />}
            <Text style={{ flex: 1, color: colors.textPrimary }}>{IDENTITY_POSES.find(p => p.key === ref.pose)?.label}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => confirmDelete(ref)} disabled={busyPose !== null} style={styles.backButton}>
              <Text style={{ color: colors.dangerText }}>ลบ</Text>
            </TouchableOpacity>
          </View>)}
          <TouchableOpacity style={styles.withdrawButton} onPress={confirmWithdraw} disabled={consentBusy}>
            <Text style={[styles.withdrawText, { color: colors.dangerText }]}>ลบรูปและถอนความยินยอม</Text>
          </TouchableOpacity>
        </>}
      </ScrollView>}
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
