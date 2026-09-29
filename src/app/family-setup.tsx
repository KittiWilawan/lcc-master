import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
  createFamily,
  FAMILY_NAME_LIMIT,
  joinFamily,
  validateFamilyName,
  validateInvitationCode,
} from '../features/family/familySetup';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { checkAndSaveUserFamily, supabase } from '../lib/supabase';

type SetupMode = 'create' | 'join';

interface CreatedFamily {
  name: string;
  code: string;
}

const DEFAULT_FAMILY_NAME = 'ครอบครัวของฉัน';

export default function FamilySetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, seniorMode } = useTheme();
  const [selectedMode, setSelectedMode] = useState<SetupMode>('create');
  const [familyName, setFamilyName] = useState(DEFAULT_FAMILY_NAME);
  const [invitationCode, setInvitationCode] = useState('');
  const [createdFamily, setCreatedFamily] = useState<CreatedFamily | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const textScale = seniorMode ? 2 : 0;
  const dynamicStyles = useMemo(() => ({
    page: { backgroundColor: colors.background },
    card: { backgroundColor: colors.card, borderColor: colors.cardBorder },
    primaryText: { color: colors.textPrimary },
    secondaryText: { color: colors.textSecondary },
    input: { backgroundColor: colors.inputBg, borderColor: colors.cardBorder, color: colors.textPrimary },
  }), [colors]);

  useEffect(() => {
    async function checkExistingFamily() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        const family = await checkAndSaveUserFamily(session.user.id);
        if (family?.familyId) router.replace('/(tabs)/home');
      } catch (error) {
        console.log('Error checking existing family in setup:', error);
      }
    }

    void checkExistingFamily();
  }, [router]);

  const selectMode = (mode: SetupMode) => {
    setSelectedMode(mode);
    setValidationMessage(null);
  };

  const handleSubmit = async () => {
    if (createdFamily) {
      router.replace('/(tabs)/home');
      return;
    }

    const validationError = selectedMode === 'create'
      ? validateFamilyName(familyName)
      : validateInvitationCode(invitationCode);

    if (validationError) {
      setValidationMessage(validationError);
      return;
    }

    setValidationMessage(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        Alert.alert('กรุณาเข้าสู่ระบบ', 'เข้าสู่ระบบอีกครั้งแล้วจึงตั้งค่าครอบครัว');
        router.replace('/login');
        return;
      }

      if (selectedMode === 'create') {
        const family = await createFamily(supabase, familyName);
        setCreatedFamily({ name: familyName.trim(), code: family.familyCode });
        return;
      }

      const family = await joinFamily(supabase, invitationCode);
      if (!family) {
        setValidationMessage('ไม่พบครอบครัว กรุณาตรวจสอบรหัสแล้วลองอีกครั้ง');
        return;
      }

      router.replace('/(tabs)/home');
    } catch (error: unknown) {
      Alert.alert(
        'ดำเนินการไม่สำเร็จ',
        getFriendlyErrorMessage(error, 'ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'),
      );
    } finally {
      setLoading(false);
    }
  };

  const shareInvitation = async () => {
    if (!createdFamily) return;
    await Share.share({
      title: 'ชวนเข้าร่วมครอบครัว LookLanCare',
      message: `มาช่วยกันดูแลคนที่เรารักใน LookLanCare\n\nครอบครัว: ${createdFamily.name}\nรหัสเชิญ: ${createdFamily.code}`,
    });
  };

  if (createdFamily) {
    return (
      <View style={[styles.container, dynamicStyles.page, { paddingTop: Math.max(insets.top, 16) }]}>
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successIcon} accessibilityElementsHidden>
            <MaterialCommunityIcons name="check-bold" size={46} color="#ffffff" />
          </View>
          <Text style={[styles.successTitle, dynamicStyles.primaryText, { fontSize: 27 + textScale }]}>สร้างครอบครัวสำเร็จแล้ว</Text>
          <Text style={[styles.successSubtitle, dynamicStyles.secondaryText, { fontSize: 16 + textScale }]}>คุณพร้อมเริ่มดูแลคนที่คุณรักแล้ว</Text>

          <View style={[styles.successCard, dynamicStyles.card]}>
            <Text style={[styles.familyName, dynamicStyles.primaryText, { fontSize: 20 + textScale }]}>{createdFamily.name}</Text>
            <Text style={[styles.codeLabel, dynamicStyles.secondaryText, { fontSize: 14 + textScale }]}>รหัสสำหรับเชิญผู้ดูแลคนอื่น</Text>
            <Text selectable style={styles.codeText}>{createdFamily.code}</Text>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => void shareInvitation()}
              accessibilityRole="button"
              accessibilityLabel="แชร์รหัสเชิญให้ผู้ดูแลคนอื่น"
            >
              <MaterialCommunityIcons name="share-variant" size={22} color="#047857" />
              <Text style={[styles.shareButtonText, { fontSize: 16 + textScale }]}>แชร์รหัสให้คนในครอบครัว</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSubmit}
            accessibilityRole="button"
            accessibilityLabel="เริ่มดูแลครอบครัวนี้"
          >
            <Text style={[styles.primaryButtonText, { fontSize: 18 + textScale }]}>เริ่มดูแลครอบครัวนี้</Text>
            <MaterialCommunityIcons name="arrow-right" size={23} color="#ffffff" />
          </TouchableOpacity>
          <Text style={[styles.reassuranceText, dynamicStyles.secondaryText]}>รหัสนี้ดูได้อีกครั้งจากหน้าโปรไฟล์</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, dynamicStyles.page, { paddingTop: Math.max(insets.top, 16) }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerIcon} accessibilityElementsHidden>
              <MaterialCommunityIcons name="home-heart" size={30} color="#047857" />
            </View>
            <Text style={[styles.title, dynamicStyles.primaryText, { fontSize: 28 + textScale }]}>เริ่มต้นดูแลครอบครัว</Text>
            <Text style={[styles.subtitle, dynamicStyles.secondaryText, { fontSize: 16 + textScale }]}>เลือกวิธีที่ตรงกับคุณ ใช้เวลาไม่ถึง 1 นาที</Text>
          </View>

          <View style={styles.modeRow} accessibilityRole="radiogroup">
            <TouchableOpacity
              style={[styles.modeButton, dynamicStyles.card, selectedMode === 'create' && styles.modeButtonActive]}
              onPress={() => selectMode('create')}
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedMode === 'create' }}
              accessibilityLabel="สร้างครอบครัวใหม่"
            >
              <MaterialCommunityIcons name="home-plus" size={27} color={selectedMode === 'create' ? '#ffffff' : '#047857'} />
              <Text style={[styles.modeTitle, dynamicStyles.primaryText, selectedMode === 'create' && styles.modeTitleActive, { fontSize: 16 + textScale }]}>สร้างใหม่</Text>
              <Text style={[styles.modeDescription, dynamicStyles.secondaryText, selectedMode === 'create' && styles.modeDescriptionActive]}>ฉันยังไม่มีครอบครัว</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeButton, dynamicStyles.card, selectedMode === 'join' && styles.modeButtonActive]}
              onPress={() => selectMode('join')}
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedMode === 'join' }}
              accessibilityLabel="เข้าร่วมด้วยรหัสเชิญ"
            >
              <MaterialCommunityIcons name="account-group" size={27} color={selectedMode === 'join' ? '#ffffff' : '#047857'} />
              <Text style={[styles.modeTitle, dynamicStyles.primaryText, selectedMode === 'join' && styles.modeTitleActive, { fontSize: 16 + textScale }]}>เข้าร่วม</Text>
              <Text style={[styles.modeDescription, dynamicStyles.secondaryText, selectedMode === 'join' && styles.modeDescriptionActive]}>ฉันมีรหัสเชิญแล้ว</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.formCard, dynamicStyles.card]}>
            {selectedMode === 'create' ? (
              <>
                <View style={styles.formHeadingRow}>
                  <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
                  <Text style={[styles.formTitle, dynamicStyles.primaryText, { fontSize: 19 + textScale }]}>ตั้งชื่อครอบครัว</Text>
                </View>
                <Text style={[styles.formHint, dynamicStyles.secondaryText, { fontSize: 14 + textScale }]}>ใช้ชื่อบ้านหรือชื่อที่ทุกคนจำได้ง่าย</Text>
                <TextInput
                  style={[styles.textInput, dynamicStyles.input, { fontSize: 17 + textScale }]}
                  value={familyName}
                  onChangeText={setFamilyName}
                  maxLength={FAMILY_NAME_LIMIT}
                  autoCorrect={false}
                  selectTextOnFocus
                  returnKeyType="done"
                  accessibilityLabel="ชื่อครอบครัว"
                />
              </>
            ) : (
              <>
                <View style={styles.formHeadingRow}>
                  <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
                  <Text style={[styles.formTitle, dynamicStyles.primaryText, { fontSize: 19 + textScale }]}>ใส่รหัสเชิญ</Text>
                </View>
                <Text style={[styles.formHint, dynamicStyles.secondaryText, { fontSize: 14 + textScale }]}>ขอรหัสจากคนที่สร้างครอบครัว แล้วนำมากรอกด้านล่าง</Text>
                <TextInput
                  style={[styles.textInput, styles.codeInput, dynamicStyles.input, { fontSize: 17 + textScale }]}
                  value={invitationCode}
                  onChangeText={setInvitationCode}
                  placeholder="กรอกรหัสเชิญที่ได้รับ"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  selectTextOnFocus
                  returnKeyType="done"
                  onSubmitEditing={() => void handleSubmit()}
                  accessibilityLabel="รหัสเชิญครอบครัว"
                />
              </>
            )}

            {validationMessage && (
              <View style={styles.validationBox} accessibilityRole="alert">
                <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#b91c1c" />
                <Text style={styles.validationText}>{validationMessage}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            accessibilityLabel={selectedMode === 'create' ? 'สร้างครอบครัวของฉัน' : 'เข้าร่วมครอบครัว'}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { fontSize: 18 + textScale }]}>
                  {selectedMode === 'create' ? 'สร้างครอบครัวของฉัน' : 'เข้าร่วมครอบครัว'}
                </Text>
                <MaterialCommunityIcons name="arrow-right" size={23} color="#ffffff" />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="ย้อนกลับ">
            <MaterialCommunityIcons name="arrow-left" size={20} color={colors.textSecondary} />
            <Text style={[styles.backButtonText, dynamicStyles.secondaryText, { fontSize: 16 + textScale }]}>ย้อนกลับ</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 32 },
  successContainer: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 26 },
  headerIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  subtitle: { lineHeight: 24, textAlign: 'center' },
  modeRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  modeButton: { flex: 1, minHeight: 126, borderRadius: 18, borderWidth: 1.5, padding: 15, justifyContent: 'center' },
  modeButtonActive: { backgroundColor: '#047857', borderColor: '#047857' },
  modeTitle: { fontWeight: '800', marginTop: 9, marginBottom: 3 },
  modeTitleActive: { color: '#ffffff' },
  modeDescription: { fontSize: 12, lineHeight: 17 },
  modeDescriptionActive: { color: '#d1fae5' },
  formCard: { borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 18 },
  formHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  stepBadge: { width: 28, height: 28, borderRadius: 10, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' },
  stepBadgeText: { color: '#047857', fontWeight: '900', fontSize: 14 },
  formTitle: { fontWeight: '800' },
  formHint: { lineHeight: 21, marginBottom: 14 },
  textInput: { minHeight: 58, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, fontWeight: '600' },
  codeInput: { letterSpacing: 0.5 },
  validationBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, marginTop: 12 },
  validationText: { flex: 1, color: '#991b1b', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  primaryButton: { width: '100%', minHeight: 58, backgroundColor: '#047857', borderRadius: 16, paddingHorizontal: 20, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#ffffff', fontWeight: '900' },
  buttonDisabled: { opacity: 0.65 },
  backButton: { minHeight: 52, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  backButtonText: { fontWeight: '700' },
  successIcon: { width: 82, height: 82, borderRadius: 30, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  successTitle: { fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  successSubtitle: { textAlign: 'center', marginBottom: 26 },
  successCard: { width: '100%', borderWidth: 1, borderRadius: 22, padding: 20, alignItems: 'center', marginBottom: 20 },
  familyName: { fontWeight: '900', textAlign: 'center', marginBottom: 18 },
  codeLabel: { textAlign: 'center', marginBottom: 7 },
  codeText: { color: '#047857', fontSize: 18, fontWeight: '900', letterSpacing: 1, textAlign: 'center', marginBottom: 18 },
  shareButton: { width: '100%', minHeight: 54, borderRadius: 14, backgroundColor: '#d1fae5', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  shareButtonText: { color: '#047857', fontWeight: '800', textAlign: 'center' },
  reassuranceText: { fontSize: 13, textAlign: 'center', marginTop: 14 },
});
