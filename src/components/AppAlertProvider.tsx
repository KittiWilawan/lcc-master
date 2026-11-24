import { CareText as Text } from './CareText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { attachAlertPresenter, AppAlert, type AppAlertMessage } from '../lib/appAlert';

export function AppAlertProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<AppAlertMessage[]>([]);
  const enqueue = useCallback((message: AppAlertMessage) => setQueue(items => [...items, message]), []);
  useEffect(() => attachAlertPresenter(enqueue), [enqueue]);
  const current = queue[0];
  const dismiss = () => setQueue(items => items.slice(1));
  const cancel = () => {
    if (!current?.options?.cancelable) return;
    dismiss();
    current.options.onDismiss?.();
  };
  const accents = {
    info: { color: colors.infoText, bg: colors.infoBg, icon: 'information-outline' as const },
    success: { color: colors.accentText, bg: colors.accentBg, icon: 'check-circle-outline' as const },
    error: { color: colors.dangerText, bg: colors.dangerBg, icon: 'alert-circle-outline' as const },
    confirm: { color: colors.warningText, bg: colors.warningBg, icon: 'help-circle-outline' as const },
  };
  const accent = accents[current?.kind ?? 'info'];
  return <>
    {children}
    <Modal transparent visible={Boolean(current)} animationType="fade" onRequestClose={cancel}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        {current && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} accessibilityViewIsModal>
          <View style={[styles.icon, { backgroundColor: accent.bg }]}><MaterialCommunityIcons name={accent.icon} size={32} color={accent.color} /></View>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{current.title}</Text>
            {current.message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{current.message}</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            {current.buttons.map((button, index) => {
              const secondary = button.style === 'cancel';
              const background = secondary ? colors.inputBg : button.style === 'destructive' ? colors.danger : colors.accent;
              return <TouchableOpacity key={index} accessibilityRole="button" style={[styles.button, { backgroundColor: background }]}
                onPress={() => {
                  dismiss();
                  try {
                    void Promise.resolve(button.onPress?.()).catch(() => AppAlert.error('ดำเนินการไม่สำเร็จ', 'กรุณาลองอีกครั้ง'));
                  } catch { AppAlert.error('ดำเนินการไม่สำเร็จ', 'กรุณาลองอีกครั้ง'); }
                }}>
                <Text style={[styles.buttonText, { color: secondary ? colors.textPrimary : colors.onAccent }]}>{button.text ?? 'ตกลง'}</Text>
              </TouchableOpacity>;
            })}
          </View>
        </View>}
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 440, maxHeight: '90%', borderRadius: 24, padding: 24, borderWidth: 1 },
  icon: { width: 64, height: 64, borderRadius: 32, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  content: { flexShrink: 1 }, contentInner: { paddingBottom: 16 },
  title: { fontSize: 21, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  message: { fontSize: 16, lineHeight: 25, textAlign: 'center' },
  actions: { gap: 10 }, button: { minHeight: 52, borderRadius: 14, padding: 14, justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
