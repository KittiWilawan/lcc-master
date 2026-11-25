import { CareText as Text } from '../../components/CareText';
import { AppAlert as Alert } from '../../lib/appAlert';
import { useTheme, type ThemeColors } from '../../context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useMemo, useCallback, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Image,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { getFallEvents, recordFallEvent } from '../../lib/fallEvidence';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

interface FallEvent {
  id: string;
  type: 'simulated' | 'actual' | 'sos';
  timestamp: string;
  details?: string;
}

interface DayStats {
  label: string;
  count: number;
  maxHeight: number;
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [events, setEvents] = useState<FallEvent[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [activeMemberName, setActiveMemberName] = useState('ผู้รับการดูแลทั้งหมด');

  const reads = useRef(0);
  const loadData = useCallback(async () => {
    const currentRead = ++reads.current;
    try {
      // Pull from Supabase fall_events (with local fallback)
      const cloudEvents = await getFallEvents();
      if (currentRead !== reads.current) return;
      if (cloudEvents && cloudEvents.length > 0) {
        setEvents(
          cloudEvents.map((e) => ({
            id: e.id,
            type: (e.event_type as 'simulated' | 'actual' | 'sos') || 'actual',
            timestamp: e.created_at,
            details: e.details,
          }))
        );
      } else {
        setEvents([]);
      }

      const familyId = await AsyncStorage.getItem('familyId');
      if (familyId) {
        const { data: membersData } = await supabase
          .from('family_members')
          .select('display_name, is_tracked, user_id')
          .eq('family_id', familyId)
          .is('user_id', null);

        if (membersData && membersData.length > 0) {
          const tracked = membersData.find(m => m.is_tracked);
          setActiveMemberName(tracked ? tracked.display_name : membersData[0].display_name);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', session.user.id)
          .single();
        if (profile) setUserProfile(profile);
      }
    } catch (e) {
      console.log('Error loading analytics:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return () => { ++reads.current; };
    }, [loadData])
  );

  const simulationPending = useRef(false);
  const [simulating, setSimulating] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState('');
  const simulateSOS = async () => {
    if (simulationPending.current) return;
    simulationPending.current = true;
    setSimulating(true);
    try {
      const familyId = await AsyncStorage.getItem('familyId');
      if (!familyId) { setSimulationStatus('กรุณาเลือกครอบครัวก่อนจำลอง SOS'); return; }
      const event = await recordFallEvent({ familyId, eventType: 'simulated', cameraName: 'ทดสอบ SOS', details: 'จำลอง SOS จากหน้าสถิติ' });
      if (!event.savedLocally && !event.cloudSynced) throw new Error();
      await loadData();
      setSimulationStatus(event.cloudSynced ? 'บันทึกแล้ว ดูได้ที่เหตุจำลองและประวัติ' : 'บันทึกเหตุจำลองในมือถือแล้ว');
    } catch { setSimulationStatus('บันทึกเหตุจำลองไม่สำเร็จ กรุณาลองอีกครั้ง'); }
    finally { simulationPending.current = false; setSimulating(false); }
  };

  // Compute 7-day stats
  const weeklyData = useMemo(() => {
    const days: DayStats[] = [];
    const dayLabels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const count = events.filter(ev => {
        const ts = new Date(ev.timestamp).getTime();
        return ts >= dayStart.getTime() && ts < dayEnd.getTime();
      }).length;

      days.push({
        label: dayLabels[d.getDay()],
        count,
        maxHeight: count,
      });
    }
    return days;
  }, [events]);

  const maxCount = Math.max(...weeklyData.map(d => d.count), 1);

  const totalEvents = events.length;
  const actualFalls = events.filter(e => e.type === 'actual').length;
  const sosEvents = events.filter(e => e.type === 'sos').length;
  const simulated = events.filter(e => e.type === 'simulated').length;

  // Risk level assessment
  const weekTotal = weeklyData.reduce((s, d) => s + d.count, 0);
  const eventSummary = weekTotal === 0 ? 'ไม่มีเหตุที่บันทึก' : `${weekTotal} เหตุการณ์`;
  const riskColor = colors.accentText;
  const riskBg = colors.accentBg;

  const handleShareDoctorReport = async () => {
    try {
      const dateStr = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 30px; color: #1e293b; background: #fff; }
            .header { text-align: center; border-bottom: 2px solid #059669; padding-bottom: 16px; margin-bottom: 20px; }
            .logo { font-size: 24px; font-weight: 900; color: #059669; letter-spacing: 2px; }
            .title { font-size: 15px; font-weight: 700; color: #475569; margin-top: 4px; }
            .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 18px; }
            .grid { display: flex; justify-content: space-between; margin-bottom: 6px; }
            .label { font-weight: 700; color: #64748b; font-size: 13px; }
            .val { font-weight: 800; color: #0f172a; font-size: 13px; }
            .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; }
            .badge-safe { background: #dcfce7; color: #15803d; }
            .badge-warn { background: #fef9c3; color: #a16207; }
            .badge-danger { background: #fee2e2; color: #b91c1c; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 18px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: center; font-size: 12px; }
            th { background: #f1f5f9; color: #475569; font-weight: 700; }
            .section-title { font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 8px; border-left: 4px solid #059669; padding-left: 8px; }
            .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">LOOKLANCARE (LLC)</div>
            <div class="title">รายงานเหตุการณ์ที่บันทึกไว้สำหรับแพทย์</div>
          </div>

          <div class="meta-box">
            <div class="grid"><span class="label">ผู้รับการดูแล:</span> <span class="val">${activeMemberName}</span></div>
            <div class="grid"><span class="label">วันที่ออกรายงาน:</span> <span class="val">${dateStr}</span></div>
            <div class="grid">
              <span class="label">เหตุการณ์สัปดาห์นี้:</span> 
              <span class="badge badge-safe">${eventSummary}</span>
            </div>
          </div>

          <div class="section-title">📊 สรุปดัชนีทางกายภาพ 7 วันย้อนหลัง</div>
          <table>
            <thead>
              <tr>
                <th>วัน</th>
                <th>เหตุการณ์ล้ม</th>
              </tr>
            </thead>
            <tbody>
              ${weeklyData.map((d) => `
                <tr>
                  <td>${d.label}</td>
                  <td>${d.count} ครั้ง</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="section-title">สรุปเหตุการณ์</div>
          <div class="meta-box">
            <div class="grid"><span class="label">จำนวนเหตุการณ์ล้มจริง:</span> <span class="val">${actualFalls} ครั้ง</span></div>
          </div>

          <p>รายงานนี้แสดงเฉพาะข้อมูลเหตุการณ์ที่บันทึกไว้ ไม่ใช่ผลวินิจฉัยหรือการประเมินการทรงตัว</p>

          <div class="footer">
            รายงานเหตุการณ์จาก LookLanCare<br/>
            ออกรายงานเมื่อ: ${new Date().toLocaleString('th-TH')}
          </div>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: 'ส่งรายงานให้แพทย์ (PDF)' });
      } else {
        Alert.success('สำเร็จ', `สร้างไฟล์ PDF เรียบร้อยแล้วที่: ${uri}`);
      }
    } catch (e: any) {
      Alert.error('เกิดข้อผิดพลาด', e.message);
    }
  };

  const handleShareFamilySummary = async () => {
    try {
      const shareMessage = `
🏡 [รายงานสรุปความปลอดภัยประจำสัปดาห์ - ครอบครัวสุขสันต์]

เหตุการณ์ที่บันทึกของ ${activeMemberName}: ${eventSummary}
- จำนวนครั้งที่ล้ม: ${weekTotal} ครั้ง
- เป็นข้อมูลเหตุการณ์ที่บันทึกไว้ ไม่ใช่ผลประเมินทางการแพทย์

เฝ้าระวังด้วยแอป LookLanCare 💚
      `.trim();

      await Share.share({
        message: shareMessage,
        title: 'สรุปความปลอดภัยครอบครัว',
      });
    } catch (e: any) {
      Alert.error('เกิดข้อผิดพลาด', e.message);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 14) }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoContainer}>
            <MaterialCommunityIcons name="shield-account" size={20} color={colors.accentText} />
          </View>
          <Text style={styles.headerTitle}>LOOKLANCARE</Text>
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={() => router.push('/profile')}>
          {userProfile?.avatar_url ? (
            <Image source={{ uri: userProfile.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
          ) : (
            <MaterialCommunityIcons name="account-outline" size={24} color={colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Page Title */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: colors.textPrimary }}>📊 รายงานสถิติประจำสัปดาห์</Text>
          <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>Weekly Safety & Gait Risk Analytics</Text>
        </View>

        {/* Risk Level Overview Card */}
        <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: riskColor }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>เหตุการณ์ที่บันทึกสัปดาห์นี้</Text>
              <Text style={{ fontSize: 24, fontWeight: '900', color: riskColor, marginTop: 4 }}>{eventSummary}</Text>
            </View>
            <View style={[styles.riskBadge, { backgroundColor: riskBg }]}>
              <MaterialCommunityIcons 
                name={weekTotal === 0 ? "shield-check" : weekTotal <= 2 ? "alert-circle" : "alert-octagon"} 
                size={28} 
                color={riskColor} 
              />
            </View>
          </View>
          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            พบเหตุการณ์ {weekTotal} ครั้งในสัปดาห์นี้
          </Text>
        </View>

        {/* Stats Summary Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.dangerBg }]}>
            <MaterialCommunityIcons name="alert-circle" size={22} color={colors.dangerText} />
            <Text style={styles.statNumber}>{actualFalls}</Text>
            <Text style={styles.statLabel}>AI สงสัยล้ม</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.warningBg }]}>
            <MaterialCommunityIcons name="test-tube" size={22} color="#f59e0b" />
            <Text style={styles.statNumber}>{simulated}</Text>
            <Text style={styles.statLabel}>เหตุจำลอง</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.purpleBg }]}>
            <MaterialCommunityIcons name="bell-ring-outline" size={22} color={colors.purpleText} />
            <Text style={styles.statNumber}>{sosEvents}</Text>
            <Text style={styles.statLabel}>SOS</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.accentBg }]}>
            <MaterialCommunityIcons name="counter" size={22} color={colors.accentText} />
            <Text style={styles.statNumber}>{totalEvents}</Text>
            <Text style={styles.statLabel}>ทั้งหมด</Text>
          </View>
        </View>

        <TouchableOpacity accessibilityRole="button" disabled={simulating} onPress={() => void simulateSOS()}
          style={[styles.card, { minHeight: 48 }]}>
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>{simulating ? 'กำลังบันทึก…' : 'จำลอง SOS'}</Text>
          <Text style={{ color: colors.textSecondary }}>เพิ่มในสถิติและประวัติ โดยไม่ส่งสัญญาณฉุกเฉิน</Text>
        </TouchableOpacity>
        {!!simulationStatus && <Text accessibilityLiveRegion="polite" style={{ color: colors.textPrimary }}>{simulationStatus}</Text>}
        {/* Weekly Fall Events Bar Chart */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <MaterialCommunityIcons name="chart-bar" size={18} color={colors.accentText} />
            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.textPrimary }}>เหตุการณ์ล้ม 7 วันย้อนหลัง</Text>
          </View>
          <View style={styles.chartContainer}>
            {weeklyData.map((day, i) => {
              const barHeight = day.count > 0 ? Math.max(12, (day.count / maxCount) * 80) : 4;
              const isToday = i === 6;
              return (
                <View key={i} style={styles.barGroup}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: day.count > 0 ? colors.dangerText : colors.textMuted, marginBottom: 4 }}>
                    {day.count > 0 ? day.count : ''}
                  </Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: day.count > 0 ? (day.count > 2 ? '#dc2626' : '#f59e0b') : colors.cardBorder,
                        borderRadius: 4,
                      },
                      isToday && { borderWidth: 2, borderColor: colors.accent },
                    ]}
                  />
                  <Text style={[styles.barLabel, isToday && { color: colors.accentText, fontWeight: '900' }]}>{day.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Data availability */}
        <View style={[styles.card, { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentText }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.accentText} />
            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentText }}>ข้อมูลการวิเคราะห์</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.accentText, lineHeight: 20 }}>
            ยังไม่มีข้อมูลการวัดการเดินเซจากเซนเซอร์หรือโมเดลที่ผ่านการตรวจสอบ รายงานนี้แสดงเฉพาะเหตุการณ์ที่บันทึกไว้
          </Text>
        </View>

        {/* Export / Share Info */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShareDoctorReport}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.accentText} />
            <Text style={styles.actionBtnText}>ส่งรายงานให้แพทย์</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.mediaBackground }]} onPress={handleShareFamilySummary}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.onAccent} />
            <Text style={[styles.actionBtnText, { color: colors.onAccent }]}>แชร์ให้ครอบครัว</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.accentText,
    letterSpacing: 1.5,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  riskBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 100,
    paddingHorizontal: 4,
  },
  gaitChartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 90,
    paddingHorizontal: 4,
  },
  barGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: 22,
    minHeight: 4,
  },
  barLabel: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accentBg,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentText,
  },
});
