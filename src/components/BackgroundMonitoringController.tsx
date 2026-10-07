import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { recordFallEvent } from '../lib/fallEvidence';
import { stopBackgroundMonitoring } from '../lib/backgroundMonitoring';
import { getTrackedMemberIds, shouldMonitorCamera } from '../lib/monitoringPolicy';
import { supabase } from '../lib/supabase';
import { resolveCameraSource } from '../lib/cameraSource';
import {
  acknowledgeNativeFallEvent, configureNativeCameraMonitoring, getCameraMonitorStates,
  getNativeFallEvents, hasNativeCameraMonitoring, onCameraMonitoringRefresh,
  refreshCameraMonitorStates, subscribeCameraMonitoring,
} from '../lib/cameraMonitoring';
import { ensureNativeEventDelivery } from '../lib/nativeEventDelivery';
import network from '../config/network.json';

export function BackgroundMonitoringController({ session }: { session: Session | null }) {
  const userId = session?.user.id;
  useEffect(() => {
    let active = true;
    let refreshing = false;
    let refreshRequested = false;
    let configuredFamily: string | undefined;
    let draining = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const nativeMode = Platform.OS === 'android' && hasNativeCameraMonitoring() && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker';
    if (!userId || !nativeMode) {
      void stopBackgroundMonitoring().catch(() => false);
      return () => { active = false; };
    }

    const drain = async () => {
      if (!active || draining || AppState.currentState !== 'active') return;
      draining = true;
      try {
        const familyId = await AsyncStorage.getItem('familyId');
        for (const event of await getNativeFallEvents()) {
          if (!active || event.userId !== userId || event.familyId !== familyId) continue;
          const record = await recordFallEvent({
            eventId: event.id, familyId: event.familyId,
            memberName: 'ยังไม่ยืนยันตัวบุคคล', cameraName: event.cameraName,
            imageUri: event.imageUri, createdAt: new Date(event.createdAt).toISOString(),
            eventType: 'actual', notificationSent: event.notificationSent,
            details: event.analysis.reason,
            deferCloudSync: true, cloudImagePath: event.cloudSynced ? event.cloudImagePath : undefined,
          });
          if (active && record.savedLocally && event.cloudSynced && event.remoteAccepted) await acknowledgeNativeFallEvent(event.id);
        }
      } catch { console.warn('เก็บเหตุจากกล้องไม่สำเร็จ เหตุยังอยู่ในคิวบนอุปกรณ์'); }
      finally { draining = false; }
    };

    const refresh = async () => {
      if (!active) return;
      if (refreshing) { refreshRequested = true; return; }
      refreshing = true;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), network.requestTimeoutMs);
      try {
        const familyId = await AsyncStorage.getItem('familyId');
        if (!active) return;
        if (configuredFamily && familyId !== configuredFamily) {
          await configureNativeCameraMonitoring([]); configuredFamily = undefined;
        }
        if (!familyId) { await configureNativeCameraMonitoring([]); return; }
        const [{ data: cameras, error }, { data: members, error: memberError }] = await Promise.all([
          supabase.from('cameras').select('id,name,type,url,snapshot_url,assigned_member_id')
            .eq('family_id', familyId).abortSignal(requestController.signal),
          supabase.from('family_members').select('id,is_tracked').eq('family_id', familyId)
            .is('user_id', null).abortSignal(requestController.signal),
        ]);
        if (error) throw error;
        if (memberError) throw memberError;
        if (!active || await AsyncStorage.getItem('familyId') !== familyId) return;
        const targets = getTrackedMemberIds(members ?? []);
        const selected = (cameras ?? []).flatMap((camera) => {
          const url = resolveCameraSource(camera);
          return camera.type !== 'device' && url && shouldMonitorCamera(camera, targets)
            ? [{ id: camera.id, name: camera.name, url, familyId, userId }] : [];
        });
        await configureNativeCameraMonitoring(selected);
        configuredFamily = familyId;
        if (selected.length) {
          try {
            await ensureNativeEventDelivery(userId, familyId, async () => active && await AsyncStorage.getItem('familyId') === familyId);
          } catch { console.warn('ยังลงทะเบียนส่งแจ้งเตือนเบื้องหลังไม่ได้ ระบบเก็บเหตุและแจ้งบนเครื่องนี้ต่อ'); }
        }
      } catch { console.warn('รีเฟรชข้อมูลกล้องไม่ได้ ระบบยังใช้การตั้งค่าล่าสุดที่รับสำเร็จ'); }
      finally {
        clearTimeout(timeout); refreshing = false;
        if (active && refreshRequested) { refreshRequested = false; void refresh(); }
      }
    };
    const poll = async () => {
      await refresh();
      if (!active) return;
      await refreshCameraMonitorStates().catch(() => undefined);
      void drain();
      const interval = Number(process.env.EXPO_PUBLIC_BACKGROUND_CONFIG_REFRESH_MS);
      if (active && Number.isSafeInteger(interval) && interval > 0) timer = setTimeout(() => void poll(), interval);
    };
    const unsubscribe = subscribeCameraMonitoring(() => {
      if (Object.values(getCameraMonitorStates()).some((state) => state.hasPendingEvent)) void drain();
    });
    const unsubscribeRefresh = onCameraMonitoringRefresh(() => { void refresh(); });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') { void refresh(); void refreshCameraMonitorStates().catch(() => undefined); void drain(); }
    });
    void poll();
    return () => {
      active = false; controller?.abort(); if (timer) clearTimeout(timer);
      unsubscribe(); unsubscribeRefresh(); appState.remove();
      void configureNativeCameraMonitoring([]).catch(() => false);
    };
  }, [userId]);
  return null;
}
