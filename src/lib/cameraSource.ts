export interface ExternalCameraSource { type: 'video' | 'device' | 'rtsp'; url?: string | null; snapshot_url?: string | null }

export function resolveCameraSource(camera: ExternalCameraSource): string | null {
  if (camera.type === 'device') return null;
  for (const value of [camera.url, camera.snapshot_url]) {
    if (!value?.trim()) continue;
    try {
      const source = new URL(value.trim());
      if (source.protocol === 'http:' || source.protocol === 'https:') return source.toString();
    } catch { /* Ignore incomplete camera addresses. */ }
  }
  return null;
}
