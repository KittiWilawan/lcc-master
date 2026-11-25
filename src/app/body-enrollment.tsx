import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useIsFocused, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CareText as Text } from '../components/CareText';
import { useTheme } from '../context/ThemeContext';
import { angles, bodyGuide, directions, inspectBody, type Body, type Point } from '../lib/bodyPose';
import { checkPoseReplacement, supportsPoseRetake, validateFacePhoto } from '../lib/faceInspection';
import { makeEnrollment, saveBodyEnrollment, type EnrollmentPhotos } from '../lib/bodyEnrollment';
import { requestCameraMonitoringRefresh } from '../lib/cameraMonitoring';
import { encode } from 'base64-arraybuffer';
import EnrollmentPoseProcessor from '../components/EnrollmentPoseProcessor';
import { EnrollmentFrameRequest, type EnrollmentFrame } from '../lib/enrollmentFrameRequest';
import { readBodyPoseWeights } from '../lib/bodyPoseWeights';
import limits from '../config/bodyScan.json';

const clean = (uri?: string) => { if (uri?.startsWith('file:')) { try { new File(uri).delete(); } catch {} } };
async function readProcessorWeights() {
  return encode(await readBodyPoseWeights());
}
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
  const [facing, setFacing] = useState<CameraType>('back');
  const [leaving, setLeaving] = useState(false);
  const [frame, setFrame] = useState<EnrollmentFrame | null>(null);
  const [requests] = useState(() => new EnrollmentFrameRequest(setFrame));
  const onAnalysis = useCallback(async (id: number, result: Body[] | null) => {
    if (requests.receive(id, result)) setFrame(null);
  }, [requests]);
  const scan = useRef<AbortController | null>(null);
  const closing = useRef(false);
  const lens = useRef<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const [seated, setSeated] = useState(false);
  const [closeUp, setCloseUp] = useState(false);
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
  const cancel = () => {
    if (committing.current || closing.current) return;
    closing.current = true;
    scan.current?.abort();
    photos.current = {};
    setFrame(null);
    setLeaving(true);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/members');
  };
  const switchCamera = () => {
    if (closing.current || committing.current) return;
    scan.current?.abort();
    lens.current = facing === 'back' ? 'front' : 'back';
    setReady(false);
    setFrame(null);
    setProblem('');
    setHint(bodyGuide);
    setFacing(lens.current);
  };
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') scan.current?.abort();
      setActive(s === 'active');
    });
    return () => { sub.remove(); scan.current?.abort(); photos.current = {}; };
  }, []);
  const showing = !leaving && focused && active && consent && permission?.granted && !problem && step < angles.length;
  useEffect(() => {
    if (!showing || !ready) return;
    const controller = new AbortController();
    scan.current = controller;
    const { signal } = controller;
    let streak = 0;
    let previous: Point | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      if (signal.aborted || !camera.current) return;
      const temporary: string[] = [];
      try {
        const picture = await camera.current.takePictureAsync({ quality: limits.jpegQuality, shutterSound: false });
        if (!picture) throw new Error();
        temporary.push(picture.uri);
        if (signal.aborted) return;
        const resized = await ImageManipulator.manipulate(picture.uri).resize({ height: limits.imageHeight }).renderAsync();
        if (signal.aborted) return;
        const small = await resized.saveAsync({ format: SaveFormat.JPEG, compress: limits.jpegQuality, base64: true });
        temporary.push(small.uri);
        if (signal.aborted || !small.base64) return;
        const bodies = await requests.analyze(small.base64, signal);
        if (signal.aborted) return;
        const result = inspectBody(bodies, angles[step], picture.width / picture.height, closeUp ? 'face' : seated ? 'seated' : 'standing');
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
        if (signal.aborted) return;
        const reference = await head.saveAsync({ format: SaveFormat.JPEG, compress: limits.jpegQuality, base64: true });
        temporary.push(reference.uri);
        if (!reference.base64) throw new Error();
        if (signal.aborted) return;
        if (!photos.current.full_body && !closeUp && step === 0) photos.current.full_body = small.base64;
        try {
          const quality = await validateFacePhoto(reference.base64, false);
          if (!quality.verified || !supportsPoseRetake()) {
            if (!signal.aborted) {
              controller.abort();
              setProblem('รุ่นแอปนี้ยังตรวจคุณภาพและเทียบใบหน้าบนอุปกรณ์ไม่ได้ กรุณาใช้รุ่นที่รองรับการสแกน');
            }
            return;
          }
          if (step > 0) await checkPoseReplacement(reference.base64, angles.slice(0, step).map(angle => photos.current[angle]!));
        } catch (error) {
          if (signal.aborted) return;
          streak = 0;
          previous = undefined;
          setHint(error instanceof Error ? error.message : 'ขยับกล้องเข้าใกล้ใบหน้าแล้วค้างสักครู่');
          setCloseUp(true);
          return;
        }
        if (signal.aborted) return;
        setCloseUp(false);
        photos.current[angles[step]] = reference.base64;
        controller.abort();
        setStep(step + 1);
        setHint(bodyGuide);
      } catch {
        if (!signal.aborted) { controller.abort(); setProblem('ตรวจภาพไม่ได้ กรุณาเปิดกล้องใหม่และลองในที่สว่าง'); }
      } finally {
        temporary.forEach(clean);
        if (!signal.aborted) timer = setTimeout(sample, limits.intervalMs);
      }
    };
    timer = setTimeout(sample, limits.intervalMs);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ready, showing, step, facing, requests, seated, closeUp]);
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
      <Text style={{ color: colors.textSecondary }}>ขอความยินยอมจากผู้รับการดูแลหรือผู้แทนก่อนสแกน แอปถ่ายภาพเต็มตัวด้วยกล้องหน้าหรือกล้องหลังและเก็บภาพใบหน้าจากภาพเดียวกันเพื่อจับคู่บุคคล รูปที่บันทึกจะอยู่ในพื้นที่ส่วนตัวของครอบครัว</Text>
      <ScanButton label={seated ? 'ท่าสแกน · นั่งเก้าอี้หรือรถเข็น (แตะเพื่อเปลี่ยน)' : 'ท่าสแกน · ยืน (แตะเพื่อเปลี่ยนเป็นนั่ง)'} onPress={() => setSeated(v => !v)} />
      <ScanButton label="ได้รับความยินยอมแล้ว · เปิดกล้อง" onPress={() => agree(true)} />
    </> : !permission?.granted ? <>
      <Text style={{ color: colors.textSecondary }}>อนุญาตให้ใช้กล้องเพื่อสแกน หากเคยปฏิเสธ ให้เปิดสิทธิ์กล้องในการตั้งค่ามือถือ</Text>
      <ScanButton label="อนุญาตใช้กล้อง" onPress={() => void askPermission()} />
    </> : saved ? <Text accessibilityLiveRegion="polite" style={{ color: colors.accentText }}>บันทึกการสแกนของ {draft.name} แล้ว</Text>
    : step === angles.length ? <>
      <Text style={{ color: colors.textPrimary }}>ถ่ายครบแล้วทั้ง 3 มุม</Text>
      <ScanButton label={saving ? 'กำลังบันทึก…' : 'บันทึกการสแกน'} disabled={saving} onPress={save} />
    </> : <>
      <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>มุมที่ {step+1} จาก {angles.length} · {closeUp ? 'ถ่ายใกล้เฉพาะใบหน้า · ' : ''}{directions[angles[step]]}</Text>
      <View style={styles.previewArea}><View style={styles.preview}>{showing && <CameraView key={facing} ref={bindCamera} style={StyleSheet.absoluteFill} facing={facing} mirror={false} ratio="4:3"
        onCameraReady={() => { if (lens.current === facing && !closing.current) setReady(true); }}
        onMountError={() => { if (lens.current === facing && !closing.current) setProblem('เปิดกล้องไม่ได้ ลองสลับกล้องหรือเปิดใหม่อีกครั้ง'); }} />}
        <View pointerEvents="none" style={styles.guide} />
      </View></View>
      {showing && <View style={styles.processor} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <EnrollmentPoseProcessor frame={frame} readWeights={readProcessorWeights} onResult={onAnalysis} dom={{ style: { width: 1, height: 1 } }} />
      </View>}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.textPrimary }}>{hint}</Text>
      <ScanButton label={facing === 'back' ? 'สลับเป็นกล้องหน้า' : 'สลับเป็นกล้องหลัง'} onPress={switchCamera} />
      {!!problem && <ScanButton label="เปิดกล้องอีกครั้ง" onPress={() => setProblem('')} />}
    </>}
    {!!problem && <Text accessibilityLiveRegion="polite" style={{ color: colors.dangerText }}>{problem}</Text>}
    <ScanButton label={saved ? 'เสร็จสิ้น' : 'ยกเลิก'} disabled={saving || leaving} onPress={cancel} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, gap: 10, paddingVertical: 8 },
  processor: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', maxHeight: '100%', aspectRatio: 3/4, backgroundColor: 'black', overflow: 'hidden' },
  guide: { position: 'absolute', left: '3.5%', right: '3.5%', top: '3.5%', bottom: '3.5%', borderWidth: 2, borderColor: 'white', borderRadius: 12 },
  button: { minHeight: 48, padding: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
