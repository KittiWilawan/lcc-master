import { useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Modal, requireNativeComponent, ScrollView, StyleSheet, Text, TouchableOpacity, View,
  type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { FACE_SCAN_CONFIG, scanInstruction, scanPoses, validScanCapture, type FacePose, type FaceScanTarget, type ScanCapture, type ScanState } from '../lib/guidedFaceScan';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { checkPoseReplacement, supportsPoseRetake } from '../lib/faceInspection';
import { saveScanPhotoSet, type ScanPhotoSet, type ScanSaveOptions } from '../lib/faceScanSave';

interface NativeScannerProps extends ViewProps {
  pose: FaceScanTarget; facing: 'front' | 'back'; scanEnabled: boolean; restartToken: number;
  onScanState(event: NativeSyntheticEvent<ScanState>): void;
  onScanCapture(event: NativeSyntheticEvent<ScanCapture>): void;
}
const NativeScanner = requireNativeComponent<NativeScannerProps>('LookLanFaceScan');
const labels: Record<FacePose, string> = { front: 'หน้าตรง', left: 'หันซ้าย', right: 'หันขวา' };

type ScanProps = { onClose(): void } & (
  { target: 'all'; onSaveSet(photos: ScanPhotoSet, options: ScanSaveOptions): Promise<void> } |
  { target: FacePose; onReplace(candidate: string, isActive: () => boolean): Promise<void> }
);
export function GuidedFaceScanModal(props: ScanProps) {
  const { target, onClose } = props;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [hostActive, setHostActive] = useState(AppState.currentState === 'active');
  const [restartToken, setRestartToken] = useState(0);
  const [state, setState] = useState<ScanState>({ hint: 'loading', pose: 'front', progress: 0, reset: false });
  const [photos, setPhotos] = useState<Partial<Record<FacePose, string>>>({});
  const [saved, setSaved] = useState<FacePose[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [retaking, setRetaking] = useState<FacePose | null>(null);
  const active = useRef(true);
  const savingRef = useRef(false);
  const lastFrame = useRef(0);
  const photosRef = useRef<Partial<Record<FacePose, string>>>({});
  const poses = scanPoses(target);
  const complete = poses.every(pose => Boolean(photos[pose]));
  const step = poses.findIndex(pose => !photos[pose]);
  const currentPose = poses[step] ?? poses[0];
  const acceptingFrames = useRef(true);
  const expectedRun = useRef(0);
  useEffect(() => { acceptingFrames.current = hostActive && !complete && !saving; }, [hostActive, complete, saving, restartToken]);

  useEffect(() => {
    active.current = true;
    const listener = AppState.addEventListener('change', next => {
      setHostActive(next === 'active');
      if (next !== 'active' && !savingRef.current && !scanPoses(target).every(pose => Boolean(photosRef.current[pose]))) {
        acceptingFrames.current = false; photosRef.current = {}; setPhotos({}); setSaved([]);
        expectedRun.current += 1; setRestartToken(value => value + 1);
      }
    });
    return () => { active.current = false; acceptingFrames.current = false; photosRef.current = {}; listener.remove(); };
  }, [target]);

  useEffect(() => {
    if (saveComplete && hostActive && active.current) {
      active.current = false; acceptingFrames.current = false; photosRef.current = {}; onClose();
    }
  }, [saveComplete, hostActive, onClose]);

  useEffect(() => {
    if (!permission?.granted || complete || !hostActive) return;
    lastFrame.current = Date.now();
    const timer = setInterval(() => setStalled(Date.now() - lastFrame.current > FACE_SCAN_CONFIG.ui.stalledMs), FACE_SCAN_CONFIG.ui.stalledMs);
    return () => clearInterval(timer);
  }, [permission?.granted, complete, hostActive, restartToken]);

  const restart = () => {
    if (savingRef.current) return;
    acceptingFrames.current = false; photosRef.current = {};
    setPhotos({}); setSaved([]); setError(null); setStalled(false);
    setSaveComplete(false);
    setState({ hint: 'loading', pose: 'front', progress: 0, reset: true });
    expectedRun.current += 1;
    setRestartToken(value => value + 1);
  };
  const close = () => { if (!savingRef.current) { active.current = false; acceptingFrames.current = false; photosRef.current = {}; onClose(); } };
  const save = async () => {
    if (!complete || savingRef.current || saveComplete) return;
    savingRef.current = true; setSaving(true); setSaved([]); setError(null);
    try {
      let committed = true;
      if (props.target === 'all') {
        committed = await saveScanPhotoSet({ poses, photos: photosRef.current, isActive: () => active.current, store: props.onSaveSet,
          onProgress: progress => { if (active.current) setSaved(progress); } });
      } else {
        const photo = photosRef.current[props.target];
        if (!photo) return;
        await props.onReplace(photo, () => active.current);
      }
      if (active.current && committed) setSaveComplete(true);
    } catch (failure) { if (active.current) { setSaved([]); setError(getFriendlyErrorMessage(failure)); } }
    finally { savingRef.current = false; if (active.current) setSaving(false); }
  };
  const denied = permission?.canAskAgain === false;

  if (retaking) {
    return <GuidedFaceScanModal key={retaking} target={retaking} onClose={() => setRetaking(null)}
      onReplace={async (candidate, isActive) => {
        const retained = poses.filter(pose => pose !== retaking).map(pose => photosRef.current[pose]);
        if (!candidate || !retained.every((photo): photo is string => Boolean(photo))) throw new Error('รูปเดิมไม่ครบ');
        await checkPoseReplacement(candidate, retained);
        if (!active.current || !isActive()) return;
        photosRef.current = { ...photosRef.current, [retaking]: candidate };
        setPhotos({ ...photosRef.current }); setSaved([]); setError(null);
      }} />;
  }
  return <Modal visible animationType="slide" onRequestClose={close}>
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>สแกนใบหน้า{target === 'all' ? ' 3 มุม' : ` · ${labels[target]}`}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="ปิดหน้าสแกน" disabled={saving} style={styles.close} onPress={close}><Text style={{ color: colors.textPrimary }}>ปิด</Text></TouchableOpacity></View>
      {!complete && <View style={styles.poseGuide}>
        <MaterialCommunityIcons name={currentPose === 'front' ? 'face-man-outline' : 'face-man-profile'} size={40}
          color={colors.accentText} style={{ transform: [{ scaleX: currentPose === 'left' ? -1 : 1 }] }} />
        <Text accessibilityRole="header" style={[styles.instruction, { color: colors.textPrimary, flex: 1 }]}>
          {target === 'all' ? `ขั้นที่ ${step + 1} จาก ${poses.length} · ${labels[currentPose]}` : `ถ่ายซ้ำเฉพาะมุม${labels[currentPose]}`}
        </Text>
      </View>}
      {!permission?.granted ? <View style={styles.permission}>
        <Text style={[styles.instruction, { color: colors.textPrimary }]}>อนุญาตใช้กล้องเพื่อเริ่มสแกน</Text>
        <TouchableOpacity accessibilityRole="button" style={[styles.button, { backgroundColor: colors.accent }]} onPress={() => void (denied ? Linking.openSettings() : requestPermission())}>
          <Text style={styles.buttonText}>{denied ? 'เปิดการตั้งค่ากล้อง' : 'อนุญาตใช้กล้อง'}</Text></TouchableOpacity>
      </View> : complete ? <ScrollView contentContainerStyle={styles.review}>
        <Text accessibilityRole="header" style={[styles.instruction, { color: colors.textPrimary }]}>ตรวจรูปก่อนบันทึก</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>ตรวจว่าทุกรูปเป็นคนที่ต้องการเพิ่ม และใบหน้าชัดเจน</Text>
        <View style={styles.previewRow}>{poses.map(pose => <View key={pose} style={styles.previewCard}><Image source={{ uri: `data:image/jpeg;base64,${photos[pose]}` }} style={styles.preview} resizeMode="contain" />
          <Text style={[styles.previewLabel, { color: colors.textPrimary }]}>{labels[pose]}{saved.includes(pose) ? saveComplete ? ' · บันทึกแล้ว' : ' · เตรียมแล้ว' : ''}</Text>
          {target === 'all' && supportsPoseRetake() && <TouchableOpacity disabled={saving || saveComplete} accessibilityRole="button"
            accessibilityLabel={`ถ่ายมุม${labels[pose]}ใหม่`} style={styles.close} onPress={() => setRetaking(pose)}>
            <Text style={{ color: colors.accentText }}>ถ่ายมุมนี้ใหม่</Text>
          </TouchableOpacity>}</View>)}</View>
      </ScrollView> : <View style={[styles.cameraArea, { backgroundColor: colors.mediaBackground }]}>
        {hostActive && <NativeScanner key={restartToken} style={StyleSheet.absoluteFill} pose={target} facing={facing} restartToken={restartToken} scanEnabled={!saving}
          onScanState={({ nativeEvent }) => {
            if (!active.current || !acceptingFrames.current || nativeEvent.runId !== expectedRun.current) return;
            lastFrame.current = Date.now(); setStalled(false);
            if (nativeEvent.reset && Object.keys(photosRef.current).length > 0) {
              photosRef.current = {}; setPhotos({}); setSaved([]);
            }
            setState(previous => previous.hint === nativeEvent.hint && previous.pose === nativeEvent.pose
              && previous.progress === nativeEvent.progress && previous.reset === nativeEvent.reset && previous.runId === nativeEvent.runId ? previous : nativeEvent);
          }} onScanCapture={({ nativeEvent }) => {
            if (!active.current || !acceptingFrames.current || nativeEvent.runId !== expectedRun.current || !validScanCapture(nativeEvent, target)) return;
            photosRef.current = { ...photosRef.current, [nativeEvent.pose]: nativeEvent.base64 };
            if (poses.every(pose => Boolean(photosRef.current[pose]))) acceptingFrames.current = false;
            setPhotos({ ...photosRef.current });
          }} />}
        <View pointerEvents="none" style={styles.guideOverlay}><View style={[styles.frame, { borderColor: state.hint === 'hold' ? colors.accentText : colors.onAccent }]} /></View>
      </View>}
      <View style={styles.footer}>
        {permission?.granted && !complete && <View style={[styles.liveCopy, { backgroundColor: colors.card }]}>
          <Text accessibilityLiveRegion="polite" style={[styles.liveInstruction, { color: colors.textPrimary }]}>{hostActive ? scanInstruction(state) : 'พักสแกนแล้ว กลับเข้าแอปเพื่อเริ่มใหม่'}</Text>
          {state.hint === 'hold' && <Text style={[styles.liveDetail, { color: colors.accentText }]}>กำลังเก็บภาพ… {Math.round(state.progress * 100)}%</Text>}
          <Text style={[styles.liveDetail, { color: colors.textSecondary }]}>แอปจะเก็บภาพให้อัตโนมัติ</Text>
        </View>}
        {stalled && <Text accessibilityRole="alert" style={[styles.error, { color: colors.dangerText }]}>ไม่ได้รับภาพกล้อง กรุณากดเริ่มใหม่</Text>}
        {error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.dangerText }]}>
          {target === 'all' ? `${error} · รูปชุดนี้ยังอยู่ กดลองบันทึกอีกครั้งได้` : 'ยังเทียบกับรูปมุมเดิมไม่ได้ ให้คนเดิมถ่ายมุมนี้อีกครั้ง'}
        </Text>}
        {saving ? <View style={styles.saving}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.textPrimary }}>กำลังเตรียมรูป {saved.length}/{poses.length} มุมและยืนยันทั้งชุด…</Text></View> : saveComplete ? <Text style={{ color: colors.accentText }}>บันทึกทั้งชุดแล้ว</Text> : complete ? <View style={styles.buttons}>
          <TouchableOpacity accessibilityRole="button" style={[styles.button, { flex: 1, backgroundColor: colors.inputBg }]} onPress={restart}><Text style={{ color: colors.textPrimary }}>สแกนใหม่</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.button, { flex: 1, backgroundColor: colors.accent }]} onPress={() => void save()}><Text style={styles.buttonText}>{target !== 'all' ? 'ใช้รูปมุมนี้' : error ? 'ลองบันทึกอีกครั้ง' : 'บันทึกรูปอ้างอิง'}</Text></TouchableOpacity>
        </View> : permission?.granted ? <View style={styles.buttons}>
          <TouchableOpacity accessibilityRole="button" style={[styles.button, { flex: 1, backgroundColor: colors.inputBg }]} onPress={() => { restart(); setFacing(value => value === 'front' ? 'back' : 'front'); }}><Text style={{ color: colors.textPrimary }}>สลับกล้อง</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.button, { flex: 1, backgroundColor: colors.inputBg }]} onPress={restart}><Text style={{ color: colors.textPrimary }}>เริ่มใหม่</Text></TouchableOpacity>
        </View> : null}
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  poseGuide: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  screen: { flex: 1 }, header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', flex: 1 }, close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 15, lineHeight: 23, marginHorizontal: 20, marginVertical: 8 }, steps: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  chip: { padding: 10, borderRadius: 12 }, cameraArea: { flex: 1, minHeight: 120 }, guideOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: { width: '68%', height: '64%', borderWidth: 3, borderRadius: 180 }, liveCopy: { padding: 12, borderRadius: 16, marginTop: 10 },
  liveInstruction: { fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 30 }, liveDetail: { fontSize: 14, textAlign: 'center', marginTop: 6 },
  permission: { flex: 1, justifyContent: 'center', padding: 20, gap: 20 }, instruction: { fontSize: 21, fontWeight: '700', textAlign: 'center', lineHeight: 30 },
  footer: { paddingHorizontal: 20, paddingBottom: 8 }, note: { fontSize: 13, lineHeight: 20, marginVertical: 12 }, error: { fontSize: 15, lineHeight: 23, marginBottom: 12 },
  buttons: { flexDirection: 'row', gap: 12 }, button: { minHeight: 52, borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  review: { paddingVertical: 20 }, previewRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, padding: 16 }, previewCard: { width: '45%' },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 12, backgroundColor: '#0f172a' }, previewLabel: { fontSize: 16, textAlign: 'center', marginTop: 8 },
  saving: { minHeight: 52, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' },
});
