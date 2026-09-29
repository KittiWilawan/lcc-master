import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { getFallEvents, FallEvidenceRecord } from '../../lib/fallEvidence';
import { supabase } from '../../lib/supabase';

export interface HistoryEvent {
  id: string;
  type: 'actual' | 'simulated' | 'sos';
  timestamp: string;
  details?: string;
  member_name?: string;
  camera_name?: string;
  image_url?: string;
  ground_duration?: number;
  torso_angle?: number;
  status?: string;
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch from Supabase fall_events (with local fallback)
      const events: FallEvidenceRecord[] = await getFallEvents();

      if (events && events.length > 0) {
        const parsed: HistoryEvent[] = events.map((e) => ({
          id: e.id,
          type: (e.event_type as 'actual' | 'simulated' | 'sos') || 'actual',
          timestamp: e.created_at,
          details: e.details,
          member_name: e.member_name,
          camera_name: e.camera_name,
          image_url: e.image_url,
          ground_duration: e.ground_duration,
          torso_angle: e.torso_angle,
          status: e.status,
        }));
        parsed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setHistory(parsed);
      } else {
        setHistory([]);
      }
    } catch (e) {
      console.log('Error loading history', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory])
  );

  const clearHistory = () => {
    Alert.alert(
      'ล้างประวัติเหตุการณ์',
      'คุณต้องการล้างประวัติเหตุการณ์ทั้งหมดใช่หรือไม่?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ล้างทั้งหมด',
          style: 'destructive',
          onPress: async () => {
            try {
              const familyId = await AsyncStorage.getItem('familyId');
              if (familyId) {
                await supabase.from('fall_events').delete().eq('family_id', familyId);
              }
              await AsyncStorage.removeItem('@fall_history');
              await AsyncStorage.removeItem('@fall_evidence_records');
              setHistory([]);
            } catch (e) {
              console.log('Error clearing history', e);
            }
          },
        },
      ]
    );
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 14) }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoPlaceholder}>
            <MaterialCommunityIcons name="clock-outline" size={20} color="#059669" />
          </View>
          <Text style={styles.headerTitle}>ประวัติเหตุการณ์ (Cloud)</Text>
        </View>

        {history.length > 0 && (
          <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>ล้างทั้งหมด</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>ประวัติการตรวจจับการล้ม</Text>
          <Text style={styles.pageSubtitle}>บันทึกเหตุการณ์ฉุกเฉินและภาพหลักฐาน ซิงค์ผ่าน Supabase Cloud</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#059669" style={{ marginTop: 40 }} />
        ) : history.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>ยังไม่มีประวัติเหตุการณ์</Text>
            <Text style={styles.emptySubtext}>เหตุการณ์ปกติดี ไม่มีใครล้ม</Text>
          </View>
        ) : (
          <View style={styles.timeline}>
            {history.map((event, index) => {
              const isActual = event.type === 'actual';
              const isSos = event.type === 'sos';
              return (
                <View key={event.id || index} style={styles.timelineItem}>
                  <View style={styles.timelineLine}>
                    {index !== history.length - 1 && <View style={styles.line} />}
                    <View
                      style={[
                        styles.dot,
                        isActual ? styles.dotRed : isSos ? styles.dotPurple : styles.dotYellow,
                      ]}
                    />
                  </View>

                  <View style={styles.eventCard}>
                    <View style={styles.eventHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.eventTitle}>
                          {isActual
                            ? '🚨 แจ้งเตือนเหตุที่ AI สงสัยว่าอาจล้ม'
                            : isSos
                            ? '🆘 สัญญาณขอความช่วยเหลือ'
                            : '⚡ ทดสอบจำลองเหตุฉุกเฉิน'}
                        </Text>
                      </View>
                      <Text style={styles.eventTime}>{formatTime(event.timestamp)}</Text>
                    </View>

                    {/* Member & Location Info */}
                    <View style={styles.metaRow}>
                      <View style={styles.metaBadge}>
                        <MaterialCommunityIcons name="account-heart" size={13} color="#059669" />
                        <Text style={styles.metaBadgeText}>
                          {event.member_name || 'ยังไม่ยืนยันตัวบุคคล'}
                        </Text>
                      </View>
                      <View style={[styles.metaBadge, { backgroundColor: '#f1f5f9' }]}>
                        <MaterialCommunityIcons name="cctv" size={13} color="#64748b" />
                        <Text style={[styles.metaBadgeText, { color: '#475569' }]}>
                          {event.camera_name || 'กล้องวงจรปิด'}
                        </Text>
                      </View>
                    </View>

                    {/* Kinematics Telemetry (Torso angle & Ground duration) */}
                    {(event.torso_angle !== undefined || event.ground_duration !== undefined) && (
                      <View style={styles.telemetryRow}>
                        {event.torso_angle !== undefined && (
                          <Text style={styles.telemetryText}>
                            📐 มุมลำตัว: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{event.torso_angle}°</Text>
                          </Text>
                        )}
                        {event.ground_duration !== undefined && (
                          <Text style={styles.telemetryText}>
                            ⏱️ นอนติดพื้น: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{event.ground_duration}s</Text>
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Image Snapshot Thumbnail if available */}
                    {event.image_url && (
                      <TouchableOpacity
                        onPress={() => setSelectedPhoto(event.image_url || null)}
                        style={styles.thumbnailContainer}
                      >
                        <Image
                          source={{ uri: event.image_url }}
                          style={styles.thumbnailImage}
                          contentFit="cover"
                        />
                        <View style={styles.thumbnailOverlay}>
                          <MaterialCommunityIcons name="magnify-plus-outline" size={16} color="#ffffff" />
                          <Text style={styles.thumbnailText}>ดูภาพหลักฐาน</Text>
                        </View>
                      </TouchableOpacity>
                    )}

                    {event.details ? (
                      <Text style={styles.eventDetailsText}>{event.details}</Text>
                    ) : null}

                    <View style={styles.eventFooterRow}>
                      <View style={styles.eventDetailsRow}>
                        <MaterialCommunityIcons
                          name={isActual ? 'alert-circle' : isSos ? 'bell-ring' : 'shield-alert-outline'}
                          size={15}
                          color={isActual ? '#ef4444' : isSos ? '#9333ea' : '#eab308'}
                        />
                        <Text style={styles.eventDate}>{formatDate(event.timestamp)}</Text>
                      </View>

                      <View
                        style={[
                          styles.statusBadge,
                          event.status === 'responded'
                            ? styles.statusResponded
                            : styles.statusNotified,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            event.status === 'responded'
                              ? styles.statusRespondedText
                              : styles.statusNotifiedText,
                          ]}
                        >
                          {event.status === 'responded' ? '✓ ช่วยเหลือแล้ว' : 'แจ้งเตือนแล้ว'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Fullscreen Photo Modal */}
      <Modal visible={!!selectedPhoto} transparent animationType="fade">
        <View style={styles.modalBg}>
          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={() => setSelectedPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          {selectedPhoto && (
            <Image
              source={{ uri: selectedPhoto }}
              style={styles.modalFullImage}
              contentFit="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: '#ecfdf5',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#059669',
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  pageHeader: {
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  timeline: {
    marginTop: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  timelineLine: {
    width: 24,
    alignItems: 'center',
    marginRight: 12,
  },
  line: {
    position: 'absolute',
    top: 24,
    bottom: -20,
    width: 2,
    backgroundColor: '#e2e8f0',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  dotRed: {
    backgroundColor: '#ef4444',
  },
  dotYellow: {
    backgroundColor: '#eab308',
  },
  dotPurple: {
    backgroundColor: '#9333ea',
  },
  eventCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  eventTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#065f46',
  },
  telemetryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
  },
  telemetryText: {
    fontSize: 11,
    color: '#64748b',
  },
  thumbnailContainer: {
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 8,
    backgroundColor: '#0f172a',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  thumbnailText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  eventDetailsText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 8,
  },
  eventFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  eventDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDate: {
    fontSize: 11,
    color: '#94a3b8',
    marginLeft: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusNotified: {
    backgroundColor: '#fef3c7',
  },
  statusNotifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  statusResponded: {
    backgroundColor: '#dcfce7',
  },
  statusRespondedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
  },
  modalFullImage: {
    width: '100%',
    height: '80%',
  },
});
