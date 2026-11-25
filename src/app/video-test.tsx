import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID as uuid } from 'expo-crypto';
import { RealStreamPlayer } from '../components/RealStreamPlayer';
import { PersonDetectionOverlay } from '../components/PersonDetectionOverlay';
import { useTheme } from '../context/ThemeContext';
import {
  cancelVideoFallTest, getVideoTestScope, startVideoFallTest, subscribeVideoFallTest, supportsVideoFallTest,
  videoTestLimits, type VideoTestFrame, type VideoTestResult, type VideoTestScope,
} from '../lib/videoFallTest';
import network from '../config/network.json';

function seconds(ms: number) { return `${(ms / 1000).toFixed(1)} วินาที`; }

export default function VideoTestScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [asset, setAsset] = useState<{ uri: string; fileName?: string | null } | null>(null);
  const [scope, setScope] = useState<VideoTestScope | null>(null);
  const [frame, setFrame] = useState<VideoTestFrame | null>(null);
  const [result, setResult] = useState<VideoTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const job = useRef({ generation: 0, id: '', controller: null as AbortController | null });
  const supported = supportsVideoFallTest();
  const stop = useCallback(() => {
    job.current.generation++;
    job.current.id = '';
    job.current.controller?.abort();
    cancelVideoFallTest();
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), network.requestTimeoutMs);
    void getVideoTestScope(controller.signal).then((value) => { if (active) setScope(value); })
      .catch(() => { if (active) setMessage('อ่านขอบเขตการเฝ้าระวังไม่ได้ จะตรวจใหม่ก่อนเริ่มทดสอบ'); })
      .finally(() => clearTimeout(timeout));
    const unsubscribe = subscribeVideoFallTest((value) => { if (active && value.id === job.current.id) setFrame(value); });
    const appState = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && job.current.id) { stop(); setBusy(false); setMessage('หยุดทดสอบเมื่อออกจากแอป กดเริ่มเพื่อทดสอบใหม่'); }
    });
    return () => { active = false; controller.abort(); unsubscribe(); appState.remove(); stop(); };
  }, [stop]));

  const pick = async () => {
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false, allowsMultipleSelection: false });
      if (selection.canceled) return;
      const selected = selection.assets[0];
      if ((selected.fileSize ?? 0) > videoTestLimits.maxFileBytes || (selected.duration ?? 0) > videoTestLimits.maxDurationMs) {
        setMessage(`เลือกคลิปไม่เกิน ${videoTestLimits.maxDurationMs / 60000} นาที และ ${videoTestLimits.maxFileBytes / 1024 / 1024} MB`);
        return;
      }
      setAsset(selected); setFrame(null); setResult(null); setMessage('');
    } catch { setMessage('เลือกวิดีโอไม่สำเร็จ กรุณาลองอีกครั้ง'); }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      if ((file.size ?? 0) > videoTestLimits.maxFileBytes) { setMessage('ไฟล์ใหญ่เกินขนาดที่รองรับ'); return; }
      setAsset({ uri: file.uri, fileName: file.name }); setFrame(null); setResult(null); setMessage('');
    } catch { setMessage('เปิดไฟล์วิดีโอไม่ได้ กรุณาลองเลือกใหม่'); }
  };

  const start = async () => {
    if (!asset || busy || job.current.id) return;
    const generation = ++job.current.generation;
    const id = uuid();
    const controller = new AbortController();
    job.current.id = id; job.current.controller = controller;
    setBusy(true); setResult(null); setFrame(null); setMessage('กำลังตรวจรายชื่อและเตรียม AI…');
    const timeout = setTimeout(() => controller.abort(), network.requestTimeoutMs);
    try {
      const currentScope = await getVideoTestScope(controller.signal, true);
      clearTimeout(timeout);
      if (job.current.generation !== generation || controller.signal.aborted) return;
      setScope(currentScope); setMessage('กำลังอ่านคลิปและตรวจท่าทาง…');
      const value = await startVideoFallTest(id, asset.uri, currentScope);
      if (job.current.generation !== generation) return;
      setResult(value); setMessage('ทดสอบเสร็จแล้ว');
    } catch (error) {
      if (job.current.generation === generation) setMessage(error instanceof Error ? error.message : 'ทดสอบไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      clearTimeout(timeout);
      if (job.current.generation === generation) { job.current.id = ''; setBusy(false); }
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="กลับ">
          <MaterialCommunityIcons name="arrow-left" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>ทดสอบ AI ด้วยวิดีโอ</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.card, { backgroundColor: colors.infoBg }]}>
          <Text style={[styles.label, { color: colors.infoText }]}>ทดลองบนเครื่อง ไม่ส่งแจ้งเตือนเหตุจริง</Text>
          <Text style={[styles.body, { color: colors.infoText }]}>เลือกคลิปจากมือถือ ระบบจะแสดงภาพที่ AI วิเคราะห์พร้อมกรอบบุคคลและเวลาที่พบการล้ม วิดีโอจะไม่ถูกอัปโหลด</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{scope ? scope.targetMemberIds.length ? 'เฝ้าระวังเฉพาะคนที่เปิดไว้' : 'ตรวจการล้มของทุกคน' : 'กำลังตรวจขอบเขตการเฝ้าระวัง'}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{scope?.targetMemberIds.length
            ? `${scope.names.join(', ')} · กรอบแสดงทุกคน ระบบจะแจ้งเหตุเฉพาะคนที่ยืนยันได้ว่าตรงกับรายชื่อ`
            : 'เมื่อไม่มีคนที่เปิดเฝ้าระวัง ระบบจะตรวจทุกคนที่มองเห็นในคลิปและกล้อง'}</Text>
          <TouchableOpacity disabled={busy} style={styles.link} onPress={() => router.push('/(tabs)/members')} accessibilityRole="button">
            <Text style={[styles.label, { color: colors.accentText }]}>เลือกคนและตั้งค่ารูปอ้างอิง</Text>
          </TouchableOpacity>
        </View>
        {!supported ? <Text style={[styles.body, { color: colors.warningText }]}>เครื่องนี้เปิดคลิปและดูกรอบคนได้ การนับเหตุล้มและจับคู่คนที่เลือกในคลิปต้องใช้ APK Android</Text> : null}
        <TouchableOpacity disabled={busy} style={[styles.button, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]} onPress={() => void pick()} accessibilityRole="button" accessibilityLabel="เลือกวิดีโอจากมือถือ">
          <Text style={[styles.label, { color: colors.onAccent }]}>{asset ? 'เปลี่ยนวิดีโอ' : 'เลือกวิดีโอจากมือถือ'}</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={busy} onPress={() => void pickFile()} style={styles.link} accessibilityRole="button">
          <Text style={[styles.label, { color: colors.accentText }]}>เลือกจากแอปไฟล์</Text>
        </TouchableOpacity>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{asset?.fileName ?? `MP4 แนะนำ · ไม่เกิน ${videoTestLimits.maxDurationMs / 60000} นาที / ${videoTestLimits.maxFileBytes / 1024 / 1024} MB`}</Text>
        {!supported && asset && <RealStreamPlayer key={asset.uri} type="video" url={asset.uri} showPeople resizeMode="contain" style={[styles.preview, { height: 240 }]} />}
        {frame ? <View style={[styles.preview, { aspectRatio: frame.frameWidth / frame.frameHeight, backgroundColor: colors.mediaBackground }]}>
          <Image source={{ uri: frame.previewImage }} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="none" />
          <PersonDetectionOverlay detections={frame.analysis.previewDetections ?? frame.analysis.detections ?? []} recoveryRegions={frame.analysis.recoveryRegions} />
        </View> : null}
        {frame ? <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: frame.analysis.status === 'fall' ? colors.dangerText : colors.textPrimary }]}>{seconds(frame.positionMs)} / {seconds(frame.durationMs)}</Text>
          <Text style={[styles.body, { color: colors.textPrimary }]}>พบ {frame.analysis.peopleCount} คน · อยู่ในขอบเขต {frame.analysis.monitoredPeopleCount ?? 0} คน · เหตุล้ม {frame.fallEvents} เหตุ</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{frame.analysis.reason}</Text>
        </View> : null}
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.textPrimary }]}>{message}</Text>
        {busy ? <TouchableOpacity style={[styles.button, { backgroundColor: colors.danger }]} onPress={() => { stop(); setBusy(false); setMessage('หยุดทดสอบแล้ว ผลบางส่วนยังไม่ใช่ผลทั้งคลิป'); }} accessibilityRole="button">
          <ActivityIndicator color={colors.onAccent} /><Text style={[styles.label, { color: colors.onAccent }]}>หยุดทดสอบ</Text>
        </TouchableOpacity> : <TouchableOpacity disabled={!asset || !supported} style={[styles.button, { backgroundColor: colors.accent, opacity: asset && supported ? 1 : 0.5 }]} onPress={() => void start()} accessibilityRole="button">
          <Text style={[styles.label, { color: colors.onAccent }]}>{result ? 'ทดสอบคลิปนี้อีกครั้ง' : 'เริ่มทดสอบ'}</Text>
        </TouchableOpacity>}
        {result ? <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>รุ่นเฝ้าระวัง · พบสัญญาณ {result.events.length} ช่วงเวลา</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>วิเคราะห์ {result.framesAnalyzed} ภาพ · พบคนที่อยู่ในขอบเขต {result.monitoredFrames} ภาพ</Text>
          {result.events.map((event, index) => <Text key={index} style={[styles.body, { color: colors.dangerText }]}>• {seconds(event.positionMs)} {event.analysis.fallingMemberName ?? 'บุคคลในภาพ'}</Text>)}
          {result.comparisonEvents && <View style={styles.card}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>รุ่นทดลองสำหรับวิดีโอ · พบสัญญาณ {new Set(result.comparisonEvents.map(event => event.positionMs)).size} ช่วงเวลา</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>เทียบจากภาพเดียวกันตามเวลาของคลิป โมเดลนี้ใช้ทดลองกับวิดีโอเท่านั้น</Text>
            {result.comparisonEvents.map((event, index) => <Text key={index} style={[styles.body, { color: colors.textPrimary }]}>
              {seconds(event.positionMs)} · {event.memberName ?? `คน #${event.trackId + 1}`}
            </Text>)}
          </View>}
          {!result.events.length ? <Text style={[styles.body, { color: colors.textPrimary }]}>{result.monitoringMode === 'selected_people' && !result.monitoredFrames ? 'ไม่พบคนที่เลือกซึ่งยืนยันได้ จึงไม่แจ้งเหตุล้ม' : 'รุ่นเฝ้าระวังไม่พบการล้มตามเกณฑ์ในคลิปนี้'}</Text> : null}
        </View> : null}
        <Text style={[styles.body, { color: colors.textSecondary }]}>ภาพจะแสดงตามจังหวะที่ AI วิเคราะห์ ความเร็วอาจต่างจากคลิปจริง ผลนี้ยังไม่ใช่เปอร์เซ็นต์ความแม่นยำ และใบหน้าที่ถูกบัง ภาพมืด หรือหันหลังนานอาจยืนยันตัวตนไม่ได้</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', flexShrink: 1 }, content: { padding: 20, gap: 16 },
  card: { borderRadius: 18, padding: 18, gap: 8 }, label: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 26 }, button: { minHeight: 56, borderRadius: 16, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 12 },
  link: { minHeight: 48, justifyContent: 'center' }, preview: { width: '100%', position: 'relative', overflow: 'hidden', borderRadius: 12 },
});
