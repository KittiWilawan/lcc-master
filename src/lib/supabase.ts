import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import { fetchWithDeadline } from './networkRequest';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

const customStorage = {
  getItem: (key: string) => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(key);
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  },
  removeItem: (key: string) => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithDeadline },
  auth: {
    storage: Platform.OS === 'web' ? customStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

interface FamilyRelation {
  family_code: string | null;
}

interface UserFamilyMembership {
  family_id: string;
  created_at: string;
  families: FamilyRelation | FamilyRelation[] | null;
}

function readFamilyCode(relation: UserFamilyMembership['families']): string {
  if (Array.isArray(relation)) return relation[0]?.family_code ?? '';
  return relation?.family_code ?? '';
}

/**
 * Checks if the user is already a member of any family in Supabase.
 * If found, automatically saves familyId and familyCode into AsyncStorage
 * and returns the family details.
 */
export async function checkAndSaveUserFamily(userId: string): Promise<{ familyId: string; familyCode: string } | null> {
  const preferredFamilyId = await AsyncStorage.getItem('familyId');
  const { data, error } = await supabase
    .from('family_members')
    .select('family_id,created_at,families(family_code)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const memberships = (data ?? []) as UserFamilyMembership[];
  const selected = memberships.find((membership) => membership.family_id === preferredFamilyId)
    ?? memberships[0];
  if (!selected) {
    await AsyncStorage.multiRemove(['familyId', 'familyCode']);
    return null;
  }

  const familyId = selected.family_id;
  const familyCode = readFamilyCode(selected.families);
  await AsyncStorage.setItem('familyId', familyId);
  if (familyCode) await AsyncStorage.setItem('familyCode', familyCode);
  else await AsyncStorage.removeItem('familyCode');
  return { familyId, familyCode };
}
