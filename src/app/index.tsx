import { useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getCurrentSession } from "../lib/authSession";
import { checkAndSaveUserFamily } from "../lib/supabase";

export default function Index() {
  const router = useRouter();
  const checkSession = useCallback(async () => {
    try {
      const session = await getCurrentSession();

      if (session?.user) {
        // ตรวจสิทธิ์กับ Supabase ทุกครั้ง เพื่อไม่ใช้ Family ID ที่ค้างจากบัญชีอื่น
        const existingFamily = await checkAndSaveUserFamily(session.user.id);
        if (existingFamily?.familyId) {
          router.replace('/(tabs)/home');
          return;
        }

        // ยังไม่มีครอบครัว → ไปหน้าตั้งค่าครอบครัว
        router.replace('/family-setup');
      } else {
        // ยังไม่เคย Login → ไปหน้า Login
        router.replace('/login');
      }
    } catch (error) {
      console.log('Session check error:', error);
      router.replace('/login');
    }
  }, [router]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // แสดง Loading screen ขณะเช็ค Session
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#059669" />
      <Text style={styles.loadingText}>กำลังตรวจสอบ...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
  },
  loadingText: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 13,
  },
});
