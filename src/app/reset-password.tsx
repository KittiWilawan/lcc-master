import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
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
import { signOutCurrentDevice } from '../lib/authSession';
import { getAuthErrorMessage } from '../lib/friendlyError';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ตรวจสอบว่าผู้ใช้มี Session อยู่หรือไม่ (ลิงก์จากอีเมลควรรีเซ็ต Session อัตโนมัติให้ชั่วคราว)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        Alert.alert('ข้อผิดพลาด', 'ไม่พบสิทธิ์การรีเซ็ตรหัสผ่าน กรุณากดลิงก์จากอีเมลใหม่อีกครั้ง', [
          { text: 'ตกลง', onPress: () => router.replace('/login') }
        ]);
      }
    });
  }, [router]);

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      Alert.alert('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกรหัสผ่านใหม่ให้ครบทั้งสองช่อง');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    if (password.length < 8) {
      Alert.alert('รหัสผ่านสั้นเกินไป', 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: password
    });
    setLoading(false);

    if (error) {
      Alert.alert('เปลี่ยนรหัสผ่านไม่สำเร็จ', getAuthErrorMessage(error));
    } else {
      Alert.alert(
        'เปลี่ยนรหัสผ่านสำเร็จ! 🎉',
        'รหัสผ่านของคุณถูกเปลี่ยนเรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่',
        [{
          text: 'ไปหน้าเข้าสู่ระบบ',
          onPress: () => {
            void signOutCurrentDevice()
              .catch(() => supabase.auth.signOut({ scope: 'local' }))
              .finally(() => router.replace('/login'));
          },
        }]
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
          <Text style={styles.navLogoText}>ตั้งรหัสผ่านใหม่</Text>
        </View>

        {/* =========================================================
            2. LOGO ILLUSTRATION AREA
           ========================================================= */}
        <View style={styles.imageContainer}>
          <Image source={require('@/assets/images/iconlnw.png')} style={styles.logoImage} />
        </View>

        {/* =========================================================
            3. HEADER
           ========================================================= */}
        <View style={styles.welcomeGroup}>
          <Text style={styles.title}>สร้างรหัสผ่านใหม่</Text>
          <Text style={styles.subtitle}>กรุณาตั้งรหัสผ่านใหม่ที่คุณสามารถจำได้ง่าย</Text>
        </View>

        {/* =========================================================
            4. FORM CARD
           ========================================================= */}
        <View style={styles.card}>

          {/* รหัสผ่านใหม่ */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="lock-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>รหัสผ่านใหม่</Text>
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="รหัสผ่าน 8 ตัวขึ้นไป"
                placeholderTextColor="#9ca3af"
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

          {/* ยืนยันรหัสผ่านใหม่ */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="shield-check-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>ยืนยันรหัสผ่านใหม่</Text>
            </View>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง"
                placeholderTextColor="#9ca3af"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* ปุ่มยืนยัน */}
          <View style={styles.submitBtnShadow}>
            <TouchableOpacity
              style={styles.submitBtn}
              activeOpacity={0.8}
              onPress={handleUpdatePassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>บันทึกรหัสผ่านใหม่</Text>
                  <MaterialCommunityIcons name="check" size={20} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>
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
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
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
  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 30,
  },
  welcomeGroup: {
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#16a34a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
  card: {
    width: '90%',
    maxWidth: 380,
    paddingHorizontal: 10,
  },
  inputWrapper: {
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
    paddingRight: 40,
    fontSize: 14,
    color: '#1e293b',
  },
  inputIconRight: {
    position: 'absolute',
    right: 14,
  },
  submitBtnShadow: {
    backgroundColor: '#064e3b',
    borderRadius: 12,
    paddingBottom: 4,
    marginTop: 10,
  },
  submitBtn: {
    backgroundColor: '#16a34a',
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
