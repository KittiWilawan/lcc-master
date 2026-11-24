import { StyleSheet, Text, View } from 'react-native';
import type { DetectionRegion, PersonDetection } from '../lib/cameraAnalysis';

interface Props {
  detections: PersonDetection[];
  recoveryRegions?: DetectionRegion[];
}

const COLORS: Record<PersonDetection['state'], string> = {
  normal: '#166534',
  possible_fall: '#92400e',
  fall: '#991b1b',
  uncertain: '#075985',
};

const LABELS: Record<PersonDetection['state'], string> = {
  normal: 'บุคคล',
  possible_fall: 'อาจล้ม',
  fall: 'สงสัยล้ม',
  uncertain: 'กำลังตรวจ',
};

function asPercent(value: number): `${number}%` {
  return `${value * 100}%`;
}

export function PersonDetectionOverlay({ detections, recoveryRegions = [] }: Props) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {recoveryRegions.map((region, index) => (
        <View key={`region-${index}`} style={[styles.box, {
          borderStyle: 'dashed', borderColor: COLORS.uncertain, left: asPercent(region.x), top: asPercent(region.y),
          width: asPercent(region.width), height: asPercent(region.height),
        }]}>
          <View style={[styles.label, { backgroundColor: COLORS.uncertain, top: 0 }]}>
            <Text style={styles.labelText}>กำลังค้นหาคน</Text>
          </View>
        </View>
      ))}
      {detections.map((detection, index) => {
        const color = COLORS[detection.state];
        return (
          <View
            key={detection.trackId ?? index}
            style={[
              styles.box,
              {
                borderColor: color,
                left: asPercent(detection.x),
                top: asPercent(detection.y),
                width: asPercent(detection.width),
                height: asPercent(detection.height),
              },
            ]}
          >
            <View style={[styles.label, { backgroundColor: color }]}>
              <Text style={styles.labelText} numberOfLines={1}>
                {detection.memberName ? `${detection.identityState === 'recent_face' ? 'ล่าสุดเห็น ' : 'อาจเป็น '}${detection.memberName} · ` : detection.trackId !== undefined ? `คน #${detection.trackId + 1} · ` : ''}
                {LABELS[detection.state]}{detection.collapseConfirmed ? ' · จากท่าทาง' : ` ${Math.round(detection.confidence * 100)}%`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    minWidth: 24,
    minHeight: 24,
  },
  label: {
    position: 'absolute',
    left: -2,
    top: -22,
    minHeight: 20,
    maxWidth: 200,
    paddingHorizontal: 5,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  labelText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
});
