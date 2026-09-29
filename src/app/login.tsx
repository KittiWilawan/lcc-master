import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase, checkAndSaveUserFamily } from '../lib/supabase';
import { getAuthErrorMessage, getFriendlyErrorMessage } from '../lib/friendlyError';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert(
        'ข้อมูลไม่ครบถ้วน', 
        'กรุณากรอก "อีเมล" และ "รหัสผ่าน" ให้ครบถ้วนเพื่อเข้าสู่ระบบครับ'
      );
      return;
    }

    setLoading(true);
    try {
      const { data: loginData, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        Alert.alert('เข้าสู่ระบบไม่สำเร็จ', getAuthErrorMessage(error));
        return;
      }
      const userId = loginData?.session?.user?.id;
      let hasFamily = false;

      if (userId) {
        const familyInfo = await checkAndSaveUserFamily(userId);
        if (familyInfo?.familyId) {
          hasFamily = true;
        }
      }

      if (hasFamily) {
        Alert.alert(
          'ยินดีต้อนรับกลับ!', 
          'เข้าสู่ระบบเรียบร้อยแล้ว กำลังพาท่านเข้าสู่หน้าหลัก...'
        );
        router.replace('/(tabs)/home');
      } else {
        Alert.alert(
          'เข้าสู่ระบบสำเร็จ', 
          'กรุณาตั้งค่าหรือเข้าร่วมครอบครัวเพื่อเริ่มใช้งาน...'
        );
        router.replace('/family-setup');
      }
    } catch (error: unknown) {
      Alert.alert('เข้าสู่ระบบไม่สำเร็จ', getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ใช้ ScrollView เพื่อให้หน้าจอไม่ล้นเวลาคีย์บอร์ดเด้งขึ้นมา */}
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>

        {/* =========================================================
            1. TOP NAVBAR
           ========================================================= */}
        <View style={styles.navbar}>
          <View style={styles.navLogoGroup}>
            <Text style={[styles.logoText, { color: '#3cdb7e' }]}>Look</Text>
            <Text style={[styles.logoText, { color: '#15803d' }]}>Lan</Text>
            <Text style={[styles.logoText, { color: '#3cdb7e' }]}>Care</Text>
          </View>
          <View style={styles.diamondIcon}>
            <Text style={styles.diamondText}>!</Text>
          </View>
        </View>

        {/* =========================================================
            2. LOGO ILLUSTRATION AREA (ช่องว่างรูปภาพ)
           ========================================================= */}
        <View style={styles.imageContainer}>
          <Image source={require('@/assets/images/iconlnw.png')} style={styles.logoImage} />
        </View>

        {/* =========================================================
            3. WELCOME HEADER
           ========================================================= */}
        <View style={styles.welcomeGroup}>
          <Text style={styles.title}>ยินดีต้อนรับกลับ</Text>
          <Text style={styles.subtitle}>เข้าสู่ระบบเพื่อดูแลคนที่คุณรักต่อได้ทันที</Text>
        </View>

        {/* =========================================================
            4. LOGIN FORM CARD
           ========================================================= */}
        <View style={styles.card}>

          {/* ช่องกรอกอีเมล */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>อีเมล</Text>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons name="email-outline" size={20} color="#9ca3af" style={styles.inputIconLeft} />
              <TextInput
                style={styles.input}
                placeholder="abcde@gmail.com"
                placeholderTextColor="#d1d5db"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* ช่องกรอกรหัสผ่าน */}
          <View style={styles.inputWrapper}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.label}>รหัสผ่าน</Text>
              <TouchableOpacity onPress={() => router.push('/forgot-password')}>
                <Text style={styles.forgotPassword}>ลืมรหัสผ่าน?</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons name="lock-outline" size={20} color="#9ca3af" style={styles.inputIconLeft} />
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#d1d5db"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.inputIconRight} onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>

          {/* ปุ่มเข้าสู่ระบบ (ทำเอฟเฟกต์ปุ่มหนา/มีเงาด้านหลัง) */}
          <View style={styles.loginBtnShadow}>
            <TouchableOpacity
              style={styles.loginBtn}
              activeOpacity={0.8}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#1e293b" />
              ) : (
                <>
                  <Text style={styles.loginBtnText}>เข้าสู่ระบบ</Text>
                  <MaterialCommunityIcons name="login" size={20} color="#1e293b" />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ปุ่มลงทะเบียนใหม่ */}
          <View style={styles.registerGroup}>
            <Text style={styles.registerHint}>ยังไม่มีบัญชีใช่ไหม?</Text>
            <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register')}>
              <Text style={styles.registerBtnText}>ลงทะเบียนใหม่</Text>
            </TouchableOpacity>
          </View>

        </View>

        {/* =========================================================
            5. FEATURE BADGES (การ์ดเล็ก 2 ฝั่งด้านล่าง)
           ========================================================= */}
        <View style={styles.badgeGrid}>

          {/* การ์ดผู้เชี่ยวชาญ */}
          <View style={styles.badgeItem}>
            <View style={styles.badgeIconBox}>
              <MaterialCommunityIcons name="shield-check" size={18} color="#16a34a" />
            </View>
            <Text style={styles.badgeText}>
              ดูแลแบบ{"\n"}<Text style={{ fontWeight: 'bold', color: '#1e293b' }}>ผู้เชี่ยวชาญ</Text>
            </Text>
          </View>

          {/* การ์ดครอบครัว */}
          <View style={styles.badgeItem}>
            <View style={styles.badgeIconBox}>
              <MaterialCommunityIcons name="heart" size={18} color="#16a34a" />
            </View>
            <Text style={styles.badgeText}>
              อุ่นใจเหมือน{"\n"}<Text style={{ fontWeight: 'bold', color: '#1e293b' }}>คนในครอบครัว</Text>
            </Text>
          </View>

        </View>

        {/* =========================================================
            6. ACCESSIBILITY ICONS (ไอคอนคนแก่/คนพิการ ด้านล่างสุด)
           ========================================================= */}
        <View style={styles.footer}>
          <FontAwesome5 name="accessible-icon" size={24} color="#cbd5e1" />
          <FontAwesome5 name="blind" size={24} color="#cbd5e1" />
          <MaterialCommunityIcons name="ear-hearing" size={24} color="#cbd5e1" />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// =========================================================
