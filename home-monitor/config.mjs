import { readFile } from 'node:fs/promises';
import {
  readNonNegativeInteger, readPositiveInteger, readProbability, requireString, requireUuid,
} from './core.mjs';

function requireUrl(name, source, protocols) {
  const value = requireString(name, source);
  const url = new URL(value);
  if (!protocols.includes(url.protocol)) throw new Error(`${name} ใช้ protocol ไม่ถูกต้อง`);
  return url.toString();
}

export function readAllowedOrigins(source) {
  return requireString('HOME_MONITOR_ALLOWED_ORIGINS', source).split(',').map((entry) => {
    const url = new URL(entry.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('HOME_MONITOR_ALLOWED_ORIGINS ต้องเป็น origin ของเกตเวย์กล้อง');
    }
    return url.origin;
  });
}

export async function loadConfig(source = process.env) {
  const instructionsPath = requireString('HOME_MONITOR_INSTRUCTIONS_FILE', source);
  const instructions = (await readFile(instructionsPath, 'utf8')).trim();
  if (!instructions) throw new Error('ไฟล์คำสั่งโมเดลว่าง');
  const deviceCredentialsFile = requireString('HOME_MONITOR_DEVICE_CREDENTIALS_FILE', source);
  let deviceCredentials = null;
  try {
    const value = JSON.parse(await readFile(deviceCredentialsFile, 'utf8'));
    deviceCredentials = {
      familyId: requireUuid('familyId', value),
      deviceId: requireUuid('deviceId', value),
      name: requireString('name', value),
      token: requireString('token', value),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('ไฟล์จับคู่คอมไม่ถูกต้อง กรุณาเชื่อมต่อคอมใหม่');
  }
  const familyId = deviceCredentials?.familyId ?? requireUuid('HOME_MONITOR_FAMILY_ID', source);
  const ollamaUrl = new URL(requireUrl('OLLAMA_API_URL', source, ['http:', 'https:']));
  if (ollamaUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(ollamaUrl.hostname)) {
    throw new Error('OLLAMA_API_URL ที่ไม่เข้ารหัสต้องชี้มาที่คอมเครื่องนี้');
  }
  return {
    supabaseUrl: requireUrl('SUPABASE_URL', source, ['https:']),
    supabaseKey: requireString('SUPABASE_ANON_KEY', source),
    email: deviceCredentials ? null : requireString('HOME_MONITOR_EMAIL', source),
    password: deviceCredentials ? null : requireString('HOME_MONITOR_PASSWORD', source),
    familyId,
    connectionMode: deviceCredentials ? 'device' : 'account',
    deviceCredentialsFile,
    deviceFunctionName: requireString('MONITOR_DEVICE_FUNCTION_NAME', source),
    allowedOrigins: readAllowedOrigins(source),
    enforceAllowedOrigins: !deviceCredentials,
    ffmpegCommand: requireString('FFMPEG_COMMAND', source),
    poseModelUrl: requireUrl('POSE_MODEL_URL', source, ['http:', 'https:']),
    poseModelTimeoutMs: readPositiveInteger('POSE_MODEL_TIMEOUT_MS', source),
    poseModelFrames: readPositiveInteger('POSE_MODEL_FRAMES', source),
    ollamaUrl: ollamaUrl.toString(),
    model: requireString('OLLAMA_MODEL', source),
    contextLength: readPositiveInteger('OLLAMA_CONTEXT_LENGTH', source),
    gpuLayers: readNonNegativeInteger('OLLAMA_GPU_LAYERS', source),
    instructions,
    pushUrl: requireUrl('EXPO_PUSH_URL', source, ['https:']),
    intervalMs: readPositiveInteger('HOME_MONITOR_INTERVAL_MS', source),
    healthIntervalMs: readPositiveInteger('HOME_MONITOR_HEALTH_INTERVAL_MS', source),
    startupRetries: readPositiveInteger('HOME_MONITOR_STARTUP_RETRIES', source),
    startupRetryMs: readPositiveInteger('HOME_MONITOR_STARTUP_RETRY_MS', source),
    refreshMs: readPositiveInteger('HOME_MONITOR_CAMERA_REFRESH_MS', source),
    imageTimeoutMs: readPositiveInteger('HOME_MONITOR_IMAGE_TIMEOUT_MS', source),
    modelTimeoutMs: readPositiveInteger('HOME_MONITOR_MODEL_TIMEOUT_MS', source),
    maxAnalysisMs: readPositiveInteger('HOME_MONITOR_MAX_ANALYSIS_MS', source),
    maxImageBytes: readPositiveInteger('HOME_MONITOR_MAX_IMAGE_BYTES', source),
    confidence: readProbability('HOME_MONITOR_FALL_CONFIDENCE', source),
    identityConfidence: readProbability('HOME_MONITOR_IDENTITY_CONFIDENCE', source),
    confirmations: readPositiveInteger('HOME_MONITOR_CONFIRMATIONS', source),
    cooldownMs: readPositiveInteger('HOME_MONITOR_ALERT_COOLDOWN_MS', source),
    cancelWindowMs: readPositiveInteger('HOME_MONITOR_CANCEL_WINDOW_MS', source),
  };
}
