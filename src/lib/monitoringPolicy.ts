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

export function shouldMonitorCamera(camera: MonitoringCamera, _trackedMemberIds: Set<string>): boolean {
  return isCameraReadyForAnalysis(camera);
}

export function getCameraTargetMemberIds(camera: MonitoringCamera, trackedMemberIds: Set<string>): string[] {
  if (camera.assigned_member_id && trackedMemberIds.has(camera.assigned_member_id)) return [camera.assigned_member_id];
  return [...trackedMemberIds].sort();
}

export function usesAllPeopleMode(trackedMemberIds: Set<string>): boolean {
  return trackedMemberIds.size === 0;
}
