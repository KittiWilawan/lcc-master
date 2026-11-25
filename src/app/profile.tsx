import { SettingSwitch } from '../components/SettingSwitch';
import { CareText as Text } from '../components/CareText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { startPhoneTest, finishPhoneTest, lastPhoneTest, onPhoneTestChanged, type PhoneTest } from '../lib/selfTestReceipts';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlert as Alert } from '../lib/appAlert';
import { normalizePin, PIN_LENGTH, validatePinPair } from '../lib/formValidation';
import { supabase } from '../lib/supabase';
import { useTheme, type ThemeColors } from '../context/ThemeContext';
import { SetupReturnButton } from '../components/SetupReturnButton';
import { signOutCurrentDevice } from '../lib/authSession';
import {
  callPhoneNumber, isValidMobilePhone, MOBILE_PHONE_LENGTH, normalizeMobilePhoneInput,
} from '../lib/phone';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { sendRemoteSelfTestNotification } from '../lib/pushNotifications';
import { testDeviceNotification } from '../lib/testDeviceNotification';

interface EmergencyContact {
  id: string;
  profile_id: string;
  name: string;
  phone: string;
  is_primary: boolean;
  icon_name: string;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { section, action, setup } = useLocalSearchParams<{ section?: string; action?: string; setup?: string }>();
  const insets = useSafeAreaInsets();
  const { isDarkMode, toggleDarkMode, seniorMode, toggleSeniorMode, colors } = useTheme();
  const styles = createStyles(colors);

  // State 
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [testingAppNotification, setTestingAppNotification] = useState(false);
  const remoteTestBusy = useRef(false);
  const [receipt, setReceipt] = useState<{ owner: string; test: PhoneTest } | null>(null);
  const currentTest = receipt?.owner === userId ? receipt?.test : null;
  useEffect(() => {
    if (!userId) return;
    let listening = true;
    let changed = false;
    const unsubscribe = onPhoneTestChanged((owner, test) => {
      if (owner === userId) { changed = true; setReceipt({ owner, test }); }
    });
    void lastPhoneTest(userId).then(test => {
      if (listening && !changed && test) setReceipt({ owner: userId, test });
    }).catch(() => undefined);
    return () => { listening = false; unsubscribe(); };
  }, [userId]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [newAvatarImage, setNewAvatarImage] = useState<string | null>(null);
  const [familyCode, setFamilyCode] = useState('ไม่มีรหัส');
  const [fallAlerts, setFallAlerts] = useState(true);
  const [activitySummary, setActivitySummary] = useState(true);
  const [emergencySms, setEmergencySms] = useState(false);

  // Security & App Lock State
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const closePinModal = () => { if (savingPin) return; setShowPinModal(false); setNewPin(''); setConfirmPin(''); setPinError(null); };

  // Change Password State
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [confirmAccountPassword, setConfirmAccountPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Segmented Tab Switcher State
  const [activeTab, setActiveTab] = useState<'profile' | 'settings' | 'family'>(section === 'contacts' ? 'family' : 'profile');

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactPrimary, setContactPrimary] = useState(false);

  useEffect(() => {
    if (section === 'notifications') {
      const openSettings = setTimeout(() => setActiveTab('settings'), 0);
      return () => clearTimeout(openSettings);
    }
    if (section !== 'contacts') return;
    const openContactsTimer = setTimeout(() => {
      setActiveTab('family');
      if (action === 'add') {
        setEditingContactId(null);
        setContactName('');
        setContactPhone('');
        setContactPrimary(contacts.length === 0);
        setShowContactModal(true);
        router.setParams({ action: '' });
      }
    }, 0);
    return () => clearTimeout(openContactsTimer);
  }, [action, contacts.length, router, section]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        Alert.alert('แจ้งเตือน', 'กรุณาเข้าสู่ระบบก่อน');
        setLoading(false);
        return;
      }

      setUserId(session.user.id);

      // โหลดรหัสครอบครัวจากที่ถูกสร้างหรือกรอกไว้
      const storedCode = await AsyncStorage.getItem('familyCode');
      if (storedCode) setFamilyCode(storedCode);

      // ดึงข้อมูลจากตาราง profiles
      const { data, error, status } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error && status !== 406) {
        throw error;
      }

      // ใช้ metadata จากการสมัครเป็นค่าเริ่มต้น (Fallback)
      const meta = session.user.user_metadata;

