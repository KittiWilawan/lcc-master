import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
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

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      Alert.alert(
        'ข้อมูลไม่ครบถ้วน',
        'กรุณากรอกอีเมลของคุณเพื่อดำเนินการต่อ'
      );
      return;
    }

    setLoading(true);
    const redirectTo = Linking.createURL('/reset-password');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    setLoading(false);

    if (error) {
      Alert.alert('ส่งลิงก์ไม่สำเร็จ', getAuthErrorMessage(error));
    } else {
      setIsSuccess(true);
      Alert.alert(
        'ส่งลิงก์สำเร็จ!',
        'เราได้ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปที่อีเมลของคุณแล้ว กรุณาตรวจสอบกล่องจดหมายของคุณ',
        [{ text: 'กลับไปหน้าเข้าสู่ระบบ', onPress: () => router.replace('/login') }]
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
            <Text style={styles.navLogoText}>ย้อนกลับ</Text>
          </TouchableOpacity>
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
          <Text style={styles.title}>ลืมรหัสผ่าน?</Text>
          <Text style={styles.subtitle}>กรอกอีเมลของคุณเพื่อรับลิงก์สำหรับตั้งรหัสผ่านใหม่</Text>
        </View>

        {/* =========================================================
            4. FORM CARD
           ========================================================= */}
        <View style={styles.card}>

          {/* อีเมล */}
          <View style={styles.inputWrapper}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons name="email-outline" size={16} color="#16a34a" />
              <Text style={styles.label}>อีเมลที่ใช้สมัคร</Text>
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

          {/* ปุ่มส่งลิงก์รีเซ็ต */}
          <View style={styles.submitBtnShadow}>
            <TouchableOpacity
              style={styles.submitBtn}
              activeOpacity={0.8}
              onPress={handleResetPassword}
              disabled={loading || isSuccess}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>ส่งลิงก์ไปที่อีเมล</Text>
                  <MaterialCommunityIcons name="email-fast-outline" size={20} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* คำแนะนำเพิ่มเติม */}
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              หมายเหตุ: หากไม่พบอีเมลในกล่องจดหมายหลัก กรุณาตรวจสอบในโฟลเดอร์จดหมายขยะ (Spam)
            </Text>
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
    marginBottom: 24,
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
  submitBtnShadow: {
    backgroundColor: '#064e3b',
    borderRadius: 12,
    paddingBottom: 4,
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
  },
  hintContainer: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
  },
  hintText: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
    textAlign: 'center',
  }
});
