import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useIsFocused, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CareText as Text } from '../components/CareText';
import { useTheme } from '../context/ThemeContext';
import { angles, bodyGuide, directions, inspectBody, type Point } from '../lib/bodyPose';
import { checkPoseReplacement, supportsPoseRetake } from '../lib/faceInspection';
import { makeEnrollment, saveBodyEnrollment, type EnrollmentPhotos } from '../lib/bodyEnrollment';
import { requestCameraMonitoringRefresh } from '../lib/cameraMonitoring';
import limits from '../config/bodyScan.json';

const clean = (uri?: string) => { if (uri?.startsWith('file:')) { try { new File(uri).delete(); } catch {} } };
function ScanButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <Pressable disabled={disabled} accessibilityRole="button" onPress={onPress}
    style={[styles.button, { backgroundColor: colors.accent }]}><Text style={{ color: colors.onAccent, fontWeight: '700' }}>{label}</Text></Pressable>;
}

export default function BodyEnrollment() {
  const router = useRouter();
  const params = useLocalSearchParams<{ familyId: string; memberId?: string; name: string; role?: string }>();
  const [draft] = useState(() => makeEnrollment(params.familyId, params.memberId, params.name, params.role ?? ''));
  const { colors } = useTheme();
  const [permission, askPermission] = useCameraPermissions();
  const [consent, agree] = useState(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState(bodyGuide);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const camera = useRef<CameraView>(null);
  const bindCamera = useCallback((node: CameraView | null) => {
    camera.current = node;
    if (!node) setReady(false);
  }, []);
  const photos = useRef<Partial<EnrollmentPhotos>>({});
  const committing = useRef(false);
  const sampling = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setActive(s === 'active'));
    return () => { sub.remove(); photos.current = {}; };
  }, []);
  const showing = focused && active && consent && permission?.granted && !problem && step < angles.length;
  useEffect(() => {
    if (!showing || !ready) return;
    let stopped = false, streak = 0;
    let previous: Point | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      if (stopped) return;
      if (!camera.current || sampling.current) { timer = setTimeout(sample, limits.intervalMs); return; }
      sampling.current = true;
      const temporary: string[] = [];
      try {
        const picture = await camera.current.takePictureAsync({ quality: limits.jpegQuality, shutterSound: false });
        if (!picture) throw new Error();
        temporary.push(picture.uri);
        if (stopped) return;
        const resized = await ImageManipulator.manipulate(picture.uri).resize({ height: limits.imageHeight }).renderAsync();
        const small = await resized.saveAsync({ format: SaveFormat.JPEG, compress: limits.jpegQuality, base64: true });
        temporary.push(small.uri);
        const { findBodies } = await import('../lib/bodyPoseModel');
        if (stopped || !small.base64) return;
        const bodies = await findBodies(small.base64);
        if (stopped) return;
        const result = inspectBody(bodies, angles[step], picture.width / picture.height);
        setHint(result.hint);
        if (!result.head || !result.center) { streak = 0; previous = undefined; return; }
        if (previous && Math.hypot(result.center.x-previous.x, result.center.y-previous.y) > limits.maxCenterDrift) streak = 0;
        previous = result.center;
        if (++streak < limits.stableFrames) return;
        const box = result.head;
        const head = await ImageManipulator.manipulate(picture.uri).crop({
          originX: Math.floor(box.x*picture.width), originY: Math.floor(box.y*picture.height),
          width: Math.floor(box.width*picture.width), height: Math.floor(box.height*picture.height),
        }).renderAsync();
        const reference = await head.saveAsync({ format: SaveFormat.JPEG, compress: limits.jpegQuality, base64: true });
        temporary.push(reference.uri);
        if (!reference.base64) throw new Error();
        if (stopped) return;
        if (step === angles.length-1 && supportsPoseRetake()) {
          try { await checkPoseReplacement(reference.base64, [photos.current.front!, photos.current.left!]); }
          catch {
            if (!stopped) {
              stopped = true; photos.current = {}; setStep(0);
              setProblem('ยังเทียบทั้งสามมุมว่าเป็นคนเดียวกันไม่ได้ ให้คนเดิมอยู่ในที่สว่างแล้วสแกนใหม่');
            }
            return;
          }
          if (stopped) return;
        }
        if (step === 0) photos.current.full_body = small.base64;
        photos.current[angles[step]] = reference.base64;
        stopped = true;
        setStep(step + 1);
        setHint(bodyGuide);
      } catch {
        if (!stopped) { stopped = true; setProblem('ตรวจภาพไม่ได้ กรุณาเปิดกล้องใหม่และลองในที่สว่าง'); }
      } finally {
        temporary.forEach(clean);
        sampling.current = false;
        if (!stopped) timer = setTimeout(sample, limits.intervalMs);
      }
    };
    timer = setTimeout(sample, limits.intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [ready, showing, step]);
  const save = async () => {
    if (committing.current || step !== angles.length || !photos.current.full_body || !angles.every(a => photos.current[a])) return;
    committing.current = true; setSaving(true); setProblem('');
    try {
      await saveBodyEnrollment(draft, photos.current as EnrollmentPhotos);
      photos.current = {};
      requestCameraMonitoringRefresh();
      setSaved(true);
    } catch { setProblem('ยังยืนยันการบันทึกไม่ได้ ตรวจการเชื่อมต่อแล้วกดบันทึกอีกครั้ง'); }
    finally { committing.current = false; setSaving(false); }
  };
  return <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
    <Text style={{ color: colors.textPrimary, fontSize: 24, fontWeight: '800' }}>สแกนเต็มตัว · {draft.name}</Text>
    {!consent ? <>
      <Text style={{ color: colors.textSecondary }}>ขอความยินยอมจากผู้รับการดูแลหรือผู้แทนก่อนสแกน แอปใช้กล้องหลังถ่ายเต็มตัวและเก็บภาพใบหน้าจากภาพเดียวกันเพื่อจับคู่บุคคล รูปที่บันทึกจะอยู่ในพื้นที่ส่วนตัวของครอบครัว</Text>
      <ScanButton label="ได้รับความยินยอมแล้ว · เปิดกล้อง" onPress={() => agree(true)} />
    </> : !permission?.granted ? <>
      <Text style={{ color: colors.textSecondary }}>อนุญาตให้ใช้กล้องเพื่อสแกน หากเคยปฏิเสธ ให้เปิดสิทธิ์กล้องในการตั้งค่ามือถือ</Text>
      <ScanButton label="อนุญาตใช้กล้อง" onPress={() => void askPermission()} />
    </> : saved ? <Text accessibilityLiveRegion="polite" style={{ color: colors.accentText }}>บันทึกการสแกนของ {draft.name} แล้ว</Text>
    : step === angles.length ? <>
      <Text style={{ color: colors.textPrimary }}>ถ่ายครบแล้วทั้ง 3 มุม</Text>
      <ScanButton label={saving ? 'กำลังบันทึก…' : 'บันทึกการสแกน'} disabled={saving} onPress={save} />
    </> : <>
      <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>มุมที่ {step+1} จาก {angles.length} · {directions[angles[step]]}</Text>
      <View style={styles.previewArea}><View style={styles.preview}>{showing && <CameraView ref={bindCamera} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" onCameraReady={() => setReady(true)}
        onMountError={() => setProblem('เปิดกล้องไม่ได้ กรุณาปิดแอปอื่นที่ใช้กล้องแล้วลองใหม่')} />}
        <View pointerEvents="none" style={styles.guide} />
      </View></View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.textPrimary }}>{hint}</Text>
      {!!problem && <ScanButton label="เปิดกล้องอีกครั้ง" onPress={() => setProblem('')} />}
    </>}
    {!!problem && <Text accessibilityLiveRegion="polite" style={{ color: colors.dangerText }}>{problem}</Text>}
    <ScanButton label={saved ? 'เสร็จสิ้น' : 'ยกเลิก'} disabled={saving} onPress={() => router.back()} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, gap: 10, paddingVertical: 8 },
  previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', maxHeight: '100%', aspectRatio: 3/4, backgroundColor: 'black', overflow: 'hidden' },
  guide: { position: 'absolute', left: '3.5%', right: '3.5%', top: '3.5%', bottom: '3.5%', borderWidth: 2, borderColor: 'white', borderRadius: 12 },
  button: { minHeight: 48, padding: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
