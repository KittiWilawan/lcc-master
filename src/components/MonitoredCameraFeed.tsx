import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { analyzeCameraImages, CameraAnalysis, getAnalysisIntervalMs, getCaptureQuality } from '../lib/cameraAnalysis';
import { RealStreamPlayer } from './RealStreamPlayer';
import { PersonDetectionOverlay } from './PersonDetectionOverlay';
import { Image } from 'expo-image';
import { hasNativeCameraMonitoring, isCameraMonitorFresh, isCameraMonitorSlow, useCameraMonitorState } from '../lib/cameraMonitoring';

interface CameraSource {
  id: string;
  type: 'video' | 'device' | 'rtsp';
  url?: string;
  snapshot_url?: string;
}

interface Props {
  camera: CameraSource;
  style?: StyleProp<ViewStyle>;
  monitoring?: boolean;
  analysisEnabled?: boolean;
  displayStream?: boolean;
  onFallDetected?: (image: string, analysis: CameraAnalysis) => void;
}

async function readSnapshotAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('อ่านภาพนิ่งจากกล้องไม่สำเร็จ');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('URL ภาพนิ่งไม่ได้ส่งรูปภาพ');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('ข้อมูลภาพไม่ถูกต้อง'));
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

export function MonitoredCameraFeed({
  camera,
  style,
  monitoring = true,
  analysisEnabled = true,
  displayStream = true,
  onFallDetected,
}: Props) {
  const [cloudAnalysis, setAnalysis] = useState<CameraAnalysis | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const nativeMode = hasNativeCameraMonitoring() && camera.type !== 'device' && monitoring && process.env.EXPO_PUBLIC_AI_MODE !== 'home_worker';
  const nativeState = useCameraMonitorState(camera.id, nativeMode && displayStream);
  const nativeFresh = isCameraMonitorFresh(nativeState);
  const analysis = nativeMode ? nativeState?.analysis : cloudAnalysis;
  const [error, setError] = useState<string | null>(null);
  const previousImage = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const lastFall = useRef(false);
  const confirmedSamples = useRef(0);
  const intervalMs = getAnalysisIntervalMs();
  const captureQuality = getCaptureQuality();
  const confidenceThreshold = Number(process.env.EXPO_PUBLIC_AI_FALL_CONFIDENCE);
  const confirmationsRequired = Number(process.env.EXPO_PUBLIC_AI_CONFIRMATIONS);
  const homeWorkerMode = process.env.EXPO_PUBLIC_AI_MODE === 'home_worker';
  const configured = Boolean(!homeWorkerMode && process.env.EXPO_PUBLIC_AI_FUNCTION_NAME && intervalMs && captureQuality &&
    confidenceThreshold > 0 && confidenceThreshold <= 1 &&
    Number.isInteger(confirmationsRequired) && confirmationsRequired > 0);
  const enabled = !nativeMode && monitoring && analysisEnabled && configured && Boolean(camera.id);

  useEffect(() => {
    previousImage.current = undefined;
    confirmedSamples.current = 0;
    lastFall.current = false;
    // Reset the prior camera's result when the source or monitoring state changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnalysis(null);
    setError(null);
  }, [camera.id, enabled]);

  const processImage = useCallback(async (image: string) => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await analyzeCameraImages(camera.id, image, previousImage.current);
      previousImage.current = image;
      setAnalysis(result);
      setError(null);
      const confirmed = result.status === 'fall' && result.confidence >= confidenceThreshold;
      confirmedSamples.current = confirmed ? confirmedSamples.current + 1 : 0;
      const shouldAlert = confirmedSamples.current >= confirmationsRequired;
      if (shouldAlert && !lastFall.current) onFallDetected?.(image, result);
      lastFall.current = shouldAlert;
    } catch (caught) {
      previousImage.current = undefined;
      confirmedSamples.current = 0;
      lastFall.current = false;
      // Keep the latest boxes visible if one analysis request fails temporarily.
      setError(caught instanceof Error ? caught.message : 'วิเคราะห์ภาพไม่สำเร็จ');
    } finally {
      inFlight.current = false;
    }
  }, [camera.id, confidenceThreshold, confirmationsRequired, enabled, onFallDetected]);

  useEffect(() => {
    if (!enabled || !camera.snapshot_url || camera.type === 'device' || !intervalMs) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const capture = async () => {
      try {
        const image = await readSnapshotAsDataUrl(camera.snapshot_url!);
        if (!stopped) await processImage(image);
      } catch (caught) {
        if (!stopped) {
          previousImage.current = undefined;
          confirmedSamples.current = 0;
          lastFall.current = false;
          setError(caught instanceof Error ? caught.message : 'อ่านภาพจากกล้องไม่สำเร็จ');
        }
      } finally {
        if (!stopped) timer = setTimeout(capture, intervalMs);
      }
    };
    void capture();
    return () => { stopped = true; clearTimeout(timer); };
  }, [camera.snapshot_url, camera.type, enabled, intervalMs, processImage]);

  const nativeStatus = nativeState?.state === 'ai_error' ? 'AI บนอุปกรณ์ตรวจไม่ได้ · ยังไม่พร้อมเฝ้าระวัง' :
    nativeState?.state === 'reconnecting' ? 'ภาพขาด · กำลังเชื่อมต่อใหม่' :
    nativeState?.state === 'ended' ? 'วิดีโอสิ้นสุด · ไม่มีภาพสดให้ตรวจต่อ' :
    !nativeFresh ? 'กำลังรับภาพและเริ่ม AI · ยังไม่พร้อมเฝ้าระวัง' :
    isCameraMonitorSlow(nativeState) ? 'AI ประมวลผลช้า · อาจพลาดเหตุล้ม ลองลดจำนวนกล้องหรือใช้เครื่องที่เร็วขึ้น' :
    `AI บนอุปกรณ์ · ${analysis?.status === 'fall' ? 'สงสัยล้ม' : analysis?.status === 'possible_fall' ? 'กำลังยืนยันเหตุ' : analysis?.status === 'normal' ? 'ไม่พบเหตุล้ม' : 'ยังไม่เห็นท่าทางชัดเจน'} · พบ ${analysis?.peopleCount ?? 0} คน`;
  const status = nativeMode ? nativeStatus : !monitoring ? 'กล้องนี้ไม่ได้อยู่ในขอบเขตการเฝ้าดู' : homeWorkerMode ? (camera.type === 'device'
    ? 'กล้องมือถือไม่อยู่ในระบบเฝ้าระวังคอมบ้าน'
    : 'ดูผลวิเคราะห์จากคอมบ้านในหน้าแจ้งเตือน') :
    !monitoring ? 'ปิดการเฝ้าระวัง' :
    !configured ? 'AI ยังไม่ได้ตั้งค่า' :
    camera.type !== 'device' && !camera.snapshot_url ? 'ต้องระบุ URL ภาพนิ่งสำหรับ AI' :
    error || (analysis ? `${analysis.status === 'fall' ? 'สงสัยการล้ม' : analysis.status === 'normal' ? 'ไม่พบเหตุล้ม' : 'กำลังตรวจสอบ'} · ${Math.round(analysis.confidence * 100)}% · ${analysis.subjectContinuity === 'single_continuous_person' ? 'ติดตามคนเดิม' : analysis.subjectContinuity === 'multiple_people' ? 'พบหลายคน' : 'ยังไม่ยืนยันคนเดิม'}` : 'กำลังรับภาพเพื่อตรวจสอบ');

  const ratio = nativeState?.frameWidth && nativeState.frameHeight ? nativeState.frameWidth / nativeState.frameHeight : null;
  const frameWidth = ratio && size.height > 0 ? Math.min(size.width, size.height * ratio) : size.width;
  const frameHeight = ratio ? frameWidth / ratio : size.height;
  return (
    <View style={[styles.container, style]} onLayout={(event) => setSize(event.nativeEvent.layout)}>
      {displayStream && nativeMode ? (
        <View style={{ position: 'absolute', width: frameWidth, height: frameHeight, left: (size.width - frameWidth) / 2, top: (size.height - frameHeight) / 2 }}>
          {nativeState?.previewImage ? <Image source={{ uri: nativeState.previewImage }} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="none" /> : null}
          {nativeFresh && analysis?.detections?.length ? <PersonDetectionOverlay detections={analysis.detections} /> : null}
        </View>
      ) : displayStream ? (
        <RealStreamPlayer
          type={camera.type}
          url={camera.url}
          style={StyleSheet.absoluteFill}
          onFrame={camera.type === 'device' && enabled ? (base64) => processImage(`data:image/jpeg;base64,${base64}`) : undefined}
          frameIntervalMs={intervalMs || undefined}
          captureQuality={captureQuality || undefined}
        />
      ) : null}
      {displayStream && !nativeMode && analysis?.detections?.length ? (
        <PersonDetectionOverlay detections={analysis.detections} />
      ) : null}
      {displayStream ? (
        <View style={[styles.status, analysis?.status === 'fall' && styles.alert]} pointerEvents="none">
          <Text style={styles.statusText}>{nativeMode || analysisEnabled ? status : 'AI กำลังตรวจภาพเบื้องหลัง'}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  status: { position: 'absolute', left: 8, top: 8, right: 8, padding: 7, borderRadius: 8, backgroundColor: 'rgba(15, 23, 42, 0.88)' },
  alert: { backgroundColor: 'rgba(185, 28, 28, 0.95)' },
  statusText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
});
