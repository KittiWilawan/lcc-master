import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RealStreamPlayer } from './RealStreamPlayer';
import { MonitoredCameraFeed } from './MonitoredCameraFeed';
import type { CameraAnalysis } from '../lib/cameraAnalysis';
import { parseStreamUrl } from '../lib/streamSource';

interface FullScreenCameraModalProps {
  visible: boolean;
  camera: {
    id: string;
    name: string;
    type: 'video' | 'device' | 'rtsp';
    url?: string;
    snapshot_url?: string;
    protocol?: 'rtsp' | 'rtmp' | 'hls' | 'mp4' | 'unknown';
    assigned_member_name?: string;
  } | null;
  onClose: () => void;
  monitoring?: boolean;
  onFallDetected?: (image: string, analysis: CameraAnalysis) => void;
}

export const FullScreenCameraModal = React.memo(function FullScreenCameraModal({
  visible,
  camera,
  onClose,
  monitoring = true,
  onFallDetected,
}: FullScreenCameraModalProps) {
  if (!camera) return null;

  const streamInfo = camera.url ? parseStreamUrl(camera.url) : { protocol: 'unknown', isLiveStream: false, displayUrl: '' };
  const streamBadgeText = 
    camera.type === 'device' ? 'LOCAL CAMERA' :
    streamInfo.protocol === 'rtsp' ? 'RTSP ไม่รองรับโดยตรง' :
    streamInfo.protocol === 'hls' ? 'HLS LIVE STREAM' :
    streamInfo.protocol === 'rtmp' ? 'RTMP ไม่รองรับโดยตรง' :
    streamInfo.protocol === 'mp4' ? 'วิดีโอ' : 'กล้อง';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Fullscreen Video/Camera Feed */}
        {onFallDetected || monitoring ? (
          <MonitoredCameraFeed camera={camera} style={styles.fullFeed} monitoring={monitoring} onFallDetected={onFallDetected} />
        ) : (
          <RealStreamPlayer type={camera.type} url={camera.url} style={styles.fullFeed} />
        )}

        {/* Top Control Header Bar */}
        <View style={styles.topHeader}>
          <View style={styles.headerLeft}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{streamBadgeText}</Text>
            </View>
            <Text style={styles.cameraName} numberOfLines={1}>{camera.name}</Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <MaterialCommunityIcons name="fullscreen-exit" size={24} color="#ffffff" />
            <Text style={styles.closeBtnText}>ย่อหน้าจอ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
  fullFeed: {
    width: '100%',
    height: '100%',
  },
  topHeader: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  liveText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cameraName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  closeBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
