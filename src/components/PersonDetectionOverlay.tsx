import { StyleSheet, Text, View } from 'react-native';
import type { PersonDetection } from '../lib/cameraAnalysis';

interface Props {
  detections: PersonDetection[];
}

const COLORS: Record<PersonDetection['state'], string> = {
  normal: '#22c55e',
  possible_fall: '#f59e0b',
  fall: '#ef4444',
  uncertain: '#38bdf8',
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

export function PersonDetectionOverlay({ detections }: Props) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {detections.map((detection, index) => {
        const color = COLORS[detection.state];
        return (
          <View
            key={`${index}-${detection.x}-${detection.y}`}
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
                {LABELS[detection.state]} {Math.round(detection.confidence * 100)}%
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
    maxWidth: 132,
    paddingHorizontal: 5,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  labelText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
});
