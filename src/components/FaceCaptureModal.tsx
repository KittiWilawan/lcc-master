import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { prepareIdentityImage } from '../lib/identityImageProcessing';
import { FacePhotoError, supportsFaceInspection, validateFacePhoto } from '../lib/faceInspection';
import { IDENTITY_POSES, type IdentityPose } from '../lib/identityReferences';
import { getFriendlyErrorMessage } from '../lib/friendlyError';
import { GuidedFaceScanModal } from './GuidedFaceScanModal';
import { supportsGuidedFaceScan, type FaceScanTarget } from '../lib/guidedFaceScan';
import type { ScanPhotoSet, ScanSaveOptions } from '../lib/faceScanSave';

export function FaceCaptureModal(props: {
  pose: IdentityPose | FaceScanTarget | null; onClose(): void; onSave(pose: IdentityPose, base64: string): Promise<void>;
  onSaveSet(photos: ScanPhotoSet, options: ScanSaveOptions): Promise<void>;
}) {
  if (!props.pose) return null;
  // Replacing a face reference recaptures the set so continuity is checked in one session.
  if (props.pose !== 'full_body' && supportsGuidedFaceScan()) return <GuidedFaceScanModal key={props.pose} target="all" onClose={props.onClose} onSaveSet={props.onSaveSet} />;
  return <ActiveFaceCapture key={props.pose} {...props} pose={props.pose === 'all' ? 'front' : props.pose} />;
}

function ActiveFaceCapture({ pose, onClose, onSave }: {
  pose: IdentityPose; onClose(): void; onSave(pose: IdentityPose, base64: string): Promise<void>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const active = useRef(false);
  const operation = useRef(0);
  const inFlight = useRef(false);
  const [facing, setFacing] = useState<CameraType>(pose === 'full_body' ? 'back' : 'front');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; operation.current += 1; };
  }, []);
  const fullBody = pose === 'full_body';
  const description = IDENTITY_POSES.find(item => item.key === pose);
  const capture = async () => {
    if (!camera.current || !ready || inFlight.current || !pose) return;
    inFlight.current = true; setBusy(true); setError(null);
    const id = operation.current;
    try {
      const photo = await camera.current.takePictureAsync();
      if (!photo?.uri) throw new Error('อ่านรูปไม่ได้ กรุณาถ่ายใหม่');
      const base64 = await prepareIdentityImage(photo.uri, fullBody);
      await validateFacePhoto(base64, fullBody);
      if (active.current && id === operation.current) setPreview(base64);
    } catch (error) { if (active.current && id === operation.current) setError(error instanceof FacePhotoError ? error.message : getFriendlyErrorMessage(error)); }
    finally { if (id === operation.current) { inFlight.current = false; setBusy(false); } }
  };
  const save = async () => {
    if (!pose || !preview || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await onSave(pose, preview); onClose(); }
    catch (error) { if (active.current) setError(getFriendlyErrorMessage(error)); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const close = () => { if (busy) return; active.current = false; operation.current += 1; onClose(); };
  return <Modal visible={Boolean(pose)} animationType="slide" onRequestClose={close}>
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{description?.label}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.smallButton} disabled={busy} onPress={close}><Text style={{ color: colors.textPrimary }}>ปิด</Text></TouchableOpacity>
      </View>
      <Text style={[styles.guideText, { color: colors.textSecondary }]}>{description?.description} · ถ่ายเฉพาะคนนี้ในที่สว่าง</Text>
      {!permission?.granted ? <View style={styles.permission}>
        <Text style={[styles.guideText, { color: colors.textPrimary }]}>อนุญาตใช้กล้องเพื่อถ่ายรูปอ้างอิง</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.accent }]} onPress={() => permission?.canAskAgain === false ? void Linking.openSettings() : void requestPermission()}>
          <Text style={styles.buttonText}>{permission?.canAskAgain === false ? 'เปิดการตั้งค่ากล้อง' : 'อนุญาตใช้กล้อง'}</Text>
        </TouchableOpacity>
      </View> : <View style={styles.cameraArea}>
        {preview ? <Image source={{ uri: `data:image/jpeg;base64,${preview}` }} resizeMode="contain" style={StyleSheet.absoluteFill} /> :
          <CameraView ref={camera} facing={facing} mirror={false} style={StyleSheet.absoluteFill} onCameraReady={() => setReady(true)}
            onMountError={() => { setReady(false); setError('เปิดกล้องไม่ได้ กรุณาปิดหน้านี้แล้วลองใหม่'); }} />}
        {!preview && <View pointerEvents="none" style={styles.guideOverlay}><View style={[styles.frame, fullBody ? styles.bodyFrame : styles.faceFrame]} /></View>}
      </View>}
      <View style={styles.footer}>
        <Text style={[styles.guideText, { color: colors.textSecondary }]}>{supportsFaceInspection()
          ? fullBody ? 'ตรวจใบหน้าได้ แต่กรอบเต็มตัวเป็นแนวช่วยจัดภาพ กรุณาตรวจว่ามีตั้งแต่ศีรษะถึงเท้า' : 'รูปจะผ่านเมื่อพบใบหน้าเดียวและเห็นใบหน้าครบ'
          : 'รุ่นนี้ยังตรวจใบหน้าอัตโนมัติไม่ได้ กรุณาตรวจรูปเอง หรือใช้ APK รุ่นใหม่'} · รูปอ้างอิงไม่ใช่การยืนยันตัวตนอัตโนมัติ</Text>
        {error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.dangerText }]}>{error}</Text>}
        {busy ? <ActivityIndicator color={colors.accent} /> : preview ? <View style={styles.row}>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: colors.inputBg }]} onPress={() => { setPreview(null); setReady(false); setError(null); }}><Text style={{ color: colors.textPrimary }}>ถ่ายใหม่</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: colors.accent }]} onPress={() => void save()}><Text style={styles.buttonText}>ใช้รูปนี้</Text></TouchableOpacity>
        </View> : <View style={styles.row}>
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.inputBg }]} disabled={!permission?.granted} onPress={() => { setReady(false); setFacing(value => value === 'front' ? 'back' : 'front'); }}><Text style={{ color: colors.textPrimary }}>สลับกล้อง</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="ถ่ายรูปเพื่อตรวจใบหน้า" style={[styles.button, { flex: 1, backgroundColor: colors.accent, opacity: ready ? 1 : 0.5 }]} disabled={!ready} onPress={() => void capture()}><Text style={styles.buttonText}>ถ่ายและตรวจรูป</Text></TouchableOpacity>
        </View>}
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '800' }, smallButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  guideText: { fontSize: 14, lineHeight: 22, marginHorizontal: 20, marginVertical: 8 }, permission: { flex: 1, justifyContent: 'center', padding: 20 },
  cameraArea: { flex: 1, minHeight: 120, backgroundColor: '#0f172a' }, guideOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { borderWidth: 3, borderColor: '#34d399', width: '66%' }, faceFrame: { height: '72%', borderRadius: 140 }, bodyFrame: { height: '90%', borderRadius: 20 },
  footer: { paddingBottom: 8 }, row: { flexDirection: 'row', gap: 12, marginHorizontal: 20 },
  button: { minHeight: 52, borderRadius: 14, padding: 14, justifyContent: 'center', alignItems: 'center' }, buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  error: { fontSize: 15, marginHorizontal: 20, marginBottom: 12 },
});
