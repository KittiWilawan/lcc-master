import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CameraAnalysis } from './cameraAnalysis';
import { getTrackedMemberIds } from './monitoringPolicy';
import { supabase } from './supabase';
import { syncMonitoringIdentity } from './monitoringIdentity';
import { getIdentityGalleryStatus } from './cameraMonitoring';
import limits from '../../android/app/src/main/assets/monitoring/video-test.json';

export { limits as videoTestLimits };
export interface VideoTestScope { userId: string; familyId: string; targetMemberIds: string[]; names: string[] }
export interface VideoTestFrame {
  id: string; positionMs: number; durationMs: number; framesAnalyzed: number; fallEvents: number;
  analysis: CameraAnalysis; previewImage: string; frameWidth: number; frameHeight: number;
}
export interface VideoTestResult {
  comparisonEvents?: { positionMs: number; trackId: number; memberName?: string | null }[];
  id: string; durationMs: number; framesAnalyzed: number; personFrames: number; monitoredFrames: number;
  monitoringMode: 'all_people' | 'selected_people'; events: { positionMs: number; analysis: CameraAnalysis }[];
}
interface VideoTestModule {
  start(configuration: string): Promise<string>;
  cancel(): void;
  addListener(name: string): void;
  removeListeners(count: number): void;
}
const native = Platform.OS === 'android' ? NativeModules.VideoFallTest as VideoTestModule | undefined : undefined;
export function supportsVideoFallTest() { return typeof native?.start === 'function'; }
export function cancelVideoFallTest() { native?.cancel(); }
export function subscribeVideoFallTest(listener: (frame: VideoTestFrame) => void): () => void {
  if (!native) return () => {};
  const subscription = new NativeEventEmitter(native as never).addListener('VideoFallTestFrame', (json: unknown) => {
    if (typeof json !== 'string') return;
    try { listener(JSON.parse(json)); } catch { /* Ignore invalid native events. */ }
  });
  return () => subscription.remove();
}
export async function getVideoTestScope(signal: AbortSignal, prepareIdentity = false): Promise<VideoTestScope> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('กรุณาเข้าสู่ระบบก่อนทดสอบ');
  const userId = auth.user.id;
  const familyId = await AsyncStorage.getItem('familyId');
  if (!familyId) throw new Error('กรุณาเลือกครอบครัวก่อนทดสอบ');
  const { data, error } = await supabase.from('family_members').select('id,is_tracked,display_name,identity_consent_at')
    .eq('family_id', familyId).is('user_id', null).abortSignal(signal);
  if (error) throw new Error('อ่านรายชื่อที่เปิดเฝ้าระวังไม่ได้ กรุณาลองอีกครั้ง');
  if (!Array.isArray(data)) throw new Error('ข้อมูลรายชื่อไม่ครบ กรุณาลองอีกครั้ง');
  const targetMemberIds = [...getTrackedMemberIds(data)].sort();
  const stillActive = async () => !signal.aborted && await AsyncStorage.getItem('familyId') === familyId &&
    (await supabase.auth.getSession()).data.session?.user.id === userId;
  if (prepareIdentity && targetMemberIds.length) {
    await syncMonitoringIdentity(userId, familyId, data, signal, stillActive);
    const gallery = await getIdentityGalleryStatus();
    if (gallery.userId !== userId || gallery.familyId !== familyId || !gallery.expiresAt || gallery.expiresAt <= Date.now() ||
        !targetMemberIds.every((id) => gallery.memberIds?.includes(id))) {
      throw new Error('กรุณาสแกนเต็มตัวและยินยอมใช้รูปอ้างอิงให้ครบทุกคนที่เปิดเฝ้าระวัง');
    }
  }
  if (!await stillActive()) throw new Error('การทดสอบถูกยกเลิก กรุณาเปิดหน้านี้ใหม่');
  return { userId, familyId, targetMemberIds, names: data.filter((member) => targetMemberIds.includes(member.id)).map((member) => member.display_name) };
}
export async function startVideoFallTest(id: string, uri: string, scope: VideoTestScope): Promise<VideoTestResult> {
  if (!supportsVideoFallTest()) throw new Error('ต้องติดตั้ง APK รุ่นที่รองรับการทดสอบวิดีโอ ฟังก์ชันนี้ใช้ใน Expo Go ไม่ได้');
  const protocol = new URL(uri).protocol;
  if (protocol !== 'file:' && protocol !== 'content:') throw new Error('กรุณาเลือกวิดีโอจากเครื่อง');
  return JSON.parse(await native!.start(JSON.stringify({ id, uri, ...scope })));
}
