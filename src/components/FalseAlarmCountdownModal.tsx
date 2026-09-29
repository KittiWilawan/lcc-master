import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { playEmergencySiren } from '../lib/emergencyAudio';
import { getEmergencyPhoneNumber } from '../lib/phone';

interface FalseAlarmCountdownModalProps {
  visible: boolean;
  personName?: string;
  locationName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const FalseAlarmCountdownModal = React.memo(function FalseAlarmCountdownModal({
  visible,
  personName = 'ยังไม่ยืนยันตัวบุคคล',
  locationName = 'กล้องวงจรปิด',
  onCancel,
  onConfirm,
}: FalseAlarmCountdownModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(10);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      setSecondsLeft(10);
      progressAnim.setValue(1);
      return;
    }

    // Play initial warning sound
    playEmergencySiren();
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 400, 200, 400]);
    }

    // Pulse animation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    // Progress bar animation over 10 seconds
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 10000,
      useNativeDriver: false,
    }).start();

    // 1-second interval timer
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          pulseLoop.stop();
          onConfirm();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      pulseLoop.stop();
    };
  }, [visible, onConfirm, pulseAnim, progressAnim]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Top Red Header */}
          <View style={styles.cardHeader}>
            <Animated.View style={[styles.sirenCircle, { transform: [{ scale: pulseAnim }] }]}>
              <MaterialCommunityIcons name="alert-decagram" size={36} color="#ffffff" />
            </Animated.View>
            <Text style={styles.headerTitle}>🚨 AI สงสัยว่าอาจเกิดการล้ม</Text>
            <Text style={styles.headerSubtitle}>
              ระบบกำลังเตรียมแจ้งผู้ดูแล หากต้องการความช่วยเหลือฉุกเฉินให้โทร {getEmergencyPhoneNumber()}
            </Text>
          </View>

          {/* Countdown Display & Details */}
          <View style={styles.body}>
            <View style={styles.targetInfo}>
              <Text style={styles.targetPerson}>{personName}</Text>
              <Text style={styles.targetLocation}>📍 ตำแหน่ง: {locationName}</Text>
            </View>

            {/* Big Countdown Number */}
            <View style={styles.timerCircle}>
              <Text style={styles.timerNumber}>{secondsLeft}</Text>

              <Text style={styles.timerUnit}>วินาที</Text>
            </View>

            {/* Animated Progress Bar */}
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            <Text style={styles.noticeText}>
              {"หากต้องการยกเลิก กดปุ่ม \"ฉันสบายดี\" ด้านล่างก่อนหมดเวลา"}
            </Text>

            {/* Action Buttons */}
            <View style={styles.actions}>
              {/* Cancel Button (I'm OK) */}
              <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.85} onPress={onCancel}>
                <MaterialCommunityIcons name="heart-pulse" size={24} color="#ffffff" />
                <View>
                  <Text style={styles.cancelBtnTitle}>💚 ฉันสบายดี / กดยกเลิก</Text>
                  <Text style={styles.cancelBtnSubtitle}>ยกเลิกการแจ้งเตือน (False Alarm)</Text>
                </View>
              </TouchableOpacity>

              {/* Immediate Confirm Button */}
              <TouchableOpacity style={styles.confirmBtn} activeOpacity={0.85} onPress={onConfirm}>
                <MaterialCommunityIcons name="bell-ring-outline" size={18} color="#dc2626" />
                <Text style={styles.confirmBtnText}>แจ้งเตือนฉุกเฉินทันที</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  cardHeader: {
    backgroundColor: '#dc2626',
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  sirenCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  body: {
    padding: 20,
    alignItems: 'center',
  },
  targetInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  targetPerson: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  targetLocation: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  timerCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fef2f2',
    borderWidth: 4,
    borderColor: '#fca5a5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  timerNumber: {
    fontSize: 42,
    fontWeight: '900',
    color: '#dc2626',
    lineHeight: 46,
  },
  timerUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: '#991b1b',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#fee2e2',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#dc2626',
  },
  noticeText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cancelBtnTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  cancelBtnSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 6,
  },
  confirmBtnText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '800',
  },
});
