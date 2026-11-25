import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import type { VideoThumbnail } from 'expo-video';
import { PersonDetectionOverlay } from './PersonDetectionOverlay';
import { CareText } from './CareText';
import type { PersonDetection } from '../lib/cameraAnalysis';
import limits from '../config/bodyScan.json';

export type PreviewSample = { source: string | VideoThumbnail; release?: () => void };
export function LivePersonBoxes({ capture, fit }: { capture: () => Promise<PreviewSample | undefined>; fit: string }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<{ ratio: number; boxes: PersonDetection[] }>();
  const [unavailable, setUnavailable] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', s => setActive(s === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active || !focused || Platform.OS === 'web') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>, expiry: ReturnType<typeof setTimeout>;
    const sample = async () => {
      let photo: PreviewSample | undefined, uri: string | undefined;
      try {
        photo = await capture();
        if (!photo || stopped) return;
        const image = await ImageManipulator.manipulate(photo.source).resize({ height: limits.imageHeight }).renderAsync();
        const jpeg = await image.saveAsync({ base64: true, compress: limits.jpegQuality, format: SaveFormat.JPEG });
        uri = jpeg.uri;
        if (!jpeg.base64 || stopped) return;
        const { findBodies } = await import('../lib/bodyPoseModel');
        if (stopped) return;
        const bodies = await findBodies(jpeg.base64);
        if (stopped) return;
        const boxes: PersonDetection[] = bodies.flatMap(body => {
          const points = body.points.filter(p => p.score >= limits.minJointScore);
          if (!points.length) return [];
          const xs = points.map(p => p.x), ys = points.map(p => p.y);
          const x = Math.max(0, Math.min(...xs) - limits.frameInset), y = Math.max(0, Math.min(...ys) - limits.frameInset);
          const width = Math.min(1, Math.max(...xs) + limits.frameInset)-x, height = Math.min(1, Math.max(...ys) + limits.frameInset)-y;
          return width > 0 && height > 0 ? [{ x, y, width, height, label: 'person', state: 'normal', confidence: body.score }] : [];
        });
        setFrame({ ratio: image.width/image.height, boxes }); setUnavailable(false);
        clearTimeout(expiry); expiry = setTimeout(() => setFrame(undefined), limits.previewExpiryMs);
      } catch { if (!stopped) { setFrame(undefined); setUnavailable(true); } }
      finally {
        if (uri?.startsWith('file:')) { try { new File(uri).delete(); } catch {} }
        photo?.release?.();
        if (!stopped) timer = setTimeout(sample, limits.previewIntervalMs);
      }
    };
    void sample();
    return () => { stopped = true; clearTimeout(timer); clearTimeout(expiry); setFrame(undefined); };
  }, [active, focused, capture]);
  const ratio = frame?.ratio || 1;
  const width = fit === 'contain' ? Math.min(size.width, size.height*ratio) : Math.max(size.width, size.height*ratio);
  const height = width/ratio;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={e => setSize(e.nativeEvent.layout)}>
    {active && focused && frame && <View style={{ position: 'absolute', width, height, left: (size.width-width)/2, top: (size.height-height)/2 }}>
      <PersonDetectionOverlay detections={frame.boxes} />
    </View>}
    {unavailable && <CareText style={{ position: 'absolute', top: 6, left: 6, backgroundColor: '#15212b', color: 'white' }}>ยังอ่านกรอบคนจากภาพนี้ไม่ได้</CareText>}
  </View>;
}