// REACT NATIVE STYLESHEET (แยกไว้ด้านล่างตามคำขอครับ)
// =========================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc', // สีพื้นหลังขาวอมฟ้าอ่อนแบบในภาพ
  },
  scrollContainer: {
    alignItems: 'center',
    paddingBottom: 30,
  },

  // 1. Top Navbar
  navbar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  navLogoGroup: {
    flexDirection: 'row',
  },
  logoText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  diamondIcon: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#3cdb7e',
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
  },
  diamondText: {
    transform: [{ rotate: '-45deg' }],
    fontSize: 10,
    fontWeight: 'bold',
    color: '#3cdb7e',
    top: -1,
  },

  // 2. Image Area
  imageContainer: {
    marginTop: 24,
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  logoImage: {
    width: 160,
    height: 160,
    borderRadius: 36,
  },

  // 3. Welcome Text
  welcomeGroup: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#64748b',
  },

  // 4. Form Card & Inputs
  card: {
    width: '90%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3, // สำหรับเงาบน Android
  },
  inputWrapper: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#475569',
    marginBottom: 8,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forgotPassword: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    height: 54,
  },
  inputIconLeft: {
    paddingLeft: 14,
  },
  inputIconRight: {
    position: 'absolute',
    right: 14,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingLeft: 10,
    paddingRight: 40,
    fontSize: 16,
    color: '#1e293b',
  },

  // ปุ่มเข้าสู่ระบบที่มีมิติหนา
  loginBtnShadow: {
    backgroundColor: '#166534', // ส่วนสีเข้มด้านหลังที่หนาขึ้นมา
    borderRadius: 12,
    marginTop: 12,
    paddingBottom: 4,
  },
  loginBtn: {
    backgroundColor: '#3cdb7e',
    height: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loginBtnText: {
    color: '#1e293b',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // ปุ่มลงทะเบียน
  registerGroup: {
    alignItems: 'center',
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 16,
  },
  registerHint: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  registerBtn: {
    width: '100%',
    height: 54,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerBtnText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // 5. Feature Badgesด้านล่าง
  badgeGrid: {
    width: '90%',
    maxWidth: 360,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 20,
  },
  badgeItem: {
    flex: 1,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#e0f2fe',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badgeIconBox: {
    backgroundColor: '#ffffff',
    padding: 6,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  badgeText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },

  // 6. Footer Icons
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    marginTop: 40,
    width: '100%',
  },
});
