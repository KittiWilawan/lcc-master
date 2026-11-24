import forms from '../config/forms.json';

export const PIN_LENGTH = forms.pinLength;
export const MINIMUM_PASSWORD_LENGTH = forms.minimumPasswordLength;

export function normalizePin(value: string): string {
  return Array.from(value).filter(character => character >= '0' && character <= '9').join('').slice(0, PIN_LENGTH);
}

export function validatePinPair(pin: string, confirmation: string): string | null {
  if (pin.length !== PIN_LENGTH || normalizePin(pin) !== pin) return `กรุณากรอก PIN ตัวเลข ${PIN_LENGTH} หลัก`;
  if (confirmation.length !== PIN_LENGTH) return `กรุณายืนยัน PIN ${PIN_LENGTH} หลักอีกครั้ง`;
  if (pin !== confirmation) return 'PIN ทั้งสองครั้งไม่ตรงกัน กรุณาลองใหม่';
  return null;
}

/** Common unquoted mailbox syntax; ownership is established by the Auth email confirmation. */
export function validateEmail(value: string): { email: string; error: string | null } {
  const email = value.trim().toLowerCase();
  const invalid = { email, error: 'กรุณากรอกอีเมลให้ถูกต้อง เช่น name@gmail.com' };
  if (!email || email.length > 254) return invalid;
  const parts = email.split('@');
  if (parts.length !== 2) return invalid;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return invalid;
  const punctuation = "!#$%&'*+-/=?^_`{|}~.";
  if (Array.from(local).some(character => !isAsciiAlphaNumeric(character) && !punctuation.includes(character))) return invalid;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-')
    || Array.from(label).some(character => !isAsciiAlphaNumeric(character) && character !== '-'))) return invalid;
  if (labels.at(-1)!.length < 2 || Array.from(labels.at(-1)!).some(character => character >= '0' && character <= '9')) return invalid;
  if (forms.emailDomains.length && !forms.emailDomains.some(allowed => allowed === domain)) {
    return { email, error: `กรุณาใช้อีเมล ${forms.emailDomains.join(' หรือ ')}` };
  }
  return { email, error: null };
}

function isAsciiAlphaNumeric(character: string): boolean {
  return character >= 'a' && character <= 'z' || character >= '0' && character <= '9';
}
