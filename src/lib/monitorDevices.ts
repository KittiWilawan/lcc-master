import { supabase } from './supabase';

export interface MonitorDevice {
  id: string;
  name: string;
  state: 'idle' | 'running' | 'degraded' | 'stopped';
  detail: string | null;
  camera_count: number;
  analyzed_count: number;
  error_count: number;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface MonitorPairingCode {
  code: string;
  expiresAt: string;
}

interface FunctionErrorPayload {
  error?: string;
}

function monitorFunctionName(): string {
  const name = process.env.EXPO_PUBLIC_MONITOR_DEVICE_FUNCTION_NAME?.trim();
  if (!name) throw new Error('ยังไม่ได้ตั้งค่าบริการเชื่อมต่อคอม');
  return name;
}

async function readFunctionError(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return 'บริการเชื่อมต่อคอมไม่ตอบกลับ';
  const context = 'context' in error ? error.context : null;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as FunctionErrorPayload;
      if (payload.error) return payload.error;
    } catch {
      // The response did not contain a JSON error body.
    }
  }
  return 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'บริการเชื่อมต่อคอมไม่ตอบกลับ';
}

async function invokeMonitorFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(monitorFunctionName(), { body });
  if (error) throw new Error(await readFunctionError(error));
  const payload = data as T & FunctionErrorPayload;
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

export async function canManageMonitorDevices(familyId: string): Promise<boolean> {
  const [{ data: auth }, { data: family, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('families').select('owner_id').eq('id', familyId).maybeSingle(),
  ]);
  if (error) throw error;
  return Boolean(auth.user && family?.owner_id === auth.user.id);
}

export async function createMonitorPairingCode(familyId: string): Promise<MonitorPairingCode> {
  return invokeMonitorFunction<MonitorPairingCode>({ action: 'create-pairing', familyId });
}

export async function listMonitorDevices(familyId: string): Promise<MonitorDevice[]> {
  const payload = await invokeMonitorFunction<{ devices: MonitorDevice[] }>({ action: 'list-devices', familyId });
  return payload.devices;
}

export async function revokeMonitorDevice(familyId: string, deviceId: string): Promise<void> {
  await invokeMonitorFunction<{ revoked: boolean }>({ action: 'revoke-device', familyId, deviceId });
}
