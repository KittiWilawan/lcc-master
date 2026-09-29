import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuth from 'expo-local-authentication';

interface AppLockScreenProps {
  onUnlock: () => void;
}

export default function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shakeAnim] = useState(() => new Animated.Value(0));

  const tryBiometric = useCallback(async () => {
    try {
      const hasHardware = await LocalAuth.hasHardwareAsync();
      const isEnrolled = await LocalAuth.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const result = await LocalAuth.authenticateAsync({
          promptMessage: 'ปลดล็อก LookLanCare',
          cancelLabel: 'ใช้ PIN แทน',
          fallbackLabel: 'ใช้ PIN แทน',
          disableDeviceFallback: true,
        });
        if (result.success) {
          onUnlock();
        }
      }
    } catch (e) {
      console.log('Biometric not available:', e);
    }
  }, [onUnlock]);

  // Try biometric on mount
  useEffect(() => {
    void tryBiometric();
  }, [tryBiometric]);

  const handlePress = useCallback(async (digit: string) => {
    const newPin = pin + digit;
    setPin(newPin);
    setError(false);

    if (newPin.length === 4) {
      try {
        const storedPin = await AsyncStorage.getItem('@app_lock_pin');
        if (storedPin === newPin) {
          onUnlock();
        } else {
          setError(true);
          Vibration.vibrate(200);
          Animated.sequence([
            Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
          ]).start();
          setTimeout(() => { setPin(''); setError(false); }, 600);
        }
      } catch (e) {
        console.log('Error verifying PIN:', e);
      }
    }
  }, [pin, onUnlock, shakeAnim]);

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const dots = [0, 1, 2, 3];
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['bio', '0', 'del'],
  ];

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="shield-lock" size={36} color="#059669" />
        </View>
        <Text style={styles.title}>LookLanCare</Text>
        <Text style={styles.subtitle}>กรุณาใส่ PIN 4 หลักเพื่อปลดล็อก</Text>

        <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
          {dots.map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                pin.length > i && styles.dotFilled,
                error && styles.dotError,
              ]}
            />
          ))}
        </Animated.View>

        {error && <Text style={styles.errorText}>PIN ไม่ถูกต้อง ลองใหม่</Text>}
      </View>

      <View style={styles.keypad}>
        {keys.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.keyRow}>
            {row.map((key) => {
              if (key === 'bio') {
                return (
                  <TouchableOpacity key={key} style={styles.keyBtn} onPress={tryBiometric}>
                    <MaterialCommunityIcons name="fingerprint" size={28} color="#059669" />
                  </TouchableOpacity>
                );
              }
              if (key === 'del') {
                return (
                  <TouchableOpacity key={key} style={styles.keyBtn} onPress={handleDelete}>
                    <MaterialCommunityIcons name="backspace-outline" size={24} color="#64748b" />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity key={key} style={styles.keyBtn} onPress={() => handlePress(key)}>
                  <Text style={styles.keyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  topSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#f1f5f9',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#475569',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  dotError: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
  },
  keypad: {
    gap: 12,
  },
  keyRow: {
    flexDirection: 'row',
    gap: 20,
  },
  keyBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f1f5f9',
  },
});
