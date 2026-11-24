import { CareText as Text } from '../../components/CareText';
import { AppAlert as Alert } from '../../lib/appAlert';
import { useTheme, type ThemeColors } from '../../context/ThemeContext';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { testDeviceNotification } from '../../lib/testDeviceNotification';
import { getScheduledTests, type ScheduledTest } from '../../lib/localNotificationHistory';
import { supabase } from '../../lib/supabase';
import { EventDeliveryStatus } from '../../components/EventDeliveryStatus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFallEvents, FallEvidenceRecord } from '../../lib/fallEvidence';
import { callPhoneNumber, getEmergencyPhoneNumber } from '../../lib/phone';
import { getFriendlyErrorMessage } from '../../lib/friendlyError';

interface AlertItem {
  id: string;
  createdAt: number;
  type: 'critical' | 'simulated' | 'sos';
  title: string;
  subtitle: string;
  person: string;
  time: string;
  date: string;
  status: 'pending' | 'responded' | 'notified' | 'cancelled';
  resolutionDeadline?: string;
  imageUrl?: string;
  cameraName?: string;
  groundDuration?: number;
  torsoAngle?: number;
}

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [filter, setFilter] = useState<AlertItem['type'] | 'all'>('all');
  const [testingNotification, setTestingNotification] = useState(false);
  const [scheduledTests, setScheduledTests] = useState<ScheduledTest[]>([]);
  const refreshTestHistory = useRef<(() => void) | null>(null);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  useFocusEffect(useCallback(() => {
    let revision = 0;
    let owner: string | undefined;
    const load = () => {
      const request = ++revision;
      setHistoryUnavailable(false);
      if (!owner) return;
      void getScheduledTests(owner).then(rows => {
        if (request === revision) setScheduledTests(rows);
      }).catch(() => {
        if (request === revision) setHistoryUnavailable(true);
      });
    };
    refreshTestHistory.current = load;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (owner !== session?.user.id || !session) setScheduledTests([]);
      owner = session?.user.id;
      load();
    });
    return () => { revision++; refreshTestHistory.current = null; data.subscription.unsubscribe(); };
  }, []));
  const testing = useRef(false);
  const testNotification = async () => {
    if (testing.current) return;
    testing.current = true; setTestingNotification(true);
    try {
      if (await testDeviceNotification()) {
        setFilter(current => current === 'all' ? current : 'simulated');
        refreshTestHistory.current?.();
      }
    }
    finally { testing.current = false; setTestingNotification(false); }
  };
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [caregiver, setCaregiver] = useState<any>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<AlertItem | null>(null);

  const loadAlertsAndMembers = async () => {
    try {
      setLoadingAlerts(true);
      const familyId = await AsyncStorage.getItem('familyId');

      if (familyId) {
        // Load caregiver
        const { data: cgData } = await supabase
          .from('family_members')
          .select('display_name, role, avatar_url, user_id')
          .eq('family_id', familyId)
          .not('user_id', 'is', null)
          .limit(1)
          .maybeSingle();

        if (cgData) {
          setCaregiver(cgData);
        }
      }

      // Load fall evidence history from Supabase / local
      const events: FallEvidenceRecord[] = await getFallEvents();

      if (events.length > 0) {
        const parsedAlerts: AlertItem[] = events.map((item, idx) => {
          const dateObj = new Date(item.created_at || Date.now());
          const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
          const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
          const isActual = item.event_type === 'actual';

          return {
            id: item.id || idx.toString(),
            createdAt: dateObj.getTime(),
            type: isActual ? 'critical' : item.event_type === 'simulated' ? 'simulated' : 'sos',
            title: isActual ? 'AI สงสัยว่าอาจเกิดการล้ม' : item.event_type === 'sos' ? 'สัญญาณ SOS' : 'เหตุการณ์ทดสอบ',
            subtitle: item.details || `ตรวจพบการหกล้มที่ ${item.camera_name || 'กล้องวงจรปิด'}`,
            person: item.member_name || 'ยังไม่ยืนยันตัวบุคคล',
            time: timeStr,
            date: dateStr,
            status: item.status || 'notified',
            resolutionDeadline: item.resolution_deadline,
            imageUrl: item.image_url || '',
            cameraName: item.camera_name || 'กล้องวงจรปิด',
            groundDuration: item.ground_duration,
            torsoAngle: item.torso_angle,
          };
        });
        setAlerts(parsedAlerts);
      } else {
        setAlerts([]);
      }
    } catch (e) {
      console.log('Error loading alerts:', e);
    } finally {
      setLoadingAlerts(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAlertsAndMembers();

    // Supabase Realtime Subscription for instant alert sync
    const channelName = [
      'realtime_fall_alerts',
      Date.now().toString(),
      Math.random().toString(36).slice(2),
    ].join(':');
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fall_events' },
        () => {
          void loadAlertsAndMembers();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const handleViewEvidence = (alert: AlertItem) => {
    setSelectedEvidence(alert);
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      const { data, error } = await supabase.from('fall_events')
        .update({ status: 'responded' })
        .eq('id', alertId)
        .in('status', ['pending', 'notified'])
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await loadAlertsAndMembers();
        Alert.alert('สถานะเปลี่ยนแล้ว', 'โปรดตรวจสอบรายการเหตุการณ์ล่าสุด');
        return;
      }
      setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, status: 'responded' } : a));

      Alert.success(
        'รับทราบเหตุการณ์แล้ว',
        'ระบบได้ทำการซิงค์บอกทุกคนในบ้านเรียบร้อยแล้วว่าท่านรับทราบและกำลังไปช่วยเหลือ'
      );
    } catch (e: any) {
      console.log('Error acknowledging alert:', e);
      Alert.error('บันทึกการรับทราบไม่สำเร็จ', 'กรุณาลองใหม่');
    }
  };

  const handleCancelPendingAlert = async (alertId: string) => {
    try {
      const { data, error } = await supabase.rpc('cancel_pending_fall', { p_event_id: alertId });
      if (error) throw error;
      if (!data) {
        await loadAlertsAndMembers();
        Alert.alert('หมดเวลายกเลิก', 'เหตุการณ์นี้ได้รับการยืนยันหรือเปลี่ยนสถานะแล้ว');
        return;
      }
      setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, status: 'cancelled' } : a));
      Alert.success('ยกเลิกแล้ว', 'บันทึกเหตุการณ์ไว้เป็นการแจ้งเตือนผิดพลาด');
    } catch (e) {
      console.log('Error cancelling pending fall:', e);
      Alert.error('ยกเลิกไม่สำเร็จ', 'กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
    }
  };

  const confirmCancelPendingAlert = (alertId: string) => {
    Alert.confirm(
      'ยืนยันว่าเป็นเหตุผิดพลาด',
      'ระบบจะหยุดการแจ้งเตือนซ้ำสำหรับเหตุนี้ และเก็บประวัติไว้ตรวจสอบ',
      [
        { text: 'กลับไปตรวจสอบ', style: 'cancel' },
        { text: 'ยืนยันว่าฉันสบายดี', onPress: () => void handleCancelPendingAlert(alertId) },
      ]
    );
  };

  const getStatusBadge = (status: AlertItem['status']) => {
    switch (status) {
      case 'pending':
        return { label: 'รอตรวจสอบ', bg: colors.warningBg, color: colors.warningText };
      case 'responded':
        return { label: 'รับทราบแล้ว', bg: colors.accentBg, color: colors.accentText };
      case 'notified':
        return { label: 'แจ้งแล้ว', bg: colors.warningBg, color: colors.warningText };
      case 'cancelled':
        return { label: 'ยกเลิกแล้ว', bg: colors.inputBg, color: colors.textSecondary };
    }
  };

  const getAlertIcon = (type: AlertItem['type']) => {
    switch (type) {
      case 'critical':
        return { name: 'alert' as const, bg: colors.warningBg, color: colors.warningText };
      case 'simulated':
        return { name: 'lightning-bolt' as const, bg: colors.inputBg, color: colors.textSecondary };
      case 'sos':
        return { name: 'clipboard-text-outline' as const, bg: colors.inputBg, color: colors.textSecondary };
    }
  };

  const getAlertLabel = (type: AlertItem['type']) => {
    switch (type) {
      case 'critical':
        return 'AI สงสัยล้ม';
      case 'simulated':
        return 'เหตุจำลอง';
      case 'sos':
        return 'SOS ขอความช่วยเหลือ';
    }
  };

  const handleCallEmergency = async () => {
    try {
      const opened = await callPhoneNumber(getEmergencyPhoneNumber());
      if (!opened) Alert.error('โทรออกไม่ได้', 'อุปกรณ์นี้ไม่รองรับการโทร กรุณาใช้โทรศัพท์โทรหาเบอร์ฉุกเฉิน');
    } catch (error) {
      Alert.error('โทรออกไม่ได้', getFriendlyErrorMessage(error));
    }
  };

  const visibleAlerts = [
    ...alerts,
    ...scheduledTests.map(test => ({ ...test, type: 'deviceTest' as const })),
  ].filter(item => filter === 'all' || (item.type === 'deviceTest' ? 'simulated' : item.type) === filter)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <View style={styles.safeArea}>
      {/* Red SOS Header */}
      <View style={[styles.sosHeader, { paddingTop: Math.max(insets.top + 10, 16) }]}>
        <View style={styles.sosHeaderContent}>
          <View style={styles.sosIconRow}>
            <View style={styles.sosIconCircle}>
              <MaterialCommunityIcons name="plus-thick" size={20} color={colors.onAccent} />
            </View>
            <View>
              <Text style={styles.sosTitle}>การแจ้งเตือน</Text>
              <Text style={styles.sosSubtitle}>ตรวจเหตุและช่วยเหลือ</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => { refreshTestHistory.current?.(); void loadAlertsAndMembers(); }}>
            <Text style={styles.sosEditLink}>รีเฟรช</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Page Title */}
        <View style={styles.pageTitle}>
          <Text style={styles.pageTitleText}>บันทึกเหตุการณ์</Text>
        </View>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="ทดสอบการแจ้งเตือนบนเครื่องนี้" disabled={testingNotification}
          onPress={() => void testNotification()} style={{ backgroundColor: colors.accent, padding: 16, minHeight: 52, borderRadius: 16, marginBottom: 16, alignItems: 'center' }}>
          {testingNotification ? <ActivityIndicator color={colors.onAccent} /> : <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: '700' }}>ทดสอบการแจ้งเตือน</Text>}
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {([{ key: 'all', label: 'ทั้งหมด' }, { key: 'critical', label: 'AI สงสัยล้ม' }, { key: 'sos', label: 'SOS' }, { key: 'simulated', label: 'ทดสอบ / จำลอง' }] as const).map(item =>
            <TouchableOpacity key={item.key} accessibilityRole="button" accessibilityState={{ selected: filter === item.key }} onPress={() => setFilter(item.key)}
              style={{ minHeight: 48, padding: 12, borderRadius: 14, backgroundColor: filter === item.key ? colors.accentBg : colors.card, borderWidth: 1, borderColor: filter === item.key ? colors.accentText : colors.cardBorder }}>
              <Text style={{ color: filter === item.key ? colors.accentText : colors.textPrimary, fontWeight: '700' }}>{item.label}</Text>
            </TouchableOpacity>)}
        </View>
        {historyUnavailable && <Text style={styles.alertSubtitle}>อ่านประวัติการทดสอบบนเครื่องไม่ได้ กรุณากดรีเฟรช</Text>}
        {!loadingAlerts && !historyUnavailable && !visibleAlerts.length && <View style={{ padding: 28, backgroundColor: colors.card, borderRadius: 18 }}>
          <Text style={{ color: colors.textPrimary, fontSize: 18, textAlign: 'center' }}>ยังไม่มีเหตุการณ์ในหมวดนี้</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 8 }}>เหตุที่บันทึกจะแสดงที่นี่</Text>
        </View>}
        {loadingAlerts && (
          <ActivityIndicator size="large" color={colors.accentText} style={{ marginVertical: 40 }} />
        )}
        {visibleAlerts.map((alert) => {
            if (alert.type === 'deviceTest') return (
              <View key={'device-test:' + alert.id} style={styles.alertCard}>
                <Text style={styles.alertTime}>{new Date(alert.createdAt).toLocaleString('th-TH')}</Text>
                <Text style={styles.alertTitle}>ทดสอบการแจ้งเตือนบนเครื่องนี้</Text>
                <Text style={styles.alertSubtitle}>ตั้งเวลาทดสอบแล้ว</Text>
              </View>
            );
            const statusBadge = getStatusBadge(alert.status);
            const alertIcon = getAlertIcon(alert.type);
            const alertLabel = getAlertLabel(alert.type);

            return (
              <View key={alert.id} style={[styles.alertCard, alert.type === 'critical' && styles.alertCardCritical]}>
                {/* Header Row */}
                <View style={styles.alertHeaderRow}>
                  <View style={styles.alertHeaderLeft}>
                    <View style={[styles.alertIconCircle, { backgroundColor: alertIcon.bg }]}>
                      <MaterialCommunityIcons name={alertIcon.name} size={16} color={alertIcon.color} />
                    </View>
                    <Text style={[styles.alertLabel, alert.type === 'critical' && { color: colors.warningText }]}>
                      {alertLabel}
                    </Text>
                  </View>
                  <Text style={styles.alertTime}>
                    {alert.time} {alert.date}
                  </Text>
                </View>

                {/* Title + Status Row */}
                <View style={styles.alertTitleRow}>
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusBadge.color }]}>
                      {statusBadge.label}
                    </Text>
                  </View>
                </View>

                {/* Subtitle */}
                <Text style={styles.alertSubtitle}>{alert.subtitle}</Text>
                {alert.status === 'pending' && alert.resolutionDeadline && (
                  <Text style={styles.alertSubtitle}>
                    ยกเลิกเหตุผิดพลาดได้ก่อน {new Date(alert.resolutionDeadline).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.
                  </Text>
                )}

                {/* Person Name */}
                <View style={styles.personRow}>
                  <MaterialCommunityIcons name="account-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.personName}>{alert.person}</Text>
                </View>

                {/* Action Buttons */}
                {alert.type === 'critical' || alert.type === 'sos' ? (
                  <View style={styles.alertActionsColumn}>
                    <View style={styles.alertActions}>
                      {alert.status === 'pending' || alert.status === 'notified' ? (
                        <TouchableOpacity
                          style={[styles.callBtn, { backgroundColor: '#059669', flex: 1.3 }]}
                          onPress={() => void handleAcknowledgeAlert(alert.id)}
                        >
                          <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.onAccent} />
                          <Text style={styles.callBtnText}>รับทราบ / กำลังช่วยเหลือ</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.callBtn, { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentText, flex: 1.3 }]}>
                          <MaterialCommunityIcons name="check-circle" size={16} color={colors.accentText} />
                          <Text style={[styles.callBtnText, { color: colors.accentText, fontWeight: '800' }]}>{alert.status === 'cancelled' ? 'ยกเลิกแล้ว' : 'รับทราบแล้ว'}</Text>
                        </View>
                      )}
                      <TouchableOpacity style={styles.callBtn} onPress={() => void handleCallEmergency()}>
                        <MaterialCommunityIcons name="phone" size={16} color={colors.onAccent} />
                        <Text style={styles.callBtnText}>โทรฉุกเฉิน</Text>
                      </TouchableOpacity>
                    </View>
                    {alert.type === 'critical' && alert.status === 'pending' && (
                      <TouchableOpacity style={styles.evidenceBtn} onPress={() => confirmCancelPendingAlert(alert.id)}>
                        <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.warningText} />
                        <Text style={[styles.evidenceBtnText, { color: colors.warningText }]}>ฉันสบายดี / ยกเลิกเหตุผิดพลาด</Text>
                      </TouchableOpacity>
                    )}
                    {alert.type === 'critical' ? <EventDeliveryStatus eventId={alert.id} /> : null}
                    <TouchableOpacity style={styles.evidenceBtn} onPress={() => handleViewEvidence(alert)}>
                      <MaterialCommunityIcons name="camera-burst" size={16} color={colors.infoText} />
                      <Text style={styles.evidenceBtnText}>ดูรูปถ่าย / หลักฐานการล้มสด</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.evidenceBtnSmall} onPress={() => handleViewEvidence(alert)}>
                    <MaterialCommunityIcons name="image-search-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.evidenceBtnSmallText}>ดูรูปถ่าย / หลักฐาน</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

        {/* Family Lead / Caregiver */}
        <View style={styles.caregiverCard}>
          <View style={[styles.infoCardIconCircle, { backgroundColor: colors.inputBg }]}>
            <MaterialCommunityIcons name="account-heart-outline" size={22} color={colors.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoCardLabel}>FAMILY CAREGIVER</Text>
            <Text style={styles.infoCardTitle}>
              {caregiver ? caregiver.display_name : 'ยังไม่ได้กำหนด'}
            </Text>
            {caregiver && <Text style={styles.caregiverRole}>{caregiver.role}</Text>}
          </View>
        </View>
      </ScrollView>

      {/* Fall Evidence Image Viewer Modal */}
      <Modal visible={!!selectedEvidence} animationType="slide" transparent onRequestClose={() => setSelectedEvidence(null)}>
        {selectedEvidence && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons name="camera" size={20} color={colors.infoText} />
                  <Text style={styles.modalTitle}>หลักฐานภาพถ่ายขณะเกิดเหตุ</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedEvidence(null)}>
                  <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Evidence Snapshot Image */}
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: selectedEvidence.imageUrl }}
                  style={styles.evidenceImage}
                  contentFit="cover"
                />
                <View style={styles.imageOverlayBadge}>
                  <Text style={styles.imageOverlayBadgeText}>ภาพขณะตรวจพบเหตุ</Text>
                </View>
              </View>

              {/* Details List */}
              <View style={styles.detailsBox}>
                <Text style={styles.detailTitle}>{selectedEvidence.title}</Text>
                <Text style={styles.detailText}>👤 การระบุตำแหน่ง: {selectedEvidence.person}</Text>
                <Text style={styles.detailText}>📍 ตำแหน่ง: {selectedEvidence.cameraName || 'กล้องวงจรปิด'}</Text>
                <Text style={styles.detailText}>⏰ เวลา: {selectedEvidence.time} ({selectedEvidence.date})</Text>
                {selectedEvidence.groundDuration !== undefined && (
                  <Text style={styles.detailText}>⏱️ ระยะเวลานอนติดพื้น: {selectedEvidence.groundDuration} วินาที</Text>
                )}
                {selectedEvidence.torsoAngle !== undefined && (
                  <Text style={styles.detailText}>📐 มุมเอียงลำตัว: {selectedEvidence.torsoAngle}°</Text>
                )}
              </View>

              {/* Modal Actions */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity style={[styles.callBtn, { flex: 1 }]} onPress={() => void handleCallEmergency()}>
                  <MaterialCommunityIcons name="phone" size={16} color={colors.onAccent} />
                  <Text style={styles.callBtnText}>โทรฉุกเฉินด่วน</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.contactBtn, { flex: 1 }]}
                  onPress={() => setSelectedEvidence(null)}
                >
                  <Text style={styles.contactBtnText}>ปิดหน้าต่าง</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sosHeader: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sosHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sosIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sosIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sosTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.onAccent,
    letterSpacing: 1,
  },
  sosSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  sosEditLink: {
    fontSize: 13,
    color: colors.onAccent,
    textDecorationLine: 'underline',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  pageTitle: {
    marginBottom: 20,
  },
  pageTitleText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    lineHeight: 30,
  },
  alertCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  alertCardCritical: {
    borderColor: colors.warningBorder,
    borderWidth: 2,
    backgroundColor: colors.warningBg,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  alertLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  alertTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  alertTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  alertSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  personName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginLeft: 6,
  },
  alertActionsColumn: {
    marginTop: 14,
    gap: 10,
  },
  alertActions: {
    flexDirection: 'row',
    gap: 12,
  },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  callBtnText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: 'bold',
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 6,
  },
  contactBtnText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  evidenceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoBg,
    borderRadius: 10,
    paddingVertical: 11,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  evidenceBtnText: {
    color: colors.infoText,
    fontSize: 13,
    fontWeight: 'bold',
  },
  evidenceBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  evidenceBtnSmallText: {
    color: colors.textSecondary,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  caregiverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 14,
    marginBottom: 16,
  },
  infoCardIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCardLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  infoCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  caregiverRole: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  imageContainer: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.mediaBackground,
    position: 'relative',
    marginBottom: 12,
  },
  evidenceImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  imageOverlayBadgeText: {
    color: colors.onAccent,
    fontSize: 9,
    fontWeight: '900',
  },
  detailsBox: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 4,
  },
  detailTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.dangerText,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