      setFullName(data?.full_name || meta?.full_name || '');
      setPhoneNumber(normalizeMobilePhoneInput(data?.phone || meta?.phone || ''));
      setAvatarUrl(data?.avatar_url || meta?.avatar_url || null);
      setFallAlerts(data?.fall_alerts ?? true);
      setActivitySummary(data?.activity_summary ?? true);
      setEmergencySms(data?.emergency_sms ?? false);

      // ดึงข้อมูล Contacts
      const { data: contactsData } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('profile_id', session.user.id)
        .order('is_primary', { ascending: false });

      if (contactsData) {
        setContacts(contactsData);
      }

      // โหลดสถานะ App Lock
      const storedLock = await AsyncStorage.getItem('@app_lock_enabled');
      setAppLockEnabled(storedLock === 'true');
    } catch (error: any) {
      console.log('Error loading profile:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAppLock = async (value: boolean) => {
    if (value) {
      const storedPin = await AsyncStorage.getItem('@app_lock_pin');
      if (!storedPin) {
        setNewPin(''); setConfirmPin(''); setPinError(null);
        setShowPinModal(true);
      } else {
        await AsyncStorage.setItem('@app_lock_enabled', 'true');
        setAppLockEnabled(true);
        Alert.success('เปิดใช้งานแล้ว 🔐', 'ระบบจะถาม PIN/Biometric เมื่อเปิดแอป');
      }
    } else {
      await AsyncStorage.setItem('@app_lock_enabled', 'false');
      setAppLockEnabled(false);
      Alert.success('ปิดใช้งานแล้ว', 'ยกเลิกการล็อกแอปเรียบร้อย');
    }
  };

  const handleSavePin = async () => {
    if (savingPin) return;
    const error = validatePinPair(newPin, confirmPin);
    setPinError(error);
    if (error) return;
    setSavingPin(true);
    try {
      await AsyncStorage.multiSet([['@app_lock_pin', newPin], ['@app_lock_enabled', 'true']]);
      setAppLockEnabled(true);
      setShowPinModal(false); setNewPin(''); setConfirmPin(''); setPinError(null);
      Alert.success('ตั้งค่า PIN แล้ว', 'ยืนยันรหัสตรงกัน และเปิดการล็อกแอปเรียบร้อยแล้ว');
    } catch (error) { Alert.error('บันทึก PIN ไม่สำเร็จ', getFriendlyErrorMessage(error)); }
    finally { setSavingPin(false); }
  };

  const handleTestAppNotification = async () => {
    if (testingAppNotification) return;
    setTestingAppNotification(true);
    try {
      await testDeviceNotification();
    }
    finally { setTestingAppNotification(false); }
  };

  const handleTestRemoteNotification = async () => {
    if (remoteTestBusy.current || testingAppNotification || !userId) return;
    remoteTestBusy.current = true;
    setTestingAppNotification(true);
    let testId: string | undefined;
    try {
      testId = uuid();
      await startPhoneTest(userId, testId);
      const { accepted, correlated } = await sendRemoteSelfTestNotification(testId, userId);
      await finishPhoneTest(userId, testId, accepted, correlated);
      if (!accepted) { Alert.error('รับจากระบบส่วนกลางยังไม่พร้อม', 'ยังลงทะเบียนรับข้อความไม่ได้ กรุณาตรวจอินเทอร์เน็ต สิทธิ์แจ้งเตือน และใช้ APK ที่ตั้งค่า Firebase แล้ว'); return; }
    } catch (error) {
      if (testId) await finishPhoneTest(userId, testId, false, false).catch(() => undefined);
      Alert.error('ทดสอบไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally { remoteTestBusy.current = false; setTestingAppNotification(false); }
  };

  const handleCopyFamilyCode = () => {
    if (!familyCode || familyCode === 'ไม่มีรหัส') {
      Alert.alert('แจ้งเตือน', 'ยังไม่มีรหัสครอบครัว');
      return;
    }
    void Share.share({
      message: familyCode,
      title: 'รหัสครอบครัว LookLanCare',
    });
    Alert.success('คัดลอกรหัสแล้ว 📋', `รหัสครอบครัว: ${familyCode}`);
  };

  const handleShareFamilyCode = async () => {
    if (!familyCode || familyCode === 'ไม่มีรหัส') {
      Alert.alert('แจ้งเตือน', 'ยังไม่มีรหัสครอบครัว');
      return;
    }
    try {
      await Share.share({
        message: `[LookLanCare] เข้าร่วมกลุ่มเฝ้าระวังผู้สูงอายุในบ้านกับฉันบนแอป LookLanCare ด้วยรหัสครอบครัว: ${familyCode}`,
        title: 'คำเชิญเข้าร่วมครอบครัว LookLanCare',
      });
    } catch (e: any) {
      console.log('Error sharing family code:', e);
    }
  };

  const handleLogout = async () => {
    try {
      setSaving(true);
      await signOutCurrentDevice();
      router.replace('/login');
    } catch (error: any) {
      Alert.error('เกิดข้อผิดพลาดในการออกจากระบบ', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newAccountPassword || !confirmAccountPassword) {
      Alert.error('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกรหัสผ่านใหม่และยืนยันรหัสผ่าน');
      return;
    }
    if (newAccountPassword !== confirmAccountPassword) {
      Alert.error('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    if (newAccountPassword.length < 8) {
      Alert.error('รหัสผ่านสั้นเกินไป', 'เพื่อความปลอดภัย รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป');
      return;
    }

    try {
      setChangingPassword(true);
      const { error } = await supabase.auth.updateUser({ password: newAccountPassword });
      if (error) throw error;

      Alert.success('สำเร็จ! 🎉', 'เปลี่ยนรหัสผ่านของคุณเรียบร้อยแล้ว');
      setShowChangePasswordModal(false);
      setNewAccountPassword('');
      setConfirmAccountPassword('');
    } catch (e: any) {
      Alert.error('เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน', e.message);
    } finally {
      setChangingPassword(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, []);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, // แก้ไขตรงนี้ให้ใช้ Enum ที่ถูกต้องของ Expo เพื่อแก้ Syntax Error
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setNewAvatarImage(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (!userId) {
        Alert.alert('แจ้งเตือน', 'ไม่พบข้อมูลผู้ใช้');
        return;
      }
      if (!isValidMobilePhone(phoneNumber)) {
        Alert.error('เบอร์มือถือไม่ถูกต้อง', 'กรุณากรอกเบอร์มือถือ 10 หลัก โดยขึ้นต้นด้วย 0');
        return;
      }

      let finalAvatarUrl = avatarUrl;

      // อัปโหลดรูปภาพใหม่ถ้ามีการเลือก
      if (newAvatarImage) {
        const fileName = `profile-${userId}-${Date.now()}.jpg`;
        const response = await fetch(newAvatarImage);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: false,
          });

        if (uploadError) {
          throw new Error('อัปโหลดรูปล้มเหลว: ' + uploadError.message);
        }

        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        finalAvatarUrl = publicUrl;
      }

      const updates = {
        id: userId,
        full_name: fullName,
        phone: normalizeMobilePhoneInput(phoneNumber),
        avatar_url: finalAvatarUrl,
        fall_alerts: fallAlerts,
        activity_summary: activitySummary,
        emergency_sms: emergencySms,
        updated_at: new Date(),
      };

      const { error } = await supabase.from('profiles').upsert(updates);

      if (error) throw error;

      Alert.success('สำเร็จ', 'บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว');
      router.back();
    } catch (error) {
      if (error instanceof Error) {
        Alert.error('เกิดข้อผิดพลาดในการบันทึก', error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCall = async (phone: string) => {
    const opened = await callPhoneNumber(phone);
    if (!opened) Alert.error('โทรออกไม่ได้', 'กรุณาตรวจเบอร์ผู้ติดต่อ หรือโทรจากอุปกรณ์ที่รองรับการโทร');
  };

  const openAddContactModal = () => {
    setEditingContactId(null);
    setContactName('');
    setContactPhone('');
    setContactPrimary(false);
    setShowContactModal(true);
  };

  const openEditContactModal = (contact: EmergencyContact) => {
    setEditingContactId(contact.id);
    setContactName(contact.name);
    setContactPhone(normalizeMobilePhoneInput(contact.phone));
    setContactPrimary(contact.is_primary);
    setShowContactModal(true);
  };

  const handleSaveContact = async () => {
    if (!userId) return;
    const cleanName = contactName.trim();
    const cleanPhone = normalizeMobilePhoneInput(contactPhone);
    if (!cleanName || !isValidMobilePhone(cleanPhone)) {
      Alert.error('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อและเบอร์มือถือ 10 หลัก โดยขึ้นต้นด้วย 0');
      return;
    }

    setSaving(true);
    try {
      if (contactPrimary) {
        const { error: resetPrimaryError } = await supabase
          .from('emergency_contacts')
          .update({ is_primary: false })
          .eq('profile_id', userId);
        if (resetPrimaryError) throw resetPrimaryError;
      }
      if (editingContactId) {
        const { error } = await supabase
          .from('emergency_contacts')
          .update({ name: cleanName, phone: cleanPhone, is_primary: contactPrimary })
          .eq('id', editingContactId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('emergency_contacts')
          .insert([{ profile_id: userId, name: cleanName, phone: cleanPhone, is_primary: contactPrimary, icon_name: 'account-outline' }]);
        if (error) throw error;
      }

      setShowContactModal(false);
      await loadProfile();
    } catch (error) {
      Alert.error('บันทึกผู้ติดต่อไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = (id: string) => {
    Alert.confirm('ยืนยันการลบ', 'คุณแน่ใจหรือไม่ว่าต้องการลบรายชื่อนี้?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ', style: 'destructive', onPress: async () => {
          setSaving(true);
          try {
            const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
            if (error) throw error;
            loadProfile();
          } catch (error: any) {
            Alert.error('Error', error.message);
          } finally {
            setSaving(false);
          }
        }
      }
    ]);
  };

  // ดึงค่า URI ของรูปโปรไฟล์ออกมารอไว้ข้างนอก เพื่อให้โค้ดส่วน JSX สะอาดและปลอดภัยขึ้น
  const displayAvatarUri = newAvatarImage || avatarUrl;

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 14), backgroundColor: colors.headerBg, borderBottomColor: colors.headerBorder }]}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
          <Text style={[styles.headerTitle, { color: colors.accentText }]}>โปรไฟล์ & ตั้งค่า</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.profileBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator size="large" color={colors.accentText} />
          <Text style={{ marginTop: 12, color: colors.textSecondary }}>กำลังโหลดข้อมูล...</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
          {setup === 'true' && <SetupReturnButton />}

          {/* Segmented Control Switcher */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0',
              borderRadius: 14,
              padding: 4,
              marginBottom: 16,
            }}
          >
            <TouchableOpacity
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: activeTab === 'profile' ? (isDarkMode ? '#334155' : colors.card) : 'transparent',
                elevation: activeTab === 'profile' ? 2 : 0,
              }}
              onPress={() => setActiveTab('profile')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'profile' ? (isDarkMode ? '#34d399' : colors.accentText) : colors.textSecondary,
                }}
              >
                👤 โปรไฟล์
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: activeTab === 'settings' ? (isDarkMode ? '#334155' : colors.card) : 'transparent',
                elevation: activeTab === 'settings' ? 2 : 0,
              }}
              onPress={() => setActiveTab('settings')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'settings' ? (isDarkMode ? '#34d399' : colors.accentText) : colors.textSecondary,
                }}
              >
                ⚙️ ตั้งค่าแอป
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: activeTab === 'family' ? (isDarkMode ? '#334155' : colors.card) : 'transparent',
                elevation: activeTab === 'family' ? 2 : 0,
              }}
              onPress={() => setActiveTab('family')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'family' ? (isDarkMode ? '#34d399' : colors.accentText) : colors.textSecondary,
                }}
              >
                🏠 ครอบครัว
              </Text>
            </TouchableOpacity>
          </View>

          {/* TAB 1: USER PROFILE & ACCOUNT */}
          {activeTab === 'profile' && (
            <View>
              {/* Profile Picture Section */}
              <View style={styles.profileHeader}>
                <TouchableOpacity style={styles.avatarContainer} onPress={pickImage}>
                  <View style={styles.avatarCircle}>
                    {displayAvatarUri ? (
                      <Image source={{ uri: displayAvatarUri }} style={{ width: 76, height: 76, borderRadius: 38 }} />
                    ) : (
                      <MaterialCommunityIcons name="account-plus-outline" size={40} color={colors.textMuted} />
                    )}
                  </View>
                  <View style={styles.cameraBadge}>
                    <MaterialCommunityIcons name="camera" size={16} color={colors.onAccent} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.profileTitle}>{fullName || 'ผู้ใช้งาน LookLanCare'}</Text>
                <Text style={styles.profileSubtitle}>จัดการข้อมูลส่วนตัวและรหัสผ่านบัญชีของคุณ</Text>
              </View>

              {/* Form Inputs */}
              <View style={styles.formSection}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>ชื่อ-นามสกุล (Full Name)</Text>
                  <TextInput
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="กรอกชื่อ-นามสกุล..."
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>เบอร์มือถือ 10 หลัก</Text>
                  <TextInput
                    style={styles.input}
                    value={phoneNumber}
                    onChangeText={(value) => setPhoneNumber(normalizeMobilePhoneInput(value))}
                    keyboardType="number-pad"
                    maxLength={MOBILE_PHONE_LENGTH}
                    placeholder="08XXXXXXXX"
                  />
                </View>

                {/* Change Password Card */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, marginTop: 4, marginBottom: 12 }}
                  onPress={() => setShowChangePasswordModal(true)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.warningBg }]}>
                      <MaterialCommunityIcons name="lock-reset" size={20} color={colors.warningText} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>เปลี่ยนรหัสผ่าน (Change Password)</Text>
                      <Text style={styles.cardSubtitle}>ตั้งค่ารหัสผ่านใหม่สำหรับเข้าสู่ระบบ</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Save & Logout Buttons */}
              <View style={styles.actionsContainer}>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.saveBtnText}>บันทึกข้อมูลโปรไฟล์</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.cancelBtn, { backgroundColor: colors.dangerBg, borderColor: '#fca5a5', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 }]}
                  onPress={handleLogout}
                  disabled={saving}
                >
                  <MaterialCommunityIcons name="logout" size={18} color={colors.dangerText} style={{ marginRight: 6 }} />
                  <Text style={[styles.cancelBtnText, { color: colors.dangerText, fontWeight: '800' }]}>ออกจากระบบ (Logout)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* TAB 2: APP SETTINGS & SECURITY */}
          {activeTab === 'settings' && (
            <View>
              {/* App Notification */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="bell-ring-outline" size={20} color={colors.accentText} />
                  <Text style={styles.sectionTitle}>แจ้งเตือนในแอป</Text>
                </View>

                <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.cardBorder }}>
                  <View style={{ backgroundColor: colors.accentBg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#a7f3d0', marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, color: colors.accentText, fontWeight: '800', marginBottom: 4 }}>ใช้ฟรีและไม่ต้องเชื่อมบัญชีอื่น</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 17 }}>
                      รับเหตุล้มและ SOS บนมือถือผ่าน LookLanCare พร้อมเปิดดูเวลา กล้อง บุคคล และภาพหลักฐานในแอป
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={{ backgroundColor: '#059669', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
                    onPress={handleTestAppNotification}
                    disabled={testingAppNotification}
                  >
                    {testingAppNotification ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={{ color: colors.onAccent, fontSize: 12, fontWeight: '800' }}>ทดสอบการแจ้งเตือนบนมือถือเครื่องนี้</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={{ fontSize: 10, color: colors.textSecondary, lineHeight: 15, marginTop: 8, textAlign: 'center' }}>
                    ปุ่มแรกตรวจการเตือนในเครื่อง ปุ่มด้านล่างส่งจากระบบส่วนกลางมายังมือถือเครื่องนี้ โดยไม่ส่งให้คนอื่นในครอบครัว
                  </Text>
                  <TouchableOpacity onPress={handleTestRemoteNotification} disabled={testingAppNotification || !userId}
                    accessibilityRole="button" accessibilityLabel="ทดสอบรับแจ้งเตือนจากระบบส่วนกลาง"
                    style={{ minHeight: 48, padding: 12, marginTop: 12, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: '800' }}>ทดสอบรับจากระบบส่วนกลาง</Text>
                  </TouchableOpacity>
                  {currentTest && <View accessibilityLiveRegion="polite" style={{ marginTop: 12, gap: 6 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>ผลทดสอบล่าสุด · มือถือเครื่องนี้</Text>
                    <Text style={{ color: colors.textSecondary }}>เริ่มทดสอบ {new Date(currentTest.requestedAt).toLocaleString('th-TH')}</Text>
                    {currentTest.sentAt && <Text style={{ color: colors.textSecondary }}>ระบบตอบรับการส่งแล้ว {new Date(currentTest.sentAt).toLocaleTimeString('th-TH')}</Text>}
                    <Text style={{ color: currentTest.observedAt ? colors.accentText : colors.textSecondary }}>
                      {currentTest.observedAt ? `มือถือผู้ดูแลได้รับแล้ว · แอปตรวจพบเมื่อ ${new Date(currentTest.observedAt).toLocaleString('th-TH')}`
                        : currentTest.failed ? 'ยังยืนยันการส่งไม่ได้ กดทดสอบใหม่ได้'
                        : currentTest.sentAt && !currentTest.correlated ? 'ระบบส่วนกลางรุ่นนี้ยังยืนยันการรับแยกรายครั้งไม่ได้'
                        : 'ยังไม่มีการตอบรับจากมือถือสำหรับครั้งนี้'}
                    </Text>
                  </View>}
                </View>
              </View>

              {/* Security & Theme Settings */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="shield-account-outline" size={20} color={colors.accentText} />
                  <Text style={styles.sectionTitle}>ความปลอดภัย & การแสดงผล</Text>
                </View>

                <View style={[styles.settingCard, seniorMode && { borderColor: colors.accent, borderWidth: 2 }]}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentBg }]}>
                      <MaterialCommunityIcons name="human-cane" size={22} color={colors.accentText} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardLabel, { fontSize: 16 }]}>โหมดผู้สูงอายุ</Text>
                      <Text style={[styles.cardSubtitle, { fontSize: 13, lineHeight: 19 }]}>หน้าหลักเรียบง่าย ตัวอักษรและปุ่มใหญ่ขึ้น</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    value={seniorMode}
                    onValueChange={toggleSeniorMode}
                    accessibilityLabel="เปิดหรือปิดโหมดผู้สูงอายุ"
                  />
                </View>

                {/* Dark Mode Card */}
                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#312e81' }]}>
                      <MaterialCommunityIcons name="theme-light-dark" size={20} color="#818cf8" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>โหมดสีเข้ม</Text>
                      <Text style={styles.cardSubtitle}>เปลี่ยนธีมแอปเพื่อเปิดใช้งานกลางดึกไม่แสบตา</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    accessibilityLabel="โหมดสีเข้ม" value={isDarkMode}
                    onValueChange={toggleDarkMode}
                  />
                </View>

                {/* App Lock Card */}
                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentBg }]}>
                      <MaterialCommunityIcons name="lock-check-outline" size={20} color={colors.accentText} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ล็อกแอปด้วยรหัส</Text>
                      <Text style={styles.cardSubtitle}>ถาม PIN 4 หลัก / สแกนนิ้วเมื่อเปิดแอป</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    accessibilityLabel="ล็อกแอปด้วยรหัส" value={appLockEnabled}
                    onValueChange={handleToggleAppLock}
                  />
                </View>

                {appLockEnabled && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.cardBorder, marginTop: 6 }}
                    onPress={() => setShowPinModal(true)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="key-change" size={18} color={colors.accentText} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textPrimary }}>เปลี่ยน PIN 4 หลัก</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* System Notification Toggles */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="bell-outline" size={20} color={colors.accentText} />
                  <Text style={styles.sectionTitle}>การสวิตช์ระบบการเตือน</Text>
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.dangerBg }]}>
                      <MaterialCommunityIcons name="run-fast" size={20} color={colors.dangerText} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>แจ้งเตือนเมื่อตรวจพบการล้ม</Text>
                      <Text style={styles.cardSubtitle}>แจ้งเตือนเมื่อสงสัยว่ามีคนล้ม</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    accessibilityLabel="เตือนเมื่อล้ม" value={fallAlerts}
                    onValueChange={setFallAlerts}
                  />
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentBg }]}>
                      <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.accentText} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>สรุปกิจกรรมรายวัน</Text>
                      <Text style={styles.cardSubtitle}>Activity Summaries</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    accessibilityLabel="สรุปกิจกรรม" value={activitySummary}
                    onValueChange={setActivitySummary}
                  />
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.inputBg }]}>
                      <MaterialCommunityIcons name="message-text-outline" size={20} color={colors.textSecondary} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ส่ง SMS ฉุกเฉิน</Text>
                      <Text style={styles.cardSubtitle}>Emergency SMS</Text>
                    </View>
                  </View>
                  <SettingSwitch
                    accessibilityLabel="ข้อความฉุกเฉิน" value={emergencySms}
                    onValueChange={setEmergencySms}
                  />
                </View>
              </View>
            </View>
          )}

          {/* TAB 3: FAMILY & EMERGENCY CONTACTS */}
          {activeTab === 'family' && (
            <View>
              {/* Family Connection */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="account-group" size={20} color={colors.accentText} />
                  <Text style={styles.sectionTitle}>เชื่อมต่อกลุ่มครอบครัว</Text>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#34d399' }]}>
                      <MaterialCommunityIcons name="key-variant" size={20} color={colors.onAccent} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>รหัสครอบครัว</Text>
                      <Text style={styles.cardCode}>{familyCode}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.copyBtn} onPress={handleCopyFamilyCode}>
                    <MaterialCommunityIcons name="content-copy" size={20} color={colors.accentText} />
                    <Text style={styles.copyText}>คัดลอก</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#e2e8f0' }]}>
                      <MaterialCommunityIcons name="link-variant" size={20} color={colors.textSecondary} />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ลิงก์เชิญเข้าครอบครัว</Text>
                      <Text style={styles.cardSubtitle}>ส่งลิงก์/รหัส เพื่อเชิญสมาชิกเข้าบ้าน</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.shareBtn} onPress={handleShareFamilyCode}>
                    <MaterialCommunityIcons name="share-variant" size={16} color={colors.onAccent} />
                    <Text style={styles.shareText}>แชร์รหัส</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Emergency Contacts */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={colors.dangerText} />
                  <Text style={styles.sectionTitle}>รายชื่อติดต่อฉุกเฉิน</Text>
                </View>

                {contacts.map((contact) => (
                  <TouchableOpacity
                    key={contact.id}
                    style={contact.is_primary ? styles.contactCardPrimary : styles.contactCard}
                    onPress={() => handleCall(contact.phone)}
                  >
                    <View style={styles.cardLeft}>
                      <View style={[styles.iconCircle, { backgroundColor: colors.infoBg }]}>
                        <MaterialCommunityIcons name={(contact?.icon_name || 'account-outline') as any} size={20} color={colors.infoText} />
                      </View>
                      <View>
                        <Text style={styles.cardLabel}>{contact.name}</Text>
                        <Text style={styles.cardSubtitle}>{contact.phone}</Text>
                      </View>
                    </View>
                    <View style={styles.contactRight}>
                      {contact.is_primary && (
                        <View style={styles.primaryBadge}>
                          <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                        </View>
                      )}
                      <TouchableOpacity onPress={() => {
                        Alert.alert('จัดการรายชื่อ', contact.name, [
                          { text: 'โทรออก', onPress: () => handleCall(contact.phone) },
                          { text: 'แก้ไข', onPress: () => openEditContactModal(contact) },
                          { text: 'ลบ', style: 'destructive', onPress: () => handleDeleteContact(contact.id) },
                          { text: 'ยกเลิก', style: 'cancel' }
                        ]);
                      }} style={{ padding: 8 }}>
                        <MaterialCommunityIcons name="dots-vertical" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}

                {contacts.length === 0 && (
                  <View style={{ alignItems: 'center', marginVertical: 10 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>ยังไม่มีรายชื่อผู้ติดต่อฉุกเฉิน</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.addContactBtn} onPress={openAddContactModal}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.accentText} style={{ marginRight: 8 }} />
                  <Text style={styles.addContactText}>เพิ่มรายชื่อติดต่อฉุกเฉิน</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Contact Modal */}
      <Modal visible={showContactModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.modalOverlay, { paddingTop: insets.top + 20 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={[styles.modalContainer, { flexGrow: 0, maxHeight: '90%', backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingContactId ? 'แก้ไขรายชื่อ' : 'เพิ่มรายชื่อใหม่'}</Text>
              <TouchableOpacity onPress={() => setShowContactModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>ชื่อผู้ติดต่อ</Text>
                <TextInput
                  style={styles.input}
                  value={contactName}
                  onChangeText={setContactName}
                  placeholder="เช่น ลูกชาย, ศูนย์กู้ภัย"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>เบอร์มือถือ 10 หลัก</Text>
                <TextInput
                  style={styles.input}
                  value={contactPhone}
                  onChangeText={(value) => setContactPhone(normalizeMobilePhoneInput(value))}
                  keyboardType="number-pad"
                  maxLength={MOBILE_PHONE_LENGTH}
                  placeholder="08XXXXXXXX"
                />
              </View>
              <View style={styles.settingCard}>
                <View>
                  <Text style={styles.cardLabel}>ตั้งเป็นรายชื่อหลัก (Primary)</Text>
                  <Text style={styles.cardSubtitle}>ผู้ติดต่ออันดับแรกในกรณีฉุกเฉิน</Text>
                </View>
                <SettingSwitch
                  accessibilityLabel="ผู้ติดต่อหลัก" value={contactPrimary}
                  onValueChange={setContactPrimary}
                />
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveContact} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.saveBtnText}>บันทึกข้อมูล</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* PIN is committed only after the two entries match. */}
      <Modal visible={showPinModal} transparent animationType="fade" onRequestClose={closePinModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.modalOverlay, { paddingTop: insets.top + 20 }]}>
          <ScrollView style={[styles.modalContainer, { flexGrow: 0, maxHeight: '90%', backgroundColor: colors.card }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>ตั้งค่า PIN {PIN_LENGTH} หลัก</Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>กรอกรหัสสองครั้งเพื่อป้องกันการพิมพ์ผิด</Text>
            <Text style={{ color: colors.textPrimary }}>PIN ใหม่</Text>
            <TextInput style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 24, textAlign: 'center', marginVertical: 12 }]}
              accessibilityLabel="PIN ใหม่" keyboardType="number-pad" maxLength={PIN_LENGTH} secureTextEntry value={newPin}
              editable={!savingPin} onChangeText={value => { setNewPin(normalizePin(value)); setPinError(null); }} placeholder="••••" placeholderTextColor={colors.textMuted} />
            <Text style={{ color: colors.textPrimary }}>ยืนยัน PIN อีกครั้ง</Text>
            <TextInput style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 24, textAlign: 'center', marginVertical: 12 }]}
              accessibilityLabel="ยืนยัน PIN อีกครั้ง" keyboardType="number-pad" maxLength={PIN_LENGTH} secureTextEntry value={confirmPin}
              editable={!savingPin} onChangeText={value => { setConfirmPin(normalizePin(value)); setPinError(null); }} placeholder="••••" placeholderTextColor={colors.textMuted} />
            {pinError && <Text accessibilityRole="alert" style={{ color: colors.dangerText }}>{pinError}</Text>}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingBottom: Math.max(insets.bottom, 12) }}>
              <TouchableOpacity accessibilityRole="button" style={[styles.saveBtn, { flex: 1, minHeight: 48, backgroundColor: colors.inputBg }]} disabled={savingPin} onPress={closePinModal}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.saveBtn, { flex: 1, minHeight: 48, backgroundColor: colors.accent }]} disabled={savingPin} onPress={handleSavePin}>
                {savingPin ? <ActivityIndicator color={colors.onAccent} /> : <Text style={{ color: colors.onAccent, fontWeight: '700' }}>บันทึก PIN</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showChangePasswordModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.modalOverlay, { paddingTop: insets.top + 20 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={[styles.modalContainer, { flexGrow: 0, maxHeight: '90%', backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>เปลี่ยนรหัสผ่านใหม่</Text>
              <TouchableOpacity onPress={() => setShowChangePasswordModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</Text>
                <TextInput
                  style={styles.input}
                  value={newAccountPassword}
                  onChangeText={setNewAccountPassword}
                  placeholder="พิมพ์รหัสผ่านใหม่..."
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>ยืนยันรหัสผ่านใหม่</Text>
                <TextInput
                  style={styles.input}
                  value={confirmAccountPassword}
                  onChangeText={setConfirmAccountPassword}
                  placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง..."
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleChangePassword} disabled={changingPassword}>
                {changingPassword ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.saveBtnText}>บันทึกรหัสผ่านใหม่</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: colors.accentBg,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.accentText,
    letterSpacing: 1,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.card,
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  profileSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  formSection: {
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginLeft: 8,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  cardCode: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.accentText,
    letterSpacing: 2,
  },
  cardSubtitle: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  copyBtn: {
    alignItems: 'center',
  },
  copyText: {
    fontSize: 10,
    color: colors.accentText,
    fontWeight: 'bold',
    marginTop: 2,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  shareText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  settingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  contactCardPrimary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  contactCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  contactRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  primaryBadgeText: {
    color: colors.onAccent,
    fontSize: 8,
    fontWeight: 'bold',
  },
  addContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: 8,
    marginTop: 4,
  },
  addContactText: {
    color: colors.accentText,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionsContainer: {
    marginTop: 8,
  },
  saveBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveBtnText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  cancelBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.dangerText,
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  modalBody: {
    marginTop: 8,
  }
});
