import { Stack, useRouter } from "expo-router";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import { ThemeProvider } from "../context/ThemeContext";
import AppLockScreen from "../components/AppLockScreen";
import { clearDeprecatedIntegrationStorage, clearSignedInUserStorage, getCurrentSession } from "../lib/authSession";
import { applyAuthCallbackUrl } from "../lib/authCallback";
import { supabase } from "../lib/supabase";
import { BackgroundMonitoringController } from "../components/BackgroundMonitoringController";

// Prevent auto hide until initial checks are completed
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const [isLocked, setIsLocked] = useState(false);
  const [checkingLock, setCheckingLock] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const checkAppLock = useCallback(async () => {
    try {
      const lockEnabled = await AsyncStorage.getItem('@app_lock_enabled');
      const hasPin = await AsyncStorage.getItem('@app_lock_pin');
      if (lockEnabled === 'true' && hasPin) {
        setIsLocked(true);
      }
    } catch (e) {
      console.log('Error checking app lock:', e);
    } finally {
      setCheckingLock(false);
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkAppLock();
    void clearDeprecatedIntegrationStorage();
  }, [checkAppLock]);

  useEffect(() => {
    let active = true;
    void getCurrentSession().then((currentSession) => {
      if (active) setSession(currentSession);
    }).catch((error) => {
      console.log('Session bootstrap error:', error);
      if (active) setSession(null);
    }).finally(() => {
      if (active) setCheckingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setCheckingSession(false);
      if (event === 'SIGNED_OUT') {
        void clearSignedInUserStorage().finally(() => router.replace('/login'));
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    const openAuthLink = async (url: string | null) => {
      if (!url) return;
      try {
        const kind = await applyAuthCallbackUrl(url);
        if (active && kind === 'recovery') router.replace('/reset-password');
      } catch {
        if (active) router.replace('/forgot-password');
      }
    };
    void Linking.getInitialURL().then(openAuthLink);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void openAuthLink(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);

  if (checkingLock || checkingSession) return null;

  if (isLocked) {
    return (
      <ThemeProvider>
        <AppLockScreen onUnlock={() => setIsLocked(false)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <BackgroundMonitoringController session={session} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="reset-password" />

        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>

        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="family-setup" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="all-cameras" />
          <Stack.Screen name="identity-enrollment" />
          <Stack.Screen name="setup-guide" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
