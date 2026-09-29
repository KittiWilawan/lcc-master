import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { recordFallEvent } from '../lib/fallEvidence';
import { sendLocalFallNotification } from '../lib/pushNotifications';
import { startBackgroundMonitoring, stopBackgroundMonitoring } from '../lib/backgroundMonitoring';
import { describeCameraAttribution } from '../lib/cameraAnalysis';
import { getTrackedMemberIds, shouldMonitorCamera, usesAllPeopleMode } from '../lib/monitoringPolicy';
import { supabase } from '../lib/supabase';
import { MonitoredCameraFeed } from './MonitoredCameraFeed';

interface MonitoredCamera {
  id: string;
  name: string;
  type: 'video' | 'device' | 'rtsp';
  url?: string;
  snapshot_url?: string;
  assigned_member_name?: string;
}

interface Props {
  session: Session | null;
}

function getRefreshInterval(): number {
  const configured = Number(process.env.EXPO_PUBLIC_BACKGROUND_CONFIG_REFRESH_MS);
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new Error('ตั้งค่าเวลาตรวจข้อมูลกล้องเบื้องหลังไม่ถูกต้อง');
  }
  return configured;
}

export function BackgroundMonitoringController({ session }: Props) {
  const [cameras, setCameras] = useState<MonitoredCamera[]>([]);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android' || !session) {
      setCameras([]);
      await stopBackgroundMonitoring().catch(() => false);
      return;
    }
    const familyId = await AsyncStorage.getItem('familyId');
    if (!familyId) {
      setCameras([]);
      await stopBackgroundMonitoring();
      return;
    }
    const [{ data, error }, { data: members, error: membersError }] = await Promise.all([
      supabase
        .from('cameras')
        .select('id,name,type,url,snapshot_url,assigned_member_id,family_members(display_name,is_tracked)')
        .eq('family_id', familyId),
      supabase
        .from('family_members')
        .select('id,is_tracked')
        .eq('family_id', familyId)
        .is('user_id', null),
    ]);
    if (error) throw error;
    if (membersError) throw membersError;
    const trackedMemberIds = getTrackedMemberIds(members ?? []);
    const allPeopleMode = usesAllPeopleMode(trackedMemberIds);
    const monitored = (data ?? []).flatMap((camera: any) => {
      const member = Array.isArray(camera.family_members) ? camera.family_members[0] : camera.family_members;
      if (camera.type === 'device' || !shouldMonitorCamera(camera, trackedMemberIds)) return [];
      return [{
        id: camera.id,
        name: camera.name,
        type: camera.type || 'rtsp',
        url: camera.url || undefined,
        snapshot_url: camera.snapshot_url,
        assigned_member_name: allPeopleMode ? undefined : member?.display_name || undefined,
      } satisfies MonitoredCamera];
    });
    setCameras(monitored);
    if (monitored.length > 0) await startBackgroundMonitoring();
    else await stopBackgroundMonitoring();
  }, [session]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = async () => {
      try {
        await refresh();
      } catch (error) {
        console.log('Background monitoring refresh notice:', error);
      }
    };
    if (active) void run();
    try {
      timer = setInterval(() => void run(), getRefreshInterval());
    } catch (error) {
      console.log('Background monitoring configuration notice:', error);
    }
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh]);

  if (Platform.OS !== 'android' || !session) return null;

  return (
    <View pointerEvents="none" style={{ width: 0, height: 0, overflow: 'hidden' }}>
      {cameras.map((camera) => (
        <MonitoredCameraFeed
          key={camera.id}
          camera={camera}
          monitoring
          displayStream={false}
          onFallDetected={(image, analysis) => {
            const personName = camera.assigned_member_name || 'บุคคลที่ตรวจพบ';
            const attribution = describeCameraAttribution(camera.assigned_member_name, analysis);
            void sendLocalFallNotification({ personName, cameraName: camera.name });
            void recordFallEvent({
              memberName: personName,
              cameraName: camera.name,
              imageUri: image,
              eventType: 'actual',
              details: attribution,
            });
          }}
        />
      ))}
    </View>
  );
}
