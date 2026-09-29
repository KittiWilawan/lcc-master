import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { signOutCurrentDevice } from '../lib/authSession';
import {
  callPhoneNumber, isValidMobilePhone, MOBILE_PHONE_LENGTH, normalizeMobilePhoneInput,
} from '../lib/phone';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { registerForPushNotificationsAsync, sendLocalTestNotification } from '../lib/pushNotifications';

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
  const { section, action } = useLocalSearchParams<{ section?: string; action?: string }>();
  const insets = useSafeAreaInsets();
  const { isDarkMode, toggleDarkMode, seniorMode, toggleSeniorMode, colors } = useTheme();

  // State 
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [testingAppNotification, setTestingAppNotification] = useState(false);
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
        setShowPinModal(true);
      } else {
        await AsyncStorage.setItem('@app_lock_enabled', 'true');
        setAppLockEnabled(true);
        Alert.alert('เปิดใช้งานแล้ว 🔐', 'ระบบจะถาม PIN/Biometric เมื่อเปิดแอป');
      }
    } else {
      await AsyncStorage.setItem('@app_lock_enabled', 'false');
      setAppLockEnabled(false);
      Alert.alert('ปิดใช้งานแล้ว', 'ยกเลิกการล็อกแอปเรียบร้อย');
    }
  };

  const handleSavePin = async () => {
    if (newPin.length !== 4) {
      Alert.alert('แจ้งเตือน', 'กรุณากรอก PIN ให้ครบ 4 หลัก');
      return;
    }
    await AsyncStorage.setItem('@app_lock_pin', newPin);
    await AsyncStorage.setItem('@app_lock_enabled', 'true');
    setAppLockEnabled(true);
    setShowPinModal(false);
    setNewPin('');
    Alert.alert('สำเร็จ! 🎉', 'ตั้งค่า PIN 4 หลัก และเปิดใช้งานการล็อกแอปเรียบร้อยแล้ว');
  };

  const handleTestAppNotification = async () => {
    try {
      setTestingAppNotification(true);
      const enabled = await registerForPushNotificationsAsync();
      if (!enabled) {
        Alert.alert('ยังไม่ได้เปิดการแจ้งเตือน', 'กรุณาอนุญาตการแจ้งเตือนของ LookLanCare ในการตั้งค่ามือถือ');
        return;
      }

      const sent = await sendLocalTestNotification();
      Alert.alert(
        sent ? 'ทดสอบสำเร็จ' : 'ทดสอบไม่สำเร็จ',
        sent
          ? 'การแจ้งเตือนบนมือถือเครื่องนี้ทำงานแล้ว'
          : 'กรุณาตรวจสิทธิ์การแจ้งเตือนแล้วลองอีกครั้ง',
      );
    } catch (error) {
      Alert.alert('ทดสอบไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setTestingAppNotification(false);
    }
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
    Alert.alert('คัดลอกรหัสแล้ว 📋', `รหัสครอบครัว: ${familyCode}`);
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
      Alert.alert('เกิดข้อผิดพลาดในการออกจากระบบ', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newAccountPassword || !confirmAccountPassword) {
      Alert.alert('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกรหัสผ่านใหม่และยืนยันรหัสผ่าน');
      return;
    }
    if (newAccountPassword !== confirmAccountPassword) {
      Alert.alert('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    if (newAccountPassword.length < 8) {
      Alert.alert('รหัสผ่านสั้นเกินไป', 'เพื่อความปลอดภัย รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป');
      return;
    }

    try {
      setChangingPassword(true);
      const { error } = await supabase.auth.updateUser({ password: newAccountPassword });
      if (error) throw error;

      Alert.alert('สำเร็จ! 🎉', 'เปลี่ยนรหัสผ่านของคุณเรียบร้อยแล้ว');
      setShowChangePasswordModal(false);
      setNewAccountPassword('');
      setConfirmAccountPassword('');
    } catch (e: any) {
      Alert.alert('เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน', e.message);
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
        Alert.alert('เบอร์มือถือไม่ถูกต้อง', 'กรุณากรอกเบอร์มือถือ 10 หลัก โดยขึ้นต้นด้วย 0');
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

      Alert.alert('สำเร็จ', 'บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว');
      router.back();
    } catch (error) {
      if (error instanceof Error) {
        Alert.alert('เกิดข้อผิดพลาดในการบันทึก', error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCall = async (phone: string) => {
    const opened = await callPhoneNumber(phone);
    if (!opened) Alert.alert('โทรออกไม่ได้', 'กรุณาตรวจเบอร์ผู้ติดต่อ หรือโทรจากอุปกรณ์ที่รองรับการโทร');
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
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อและเบอร์มือถือ 10 หลัก โดยขึ้นต้นด้วย 0');
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
      Alert.alert('บันทึกผู้ติดต่อไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = (id: string) => {
    Alert.alert('ยืนยันการลบ', 'คุณแน่ใจหรือไม่ว่าต้องการลบรายชื่อนี้?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ', style: 'destructive', onPress: async () => {
          setSaving(true);
          try {
            const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
            if (error) throw error;
            loadProfile();
          } catch (error: any) {
            Alert.alert('Error', error.message);
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
          <ActivityIndicator size="large" color="#059669" />
          <Text style={{ marginTop: 12, color: colors.textSecondary }}>กำลังโหลดข้อมูล...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>

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
                backgroundColor: activeTab === 'profile' ? (isDarkMode ? '#334155' : '#ffffff') : 'transparent',
                elevation: activeTab === 'profile' ? 2 : 0,
              }}
              onPress={() => setActiveTab('profile')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'profile' ? (isDarkMode ? '#34d399' : '#059669') : colors.textSecondary,
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
                backgroundColor: activeTab === 'settings' ? (isDarkMode ? '#334155' : '#ffffff') : 'transparent',
                elevation: activeTab === 'settings' ? 2 : 0,
              }}
              onPress={() => setActiveTab('settings')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'settings' ? (isDarkMode ? '#34d399' : '#059669') : colors.textSecondary,
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
                backgroundColor: activeTab === 'family' ? (isDarkMode ? '#334155' : '#ffffff') : 'transparent',
                elevation: activeTab === 'family' ? 2 : 0,
              }}
              onPress={() => setActiveTab('family')}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: activeTab === 'family' ? (isDarkMode ? '#34d399' : '#059669') : colors.textSecondary,
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
                      <MaterialCommunityIcons name="account-plus-outline" size={40} color="#94a3b8" />
                    )}
                  </View>
                  <View style={styles.cameraBadge}>
                    <MaterialCommunityIcons name="camera" size={16} color="#ffffff" />
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
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 4, marginBottom: 12 }}
                  onPress={() => setShowChangePasswordModal(true)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.iconCircle, { backgroundColor: '#fef3c7' }]}>
                      <MaterialCommunityIcons name="lock-reset" size={20} color="#d97706" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>เปลี่ยนรหัสผ่าน (Change Password)</Text>
                      <Text style={styles.cardSubtitle}>ตั้งค่ารหัสผ่านใหม่สำหรับเข้าสู่ระบบ</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Save & Logout Buttons */}
              <View style={styles.actionsContainer}>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.saveBtnText}>บันทึกข้อมูลโปรไฟล์</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.cancelBtn, { backgroundColor: '#fef2f2', borderColor: '#fca5a5', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 }]}
                  onPress={handleLogout}
                  disabled={saving}
                >
                  <MaterialCommunityIcons name="logout" size={18} color="#dc2626" style={{ marginRight: 6 }} />
                  <Text style={[styles.cancelBtnText, { color: '#dc2626', fontWeight: '800' }]}>ออกจากระบบ (Logout)</Text>
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
                  <MaterialCommunityIcons name="bell-ring-outline" size={20} color="#059669" />
                  <Text style={styles.sectionTitle}>แจ้งเตือนในแอป</Text>
                </View>

                <View style={{ backgroundColor: '#ffffff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' }}>
                  <View style={{ backgroundColor: '#ecfdf5', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#a7f3d0', marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, color: '#047857', fontWeight: '800', marginBottom: 4 }}>ใช้ฟรีและไม่ต้องเชื่อมบัญชีอื่น</Text>
                    <Text style={{ fontSize: 11, color: '#475569', lineHeight: 17 }}>
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
                      <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '800' }}>ทดสอบการแจ้งเตือนบนมือถือเครื่องนี้</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={{ fontSize: 10, color: '#64748b', lineHeight: 15, marginTop: 8, textAlign: 'center' }}>
                    ปุ่มนี้ทดสอบเฉพาะมือถือเครื่องนี้ การแจ้งเตือนจากคอมขณะปิดแอปต้องเชื่อมบริการแจ้งเตือน Android ก่อน
                  </Text>
                </View>
              </View>

              {/* Security & Theme Settings */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="shield-account-outline" size={20} color="#059669" />
                  <Text style={styles.sectionTitle}>ความปลอดภัย & การแสดงผล</Text>
                </View>

                <View style={[styles.settingCard, seniorMode && { borderColor: '#059669', borderWidth: 2 }]}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#dcfce7' }]}>
                      <MaterialCommunityIcons name="human-cane" size={22} color="#047857" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardLabel, { fontSize: 16 }]}>โหมดผู้สูงอายุ</Text>
                      <Text style={[styles.cardSubtitle, { fontSize: 13, lineHeight: 19 }]}>หน้าหลักเรียบง่าย ตัวอักษรและปุ่มใหญ่ขึ้น</Text>
                    </View>
                  </View>
                  <Switch
                    value={seniorMode}
                    onValueChange={toggleSeniorMode}
                    trackColor={{ false: '#94a3b8', true: '#059669' }}
                    thumbColor="#ffffff"
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
                  <Switch
                    value={isDarkMode}
                    onValueChange={toggleDarkMode}
                    trackColor={{ false: '#cbd5e1', true: '#4f46e5' }}
                    thumbColor={'#ffffff'}
                  />
                </View>

                {/* App Lock Card */}
                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#ecfdf5' }]}>
                      <MaterialCommunityIcons name="lock-check-outline" size={20} color="#059669" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ล็อกแอปด้วยรหัส</Text>
                      <Text style={styles.cardSubtitle}>ถาม PIN 4 หลัก / สแกนนิ้วเมื่อเปิดแอป</Text>
                    </View>
                  </View>
                  <Switch
                    value={appLockEnabled}
                    onValueChange={handleToggleAppLock}
                    trackColor={{ false: '#cbd5e1', true: '#059669' }}
                    thumbColor={'#ffffff'}
                  />
                </View>

                {appLockEnabled && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 6 }}
                    onPress={() => setShowPinModal(true)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name="key-change" size={18} color="#059669" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#0f172a' }}>เปลี่ยน PIN 4 หลัก</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={18} color="#64748b" />
                  </TouchableOpacity>
                )}
              </View>

              {/* System Notification Toggles */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="bell-outline" size={20} color="#059669" />
                  <Text style={styles.sectionTitle}>การสวิตช์ระบบการเตือน</Text>
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#fee2e2' }]}>
                      <MaterialCommunityIcons name="run-fast" size={20} color="#dc2626" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>แจ้งเตือนเมื่อตรวจพบการล้ม</Text>
                      <Text style={styles.cardSubtitle}>แจ้งเตือนเมื่อสงสัยว่ามีคนล้ม</Text>
                    </View>
                  </View>
                  <Switch
                    value={fallAlerts}
                    onValueChange={setFallAlerts}
                    trackColor={{ false: '#cbd5e1', true: '#059669' }}
                    thumbColor={'#ffffff'}
                  />
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#dcfce7' }]}>
                      <MaterialCommunityIcons name="file-document-outline" size={20} color="#059669" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>สรุปกิจกรรมรายวัน</Text>
                      <Text style={styles.cardSubtitle}>Activity Summaries</Text>
                    </View>
                  </View>
                  <Switch
                    value={activitySummary}
                    onValueChange={setActivitySummary}
                    trackColor={{ false: '#cbd5e1', true: '#059669' }}
                    thumbColor={'#ffffff'}
                  />
                </View>

                <View style={styles.settingCard}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#f1f5f9' }]}>
                      <MaterialCommunityIcons name="message-text-outline" size={20} color="#64748b" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ส่ง SMS ฉุกเฉิน</Text>
                      <Text style={styles.cardSubtitle}>Emergency SMS</Text>
                    </View>
                  </View>
                  <Switch
                    value={emergencySms}
                    onValueChange={setEmergencySms}
                    trackColor={{ false: '#cbd5e1', true: '#059669' }}
                    thumbColor={'#ffffff'}
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
                  <MaterialCommunityIcons name="account-group" size={20} color="#059669" />
                  <Text style={styles.sectionTitle}>เชื่อมต่อกลุ่มครอบครัว</Text>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#34d399' }]}>
                      <MaterialCommunityIcons name="key-variant" size={20} color="#ffffff" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>รหัสครอบครัว</Text>
                      <Text style={styles.cardCode}>{familyCode}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.copyBtn} onPress={handleCopyFamilyCode}>
                    <MaterialCommunityIcons name="content-copy" size={20} color="#059669" />
                    <Text style={styles.copyText}>คัดลอก</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#e2e8f0' }]}>
                      <MaterialCommunityIcons name="link-variant" size={20} color="#64748b" />
                    </View>
                    <View>
                      <Text style={styles.cardLabel}>ลิงก์เชิญเข้าครอบครัว</Text>
                      <Text style={styles.cardSubtitle}>ส่งลิงก์/รหัส เพื่อเชิญสมาชิกเข้าบ้าน</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.shareBtn} onPress={handleShareFamilyCode}>
                    <MaterialCommunityIcons name="share-variant" size={16} color="#ffffff" />
                    <Text style={styles.shareText}>แชร์รหัส</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Emergency Contacts */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="map-marker-radius-outline" size={20} color="#dc2626" />
                  <Text style={styles.sectionTitle}>รายชื่อติดต่อฉุกเฉิน</Text>
                </View>

                {contacts.map((contact) => (
                  <TouchableOpacity
                    key={contact.id}
                    style={contact.is_primary ? styles.contactCardPrimary : styles.contactCard}
                    onPress={() => handleCall(contact.phone)}
                  >
                    <View style={styles.cardLeft}>
                      <View style={[styles.iconCircle, { backgroundColor: '#e0f2fe' }]}>
                        <MaterialCommunityIcons name={(contact?.icon_name || 'account-outline') as any} size={20} color="#0284c7" />
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
                        <MaterialCommunityIcons name="dots-vertical" size={20} color="#94a3b8" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}

                {contacts.length === 0 && (
                  <View style={{ alignItems: 'center', marginVertical: 10 }}>
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>ยังไม่มีรายชื่อผู้ติดต่อฉุกเฉิน</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.addContactBtn} onPress={openAddContactModal}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#059669" style={{ marginRight: 8 }} />
                  <Text style={styles.addContactText}>เพิ่มรายชื่อติดต่อฉุกเฉิน</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </ScrollView>
      )}

      {/* Contact Modal */}
      <Modal visible={showContactModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingContactId ? 'แก้ไขรายชื่อ' : 'เพิ่มรายชื่อใหม่'}</Text>
              <TouchableOpacity onPress={() => setShowContactModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
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
                <Switch
                  value={contactPrimary}
                  onValueChange={setContactPrimary}
                  trackColor={{ false: '#cbd5e1', true: '#dc2626' }}
                  thumbColor={'#ffffff'}
                />
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveContact} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>บันทึกข้อมูล</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* PIN Setup Modal */}
      <Modal visible={showPinModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { padding: 24, borderRadius: 20 }]}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={[styles.iconCircle, { width: 56, height: 56, borderRadius: 28, backgroundColor: '#ecfdf5', marginBottom: 10 }]}>
                <MaterialCommunityIcons name="shield-key" size={28} color="#059669" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>ตั้งค่า PIN 4 หลัก</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4, textAlign: 'center' }}>
                กำหนด PIN สำหรับปลดล็อกแอป LookLanCare เพื่อป้องกันข้อมูลผู้สูงอายุ
              </Text>
            </View>

            <TextInput
              style={[styles.input, { fontSize: 24, fontWeight: '900', letterSpacing: 12, textAlign: 'center', marginVertical: 12 }]}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              value={newPin}
              onChangeText={setNewPin}
              placeholder="••••"
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: '#f1f5f9' }]}
                onPress={() => { setShowPinModal(false); setNewPin(''); }}
              >
                <Text style={{ color: '#64748b', fontWeight: '700' }}>ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: '#059669' }]}
                onPress={handleSavePin}
              >
                <Text style={{ color: '#ffffff', fontWeight: '700' }}>บันทึก PIN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showChangePasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>เปลี่ยนรหัสผ่านใหม่</Text>
              <TouchableOpacity onPress={() => setShowChangePasswordModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
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
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>บันทึกรหัสผ่านใหม่</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: '#ecfdf5',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#059669',
    letterSpacing: 1,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    borderColor: '#059669',
    backgroundColor: '#f8fafc',
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
    borderColor: '#ffffff',
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  profileSubtitle: {
    fontSize: 12,
    color: '#64748b',
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
    color: '#0f172a',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
    color: '#0f172a',
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
    color: '#0f172a',
    marginLeft: 8,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
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
    color: '#0f172a',
  },
  cardCode: {
    fontSize: 16,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: 2,
  },
  cardSubtitle: {
    fontSize: 10,
    color: '#64748b',
  },
  copyBtn: {
    alignItems: 'center',
  },
  copyText: {
    fontSize: 10,
    color: '#059669',
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
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  settingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
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
    backgroundColor: '#ffffff',
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
    backgroundColor: '#ffffff',
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
    color: '#ffffff',
    fontSize: 8,
    fontWeight: 'bold',
  },
  addContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#059669',
    borderStyle: 'dashed',
    borderRadius: 8,
    marginTop: 4,
  },
  addContactText: {
    color: '#059669',
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
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cancelBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
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
    color: '#0f172a',
  },
  modalBody: {
    marginTop: 8,
  }
});
