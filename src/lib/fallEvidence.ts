import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { decode } from 'base64-arraybuffer';
import { v4 as uuidv4 } from 'uuid';
import runtime from '../../android/app/src/main/assets/monitoring/runtime.json';
import { File } from 'expo-file-system';

export interface FallEvidenceRecord {
  id: string;
  family_id?: string;
  member_name: string;
  camera_name: string;
  image_url?: string;
  details?: string;
  ground_duration?: number;
  torso_angle?: number;
  event_type: 'actual' | 'simulated' | 'sos';
  status: 'pending' | 'notified' | 'responded' | 'cancelled';
  resolution_deadline?: string;
  created_at: string;
  cloudSynced?: boolean;
  savedLocally?: boolean;
}

export const STORAGE_KEY_FALL_EVIDENCE = '@fall_evidence_records';

/**
 * Upload Fall Evidence Photo to Supabase Storage Bucket ('fall-evidence')
 */
export async function uploadFallEvidenceImage(
  imageUriOrBase64: string,
  familyId: string
): Promise<string | null> {
  try {
    if (!imageUriOrBase64 || !familyId) return null;
    const isPng = imageUriOrBase64.startsWith('data:image/png;base64,');
    const isJpeg = imageUriOrBase64.startsWith('data:image/jpeg;base64,');
    const name = `${familyId}/${uuidv4()}.${isPng ? 'png' : 'jpg'}`;
    let imageData: ArrayBuffer;
    if (isPng || isJpeg) {
      imageData = decode(imageUriOrBase64.slice(imageUriOrBase64.indexOf(',') + 1));
    } else if (imageUriOrBase64.startsWith('file:')) {
      imageData = await new File(imageUriOrBase64).arrayBuffer();
    } else {
      return null;
    }

    const { error } = await supabase.storage
      .from('fall-evidence')
      .upload(name, imageData, {
        contentType: isPng ? 'image/png' : 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.log('Error uploading evidence to Supabase Storage:', error);
      return null;
    }

    return name;
  } catch (e) {
    console.log('Fallback handling evidence image upload:', e);
    return null;
  }
}

/**
 * Create and Save a new Fall Evidence Event (Cloud DB + Local Storage)
 */
export async function recordFallEvent(params: {
  memberName?: string;
  cameraName?: string;
  imageUri?: string;
  details?: string;
  groundDuration?: number;
  torsoAngle?: number;
  eventType?: 'actual' | 'simulated' | 'sos';
  eventId?: string;
  familyId?: string;
  createdAt?: string;
  notificationSent?: boolean;
  deferCloudSync?: boolean;
  cloudImagePath?: string;
}): Promise<FallEvidenceRecord> {
  const familyId = params.familyId || (await AsyncStorage.getItem('familyId')) || undefined;
  const memberName = params.memberName || 'ยังไม่ยืนยันตัวบุคคล';
  const cameraName = params.cameraName || 'กล้องวงจรปิด';
  const eventType = params.eventType || 'actual';
  const createdAt = params.createdAt || new Date().toISOString();

  const existingData = await AsyncStorage.getItem(STORAGE_KEY_FALL_EVIDENCE);
  const existing = params.eventId && existingData
    ? (JSON.parse(existingData) as FallEvidenceRecord[]).find((record) => record.id === params.eventId && record.family_id === familyId)
    : undefined;
  if (existing?.cloudSynced) return existing;

  const newRecord: FallEvidenceRecord = {
    id: params.eventId || uuidv4(),
    family_id: familyId,
    member_name: memberName,
    camera_name: cameraName,
    image_url: params.imageUri?.startsWith('file:') ? params.imageUri : undefined,
    details: params.details || `ตรวจพบการหกล้มที่ ${cameraName}`,
    ground_duration: params.groundDuration,
    torso_angle: params.torsoAngle,
    event_type: eventType,
    status: params.notificationSent ? 'notified' : 'pending',
    created_at: createdAt,
  };

  newRecord.savedLocally = await saveLocalRecord(newRecord);

  if (params.deferCloudSync) {
    if (params.cloudImagePath && familyId && params.eventId && params.cloudImagePath === `${familyId}/${params.eventId}.jpg`) {
      newRecord.image_url = params.cloudImagePath;
      newRecord.cloudSynced = true;
      newRecord.savedLocally = await saveLocalRecord(newRecord);
    }
    return newRecord;
  }

  const uploadedImage = existing?.image_url && !existing.image_url.startsWith('file:') && !existing.image_url.startsWith('http')
    ? existing.image_url : undefined;
  const evidenceImage = uploadedImage || (params.imageUri && familyId
    ? await uploadFallEvidenceImage(params.imageUri, familyId) || undefined
    : undefined);
  if (evidenceImage) {
    newRecord.image_url = evidenceImage;
    newRecord.savedLocally = await saveLocalRecord(newRecord);
  }

  // Save to Supabase Cloud Database table 'fall_events'
  try {
    if (familyId) {
      if (params.imageUri && !evidenceImage) throw new Error('ภาพหลักฐานยังไม่ซิงก์');
      const payload = {
        id: newRecord.id,
        family_id: familyId,
        member_name: memberName,
        camera_name: cameraName,
        image_url: evidenceImage,
        details: newRecord.details,
        ground_duration: newRecord.ground_duration,
        torso_angle: newRecord.torso_angle,
        event_type: eventType,
        status: newRecord.status,
        created_at: newRecord.created_at,
      };
      const { error } = params.eventId
        ? await supabase.from('fall_events').upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
        : await supabase.from('fall_events').insert(payload);
      if (error) throw error;
      newRecord.cloudSynced = true;
    }
  } catch {
    console.warn('บันทึกเหตุไปยังฐานข้อมูลไม่ได้ เก็บเหตุไว้ในอุปกรณ์');
  }

  // Save to Local Storage fallback
  newRecord.savedLocally = await saveLocalRecord(newRecord);

  return newRecord;
}

let localWrites: Promise<unknown> = Promise.resolve();
async function saveLocalRecord(record: FallEvidenceRecord): Promise<boolean> {
  const write = localWrites.then(async () => {
    const localData = await AsyncStorage.getItem(STORAGE_KEY_FALL_EVIDENCE);
    const list: FallEvidenceRecord[] = localData ? JSON.parse(localData) : [];
    const next = [record, ...list.filter((item) => item.id !== record.id)];
    await AsyncStorage.setItem(STORAGE_KEY_FALL_EVIDENCE, JSON.stringify(next.slice(0, runtime.maxPendingEvents)));
    return true;
  }).catch(() => false);
  localWrites = write;
  return write;
}

/**
 * Load Fall Event Records from Supabase & Local Storage
 */
export async function getFallEvents(): Promise<FallEvidenceRecord[]> {
  const familyId = await AsyncStorage.getItem('familyId');
  if (!familyId) return [];
  let local: FallEvidenceRecord[] = [];
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_FALL_EVIDENCE);
    local = (value ? JSON.parse(value) as FallEvidenceRecord[] : []).filter((record) => record.family_id === familyId);
  } catch { console.warn('อ่านประวัติบนอุปกรณ์ไม่สำเร็จ'); }
  try {
    {
      const { data, error } = await supabase
        .from('fall_events')
        .select('*')
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .limit(runtime.maxPendingEvents);

      if (!error && data && data.length > 0) {
        const merged = new Map(local.map((record) => [record.id, record]));
        for (const record of data as FallEvidenceRecord[]) merged.set(record.id, record);
        return await Promise.all([...merged.values()].sort((left, right) =>
          Date.parse(right.created_at) - Date.parse(left.created_at)).map(signEvidenceUrl));
      }
    }
  } catch (e) {
    console.log('Error reading fall events from cloud:', e);
  }

  // Fallback to local storage
  try {
    return await Promise.all(local.map(signEvidenceUrl));
  } catch (e) {
    console.log('Error reading local fall evidence:', e);
    return [];
  }
}

async function signEvidenceUrl(record: FallEvidenceRecord): Promise<FallEvidenceRecord> {
  const imagePath = record.image_url;
  if (!imagePath || imagePath.startsWith('http') || imagePath.startsWith('file:')) return record;
  const ttl = Number(process.env.EXPO_PUBLIC_EVIDENCE_URL_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl <= 0) return { ...record, image_url: undefined };
  const { data, error } = await supabase.storage.from('fall-evidence').createSignedUrl(imagePath, ttl);
  return { ...record, image_url: error ? undefined : data?.signedUrl };
}
