import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import type { MonitoringSummary, StatusTone } from '../lib/monitoringStatus';
import { CareText as Text } from './CareText';
import readability from '../config/readability.json';

export function MonitoringStatusCard({ summary, onSettings, buttonLabel = 'ตรวจและตั้งค่าระบบ' }: {
  summary: MonitoringSummary; onSettings?: () => void; buttonLabel?: string;
}) {
  const { colors, seniorMode } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const minimumHeight = seniorMode ? readability.seniorTouchTargetSize : readability.touchTargetSize;
  const toneColor = (tone: StatusTone) => tone === 'ready' ? colors.accentText : tone === 'attention' ? colors.warningText : colors.textSecondary;
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} testID="monitoring-status">
    <Text style={[styles.heading, { color: colors.textPrimary }]} accessibilityLiveRegion="polite">{summary.title}</Text>
    {summary.rows.filter(row => expanded || row.id !== 'ai' || row.tone !== 'ready').map(row => <View key={row.id} style={[styles.row, { borderColor: colors.separator }]}>
      <MaterialCommunityIcons name={row.tone === 'ready' ? 'check-circle-outline' : row.tone === 'waiting' ? 'clock-outline' : 'alert-circle-outline'} size={24} color={toneColor(row.tone)} />
      <View style={styles.copy}>{expanded && <Text style={[styles.label, { color: colors.textPrimary }]}>{row.title}</Text>}
        <Text style={{ color: toneColor(row.tone) }}>{row.detail}</Text></View>
    </View>)}
    {expanded && <Text style={[styles.detail, { color: colors.textSecondary }]}>{summary.detail}</Text>}
    {onSettings && <TouchableOpacity onPress={onSettings} accessibilityRole="button" accessibilityLabel={buttonLabel}
      style={[styles.button, { backgroundColor: colors.accentBg, minHeight: minimumHeight }]}>
      <Text style={[styles.label, { color: colors.accentText }]}>{buttonLabel}</Text>
      <MaterialCommunityIcons name="chevron-right" size={24} color={colors.accentText} />
    </TouchableOpacity>}
    <TouchableOpacity onPress={() => setExpanded(current => !current)} accessibilityRole="button"
      accessibilityState={{ expanded }} accessibilityLabel={expanded ? 'ย่อรายละเอียดสถานะ' : 'ดูรายละเอียดสถานะกล้อง AI และบุคคล'}
      testID="monitoring-details-toggle" style={[styles.disclosure, { minHeight: minimumHeight }]}>
      <Text style={[styles.actionLabel, { color: colors.accentText }]}>{expanded ? 'ย่อรายละเอียด' : 'ดูรายละเอียดสถานะ'}</Text>
      <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={colors.accentText} />
    </TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  row: { borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
  copy: { flex: 1, minWidth: 0 }, label: { fontWeight: '700', flexShrink: 1 }, detail: { marginTop: 14 },
  button: { borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, marginTop: 14, gap: 8 },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 8 },
  actionLabel: { flex: 1, fontWeight: '700' },
});
