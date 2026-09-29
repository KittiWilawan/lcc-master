import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { decode } from 'base64-arraybuffer';
import { v4 as uuidv4 } from 'uuid';

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
    let imageData: Blob | ArrayBuffer;
    if (isPng || isJpeg) {
      imageData = decode(imageUriOrBase64.slice(imageUriOrBase64.indexOf(',') + 1));
    } else if (imageUriOrBase64.startsWith('file:')) {
      const response = await fetch(imageUriOrBase64);
      imageData = await response.blob();
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
}): Promise<FallEvidenceRecord> {
  const familyId = (await AsyncStorage.getItem('familyId')) || undefined;
  const memberName = params.memberName || 'ยังไม่ยืนยันตัวบุคคล';
  const cameraName = params.cameraName || 'กล้องวงจรปิด';
  const eventType = params.eventType || 'actual';
  const createdAt = new Date().toISOString();

  const evidenceImage = params.imageUri && familyId
    ? await uploadFallEvidenceImage(params.imageUri, familyId) || undefined
    : undefined;

  const newRecord: FallEvidenceRecord = {
    id: Date.now().toString(),
    family_id: familyId,
    member_name: memberName,
    camera_name: cameraName,
    image_url: evidenceImage,
    details: params.details || `ตรวจพบการหกล้มที่ ${cameraName}`,
    ground_duration: params.groundDuration,
    torso_angle: params.torsoAngle,
    event_type: eventType,
    status: 'notified',
    created_at: createdAt,
  };

  // Save to Supabase Cloud Database table 'fall_events'
  try {
    if (familyId) {
      const { error } = await supabase.from('fall_events').insert({
        family_id: familyId,
        member_name: memberName,
        camera_name: cameraName,
        image_url: evidenceImage,
        details: newRecord.details,
        ground_duration: newRecord.ground_duration,
        torso_angle: newRecord.torso_angle,
        event_type: eventType,
        status: newRecord.status,
      });
      if (error) throw error;
    }
  } catch (e) {
    console.log('Error writing fall event to Supabase:', e);
  }

  // Save to Local Storage fallback
  try {
    const localData = await AsyncStorage.getItem(STORAGE_KEY_FALL_EVIDENCE);
    const list: FallEvidenceRecord[] = localData ? JSON.parse(localData) : [];
    list.unshift(newRecord);
    await AsyncStorage.setItem(STORAGE_KEY_FALL_EVIDENCE, JSON.stringify(list.slice(0, 30)));
  } catch (e) {
    console.log('Error saving local fall evidence:', e);
  }

  return newRecord;
}

/**
 * Load Fall Event Records from Supabase & Local Storage
 */
export async function getFallEvents(): Promise<FallEvidenceRecord[]> {
  const familyId = await AsyncStorage.getItem('familyId');
  if (!familyId) return [];
  try {
    {
      const { data, error } = await supabase
        .from('fall_events')
        .select('*')
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        return await Promise.all((data as FallEvidenceRecord[]).map(signEvidenceUrl));
      }
    }
  } catch (e) {
    console.log('Error reading fall events from cloud:', e);
  }

  // Fallback to local storage
  try {
    const localData = await AsyncStorage.getItem(STORAGE_KEY_FALL_EVIDENCE);
    const records: FallEvidenceRecord[] = localData ? JSON.parse(localData) : [];
    return await Promise.all(records.filter((record) => record.family_id === familyId).map(signEvidenceUrl));
  } catch (e) {
    console.log('Error reading local fall evidence:', e);
    return [];
  }
}

async function signEvidenceUrl(record: FallEvidenceRecord): Promise<FallEvidenceRecord> {
  const imagePath = record.image_url;
  if (!imagePath || imagePath.startsWith('http')) return record;
  const ttl = Number(process.env.EXPO_PUBLIC_EVIDENCE_URL_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl <= 0) return { ...record, image_url: undefined };
  const { data, error } = await supabase.storage.from('fall-evidence').createSignedUrl(imagePath, ttl);
  return { ...record, image_url: error ? undefined : data?.signedUrl };
}
