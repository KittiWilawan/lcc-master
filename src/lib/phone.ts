import { Linking } from 'react-native';

const DIALABLE_CHARACTERS = new Set(Array.from('0123456789+#*,;'));
const PHONE_DIGITS = new Set(Array.from('0123456789'));
export const MOBILE_PHONE_LENGTH = 10;

export function normalizeMobilePhoneInput(value: string): string {
  return Array.from(value)
    .filter((character) => PHONE_DIGITS.has(character))
    .slice(0, MOBILE_PHONE_LENGTH)
    .join('');
}

export function isValidMobilePhone(value: string): boolean {
  const phone = normalizeMobilePhoneInput(value);
  return phone.length === MOBILE_PHONE_LENGTH && phone.startsWith('0');
}

export function normalizeDialablePhone(value: string): string {
  return Array.from(value.trim())
    .filter((character) => DIALABLE_CHARACTERS.has(character))
    .join('');
}

export function getEmergencyPhoneNumber(): string {
  const phone = normalizeDialablePhone(process.env.EXPO_PUBLIC_EMERGENCY_PHONE_NUMBER ?? '');
  if (!phone) throw new Error('ยังไม่ได้ตั้งค่าเบอร์ฉุกเฉิน');
  return phone;
}

export async function callPhoneNumber(value: string): Promise<boolean> {
  const phone = normalizeDialablePhone(value);
  if (!phone) return false;
  const url = `tel:${phone}`;
  if (!(await Linking.canOpenURL(url))) return false;
  await Linking.openURL(url);
  return true;
}
