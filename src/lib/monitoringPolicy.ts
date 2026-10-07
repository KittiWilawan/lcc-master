import { resolveCameraSource } from './cameraSource';

export interface MonitoringMember {
  id: string;
  is_tracked: boolean;
}

export interface MonitoringCamera {
  type: 'video' | 'device' | 'rtsp';
  snapshot_url?: string | null;
  url?: string | null;
  assigned_member_id?: string | null;
}

export function getTrackedMemberIds(members: MonitoringMember[]): Set<string> {
  return new Set(members.filter((member) => member.is_tracked).map((member) => member.id));
}

export function isCameraReadyForAnalysis(camera: MonitoringCamera): boolean {
  return camera.type === 'device' || Boolean(resolveCameraSource(camera));
}

export function shouldMonitorCamera(camera: MonitoringCamera, trackedMemberIds: Set<string>): boolean {
  if (!isCameraReadyForAnalysis(camera)) return false;
  if (trackedMemberIds.size === 0) return true;
  return Boolean(camera.assigned_member_id && trackedMemberIds.has(camera.assigned_member_id));
}

export function usesAllPeopleMode(trackedMemberIds: Set<string>): boolean {
  return trackedMemberIds.size === 0;
}
