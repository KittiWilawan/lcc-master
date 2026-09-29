import { NativeModules, Platform } from 'react-native';

interface BackgroundMonitoringNativeModule {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  isRunning(): Promise<boolean>;
}

const nativeModule = NativeModules.BackgroundMonitoring as BackgroundMonitoringNativeModule | undefined;

function getAndroidModule(): BackgroundMonitoringNativeModule | null {
  if (Platform.OS !== 'android') return null;
  if (!nativeModule) {
    throw new Error('กรุณาติดตั้งแอป Android รุ่นล่าสุดก่อนเปิดการเฝ้าระวังเบื้องหลัง');
  }
  return nativeModule;
}

export async function startBackgroundMonitoring(): Promise<boolean> {
  const module = getAndroidModule();
  return module ? module.start() : false;
}

export async function stopBackgroundMonitoring(): Promise<boolean> {
  const module = getAndroidModule();
  return module ? module.stop() : false;
}

export async function isBackgroundMonitoringRunning(): Promise<boolean> {
  const module = getAndroidModule();
  return module ? module.isRunning() : false;
}
