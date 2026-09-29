import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { supabase } from '../lib/supabase';
import { getAuthErrorMessage } from '../lib/friendlyError';
import { isValidMobilePhone, MOBILE_PHONE_LENGTH, normalizeMobilePhoneInput } from '../lib/phone';

export default function RegisterScreen() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName || !email || !phone || !password || !confirmPassword) {
      Alert.alert(
        'ข้อมูลไม่ครบถ้วน',
        'กรุณากรอกข้อมูลในช่องว่างให้ครบทุกช่องเพื่อดำเนินการต่อ'
      );
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(
        'รหัสผ่านไม่ตรงกัน',
        'รหัสผ่านและการยืนยันรหัสผ่านที่คุณกรอกไม่ตรงกัน กรุณาตรวจสอบและพิมพ์ใหม่อีกครั้ง'
      );
      return;
    }
    if (!isValidMobilePhone(phone)) {
      Alert.alert('เบอร์มือถือไม่ถูกต้อง', 'กรุณากรอกเบอร์มือถือ 10 หลัก โดยขึ้นต้นด้วย 0');
      return;
    }
    if (password.length < 8) {
      Alert.alert(
        'รหัสผ่านสั้นเกินไป',
        'เพื่อความปลอดภัย รหัสผ่านของคุณจะต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป'
      );
      return;
    }
    if (!agreeTerms) {
      Alert.alert(
        'ยังไม่ได้ยอมรับเงื่อนไข',
        'กรุณาติ๊กถูกที่ช่อง "ฉันยอมรับเงื่อนไขการใช้งาน" ก่อนทำการลงทะเบียน'
      );
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: Linking.createURL('/login'),
        data: {
          full_name: fullName.trim(),
          phone: normalizeMobilePhoneInput(phone),
        }
      }
    });

    setLoading(false);

    if (error) {
      Alert.alert('ลงทะเบียนไม่สำเร็จ', getAuthErrorMessage(error));
    } else if (data.session) {
      Alert.alert(
        '🎉 สมัครสมาชิกสำเร็จ!',
        'สร้างบัญชีเรียบร้อยแล้ว ขั้นต่อไปให้สร้างหรือเข้าร่วมครอบครัว',
        [{ text: 'ตกลง', onPress: () => router.replace('/family-setup') }]
      );
    } else {
      Alert.alert(
        'กรุณายืนยันอีเมล',
        'ระบบส่งลิงก์ยืนยันไปที่อีเมลแล้ว เมื่อยืนยันเสร็จให้กลับมาเข้าสู่ระบบ',
        [{ text: 'ไปหน้าเข้าสู่ระบบ', onPress: () => router.replace('/login') }]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* =========================================================
            1. TOP NAVBAR
           ========================================================= */}
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#16a34a" />
            <Text style={styles.navLogoText}>LookLanCare</Text>
          </TouchableOpacity>
        </View>

        {/* =========================================================
            2. LOGO ILLUSTRATION AREA
           ========================================================= */}
        <View style={styles.imageContainer}>
          <View style={styles.imageContainer}>
            <Image source={require('@/assets/images/iconlnw.png')} style={styles.logoImage} />
          </View>
        </View>

        {/* =========================================================
            3. HEADER
           ========================================================= */}
        <View style={styles.welcomeGroup}>
          <Text style={styles.title}>ลงทะเบียนสมาชิกใหม่</Text>
          <Text style={styles.subtitle}>เริ่มต้นดูแลคนที่คุณรักได้ง่ายๆ</Text>
        </View>

        {/* =========================================================
            4. REGISTER FORM CARD
           ========================================================= */}
        <View style={styles.card}>

          {/* ชื่อ-นามสกุล */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="account-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>ชื่อ-นามสกุล</Text>
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="ระบุชื่อและนามสกุลจริง"
                placeholderTextColor="#9ca3af"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
          </View>

          {/* อีเมล */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="email-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>อีเมล</Text>
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="abcde@gmail.com"
                placeholderTextColor="#9ca3af"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* เบอร์โทรศัพท์ */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="phone-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>เบอร์มือถือ 10 หลัก</Text>
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="08XXXXXXXX"
                placeholderTextColor="#9ca3af"
                value={phone}
                onChangeText={(value) => setPhone(normalizeMobilePhoneInput(value))}
                keyboardType="number-pad"
                maxLength={MOBILE_PHONE_LENGTH}
              />
            </View>
          </View>

          {/* รหัสผ่าน & ยืนยันรหัสผ่าน (แบ่งครึ่ง) */}
          <View style={styles.rowWrapper}>
            <View style={[styles.inputWrapper, { flex: 1, marginRight: 8 }]}>
              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="lock-outline" size={16} color="#16a34a" />
                <Text style={styles.label}>รหัสผ่าน</Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.inputSmall}
                  placeholder="รหัสผ่าน 8 ตัวขึ้นไป"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.inputIconRight} onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.inputWrapper, { flex: 1, marginLeft: 8 }]}>
              <View style={styles.labelRow}>
                <MaterialCommunityIcons name="shield-check-outline" size={16} color="#16a34a" />
                <Text style={styles.label}>ยืนยันรหัสผ่าน</Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.inputSmall}
                  placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                  placeholderTextColor="#9ca3af"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
              </View>
            </View>
          </View>

          {/* เงื่อนไขการใช้งาน */}
          <View style={styles.termsContainer}>
            <TouchableOpacity
              style={[styles.checkbox, agreeTerms && styles.checkboxChecked]}
              onPress={() => setAgreeTerms(!agreeTerms)}
            >
              {agreeTerms && <MaterialCommunityIcons name="check" size={14} color="#ffffff" />}
            </TouchableOpacity>
            <Text style={styles.termsText}>
              ฉันยอมรับ <Text style={styles.termsLink}>เงื่อนไขการใช้งาน</Text> และนโยบายความเป็นส่วนตัวของ LookLanCare
            </Text>
          </View>

          {/* กลับไปเข้าสู่ระบบ */}
          <View style={styles.loginHintContainer}>
            <Text style={styles.loginHint}>มีบัญชีอยู่แล้ว? </Text>
            <TouchableOpacity onPress={() => router.push('/login')}>
              <Text style={styles.loginLink}>เข้าสู่ระบบ</Text>
            </TouchableOpacity>
          </View>

          {/* ปุ่มลงทะเบียน */}
          <View style={styles.registerBtnShadow}>
            <TouchableOpacity
              style={styles.registerSubmitBtn}
              activeOpacity={0.8}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Text style={styles.registerSubmitBtnText}>ลงทะเบียน</Text>
                  <MaterialCommunityIcons name="arrow-right" size={20} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>
          </View>

        </View>

        {/* =========================================================
            5. FOOTER BADGES
           ========================================================= */}
        <View style={styles.footerBadges}>
          <View style={styles.footerBadgeItem}>
            <MaterialCommunityIcons name="shield-check-outline" size={16} color="#64748b" />
            <Text style={styles.footerBadgeText}>Data Secure</Text>
          </View>
          <View style={styles.footerBadgeItem}>
            <MaterialCommunityIcons name="hand-heart-outline" size={16} color="#64748b" />
            <Text style={styles.footerBadgeText}>Reliable Care</Text>
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContainer: {
    alignItems: 'center',
    paddingBottom: 40,
    flexGrow: 1,
  },
  navbar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navLogoText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  imageContainer: {
    marginTop: 24,
    marginBottom: 16,
  },
  imagePlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: '#dcfce7',
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderStyle: 'solid',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  placeholderText: {
    fontSize: 12,
    color: '#16a34a',
    textAlign: 'center',
    opacity: 0.6,
  },
  welcomeGroup: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#16a34a', // สีเขียวในหน้าลงทะเบียน
    marginBottom: 6,
  },
  logoImage: {
    width: 160,
    height: 160,
    borderRadius: 36,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  card: {
    width: '90%',
    maxWidth: 380,
    paddingHorizontal: 10,
  },
  inputWrapper: {
    marginBottom: 16,
  },
  rowWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    height: 48,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingLeft: 14,
    paddingRight: 14,
    fontSize: 14,
    color: '#1e293b',
  },
  inputSmall: {
    flex: 1,
    height: '100%',
    paddingLeft: 10,
    paddingRight: 36,
    fontSize: 12,
    color: '#1e293b',
  },
  inputIconRight: {
    position: 'absolute',
    right: 10,
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    borderRadius: 4,
    marginRight: 12,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  termsLink: {
    color: '#16a34a',
    fontWeight: 'bold',
  },
  loginHintContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  loginHint: {
    fontSize: 13,
    color: '#475569',
  },
  loginLink: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  registerBtnShadow: {
    backgroundColor: '#064e3b',
    borderRadius: 12,
    paddingBottom: 4,
  },
  registerSubmitBtn: {
    backgroundColor: '#16a34a',
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  registerSubmitBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footerBadges: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 32,
  },
  footerBadgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerBadgeText: {
    fontSize: 12,
    color: '#64748b',
  }
});
