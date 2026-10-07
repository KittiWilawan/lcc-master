import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CameraAnalysis } from './cameraAnalysis';
import runtime from '../../android/app/src/main/assets/monitoring/runtime.json';

interface CameraMonitorModule {
  configure(cameras: string): Promise<boolean>;
  getStates(): Promise<string>;
  getCapabilities(): Promise<string>;
  testSource(url: string): Promise<string>;
  setPreviewEnabled(cameraId: string, enabled: boolean): void;
  getPendingEvents(): Promise<string>;
  acknowledgeEvent(id: string): Promise<boolean>;
  configureDelivery(configuration: string): Promise<boolean>;
  getDeliveryRegistration(): Promise<string>;
  addListener(name: string): void;
  removeListeners(count: number): void;
}

export interface NativeCameraSource { id: string; name: string; url: string; familyId: string; userId: string }
export interface CameraMonitorState {
  cameraId: string;
  state: 'connecting' | 'reconnecting' | 'ready' | 'ended' | 'ai_error';
  analysis?: CameraAnalysis;
  previewImage?: string;
  frameWidth?: number;
  frameHeight?: number;
  lastFrameAt?: number;
  lastAnalysisAt?: number;
  inferenceMs?: number;
  hasPendingEvent?: boolean;
}
export interface NativeFallEvent {
  id: string; userId: string; familyId: string; cameraId: string; cameraName: string;
  createdAt: number; imageUri: string; analysis: CameraAnalysis; notificationSent: boolean;
  cloudSynced?: boolean; remoteAccepted?: boolean; deliveryState?: string; cloudImagePath?: string;
}

export interface DeliveryRegistration { deviceId?: string; userId?: string; familyId?: string; expiresAt?: string }
export async function getDeliveryRegistration(): Promise<DeliveryRegistration> {
  return JSON.parse(await requireNative().getDeliveryRegistration());
}
export async function configureEventDelivery(configuration: Required<DeliveryRegistration> & { token: string; endpoint: string }) {
  await requireNative().configureDelivery(JSON.stringify(configuration));
}

const native = Platform.OS === 'android' ? NativeModules.BackgroundMonitoring as CameraMonitorModule | undefined : undefined;
const listeners = new Set<() => void>();
const refreshListeners = new Set<() => void>();
const previews = new Map<string, number>();
let states: Readonly<Record<string, CameraMonitorState>> = {};
let eventSubscription: { remove(): void } | undefined;

export function hasNativeCameraMonitoring(): boolean {
  return Boolean(native && typeof native.configure === 'function' && typeof native.testSource === 'function' && typeof native.getStates === 'function');
}
function requireNative(): CameraMonitorModule {
  if (!hasNativeCameraMonitoring()) throw new Error('ต้องติดตั้ง APK รุ่นที่รองรับ HLS ลิงก์เดียวก่อน');
  return native!;
}
function emit() { listeners.forEach((listener) => listener()); }
export function clearCameraMonitorStates() { states = {}; emit(); }
function acceptState(state: CameraMonitorState) {
  if (!state.cameraId) return;
  states = { ...states, [state.cameraId]: state }; emit();
}
export async function refreshCameraMonitorStates(): Promise<void> {
  if (!hasNativeCameraMonitoring()) return;
  const values = JSON.parse(await requireNative().getStates()) as CameraMonitorState[];
  states = Object.fromEntries(values.map((state) => [state.cameraId, state])); emit();
}
export function subscribeCameraMonitoring(listener: () => void): () => void {
  listeners.add(listener);
  if (!eventSubscription && hasNativeCameraMonitoring()) {
    eventSubscription = new NativeEventEmitter(native as never).addListener('CameraMonitorUpdate', (json: string) => {
      try { acceptState(JSON.parse(json) as CameraMonitorState); } catch { /* Reject invalid native events. */ }
    });
    void refreshCameraMonitorStates().catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { eventSubscription?.remove(); eventSubscription = undefined; }
  };
}
export function getCameraMonitorStates() { return states; }
export function isCameraMonitorFresh(state: CameraMonitorState | undefined, now = Date.now()): boolean {
  return Boolean(state?.state === 'ready' && state.lastFrameAt && state.lastAnalysisAt &&
    now >= state.lastFrameAt && now - state.lastFrameAt <= runtime.frameStaleMs &&
    now >= state.lastAnalysisAt &&
    now - state.lastAnalysisAt <= runtime.frameStaleMs);
}
export function isCameraMonitorSlow(state: CameraMonitorState | undefined): boolean {
  const duration = state?.inferenceMs;
  return Boolean(state?.state === 'ready' && typeof duration === 'number' && Number.isFinite(duration) &&
    duration > runtime.maxRealtimeInferenceMs);
}
export function isCameraMonitorReady(state: CameraMonitorState | undefined, now = Date.now()): boolean {
  if (!state || !isCameraMonitorFresh(state, now)) return false;
  const duration = state.inferenceMs;
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && !isCameraMonitorSlow(state);
}
export function requestCameraMonitoringRefresh() { refreshListeners.forEach((listener) => listener()); }
export function onCameraMonitoringRefresh(listener: () => void) { refreshListeners.add(listener); return () => { refreshListeners.delete(listener); }; }
export async function configureNativeCameraMonitoring(cameras: NativeCameraSource[]) {
  await requireNative().configure(JSON.stringify(cameras));
  if (!cameras.length) { clearCameraMonitorStates(); return; }
  await refreshCameraMonitorStates();
}
export async function testNativeCameraSource(url: string): Promise<{ success: boolean; message: string }> {
  return JSON.parse(await requireNative().testSource(url));
}
export async function getNativeCameraCapabilities(): Promise<{ maxCameras: number; frameIntervalMs: number; frameStaleMs: number;
  localNotificationsEnabled: boolean; remotePushConfigured: boolean; remoteDeliveryConfigured: boolean }> {
  return JSON.parse(await requireNative().getCapabilities());
}
export async function getNativeFallEvents(): Promise<NativeFallEvent[]> { return JSON.parse(await requireNative().getPendingEvents()); }
export async function acknowledgeNativeFallEvent(id: string) { await requireNative().acknowledgeEvent(id); }

export function useCameraMonitoringStates() {
  const snapshot = useSyncExternalStore(subscribeCameraMonitoring, getCameraMonitorStates, getCameraMonitorStates);
  const [, updateClock] = useState(0);
  useEffect(() => {
    if (!hasNativeCameraMonitoring()) return;
    const timer = setInterval(() => updateClock((clock) => clock + 1), runtime.watchdogIntervalMs);
    return () => clearInterval(timer);
  }, []);
  return snapshot;
}
export function useCameraMonitorState(cameraId: string, preview: boolean) {
  const snapshot = useCameraMonitoringStates();
  useEffect(() => {
    if (!preview || !hasNativeCameraMonitoring()) return;
    let active = AppState.currentState === 'active';
    previews.set(cameraId, (previews.get(cameraId) ?? 0) + 1);
    requireNative().setPreviewEnabled(cameraId, active);
    const subscription = AppState.addEventListener('change', (next) => {
      active = next === 'active';
      requireNative().setPreviewEnabled(cameraId, active && Boolean(previews.get(cameraId)));
      if (active) void refreshCameraMonitorStates().catch(() => undefined);
    });
    return () => {
      subscription.remove();
      const count = (previews.get(cameraId) ?? 1) - 1;
      if (count > 0) previews.set(cameraId, count); else previews.delete(cameraId);
      requireNative().setPreviewEnabled(cameraId, active && count > 0);
    };
  }, [cameraId, preview]);
  return snapshot[cameraId];
}
