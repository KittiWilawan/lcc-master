export type StreamProtocol = 'rtsp' | 'rtmp' | 'hls' | 'mp4' | 'unknown';

export function parseStreamUrl(url: string): {
  protocol: StreamProtocol;
  isLiveStream: boolean;
  displayUrl: string;
} {
  const displayUrl = url.trim();
  if (!displayUrl) return { protocol: 'unknown', isLiveStream: false, displayUrl };

  try {
    const parsed = new URL(displayUrl);
    if (parsed.protocol === 'rtsp:') return { protocol: 'rtsp', isLiveStream: true, displayUrl };
    if (parsed.protocol === 'rtmp:') return { protocol: 'rtmp', isLiveStream: true, displayUrl };
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.m3u8')) return { protocol: 'hls', isLiveStream: true, displayUrl };
    if (path.endsWith('.mp4')) return { protocol: 'mp4', isLiveStream: false, displayUrl };
  } catch {
    return { protocol: 'unknown', isLiveStream: false, displayUrl };
  }
  return { protocol: 'unknown', isLiveStream: true, displayUrl };
}
