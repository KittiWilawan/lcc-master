export const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['normal', 'possible_fall', 'fall', 'uncertain'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    peopleCount: { type: 'integer', minimum: 0, maximum: 20 },
    subjectContinuity: { type: 'string', enum: ['single_continuous_person', 'multiple_people', 'uncertain'] },
    fallingPersonMatch: { type: 'string', enum: ['confirmed_target', 'possible_target', 'not_target', 'uncertain'] },
    identityConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'status', 'confidence', 'reason', 'peopleCount', 'subjectContinuity',
    'fallingPersonMatch', 'identityConfidence',
  ],
};

export const identitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string' },
    peopleCount: { type: 'integer', minimum: 0, maximum: 20 },
    subjectContinuity: { type: 'string', enum: ['single_continuous_person', 'multiple_people', 'uncertain'] },
    fallingPersonMatch: { type: 'string', enum: ['confirmed_target', 'possible_target', 'not_target', 'uncertain'] },
    identityConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['reason', 'peopleCount', 'subjectContinuity', 'fallingPersonMatch', 'identityConfidence'],
};

export function validateAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('โมเดลส่งผลวิเคราะห์ที่ไม่ใช่ข้อมูลแบบมีโครงสร้าง');
  }
  const invalidFields = [];
  if (!analysisSchema.properties.status.enum.includes(value.status)) invalidFields.push('status');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence < 0 || value.confidence > 1) invalidFields.push('confidence');
  if (typeof value.reason !== 'string' || !value.reason.trim() ||
      value.reason.trim() === value.status) invalidFields.push('reason');
  if (!Number.isSafeInteger(value.peopleCount) || value.peopleCount < 0 ||
      value.peopleCount > 20) invalidFields.push('peopleCount');
  if (!analysisSchema.properties.subjectContinuity.enum.includes(value.subjectContinuity) ||
      (value.peopleCount !== 1 && value.subjectContinuity === 'single_continuous_person')) {
    invalidFields.push('subjectContinuity');
  }
  if (!analysisSchema.properties.fallingPersonMatch.enum.includes(value.fallingPersonMatch)) {
    invalidFields.push('fallingPersonMatch');
  }
  if (typeof value.identityConfidence !== 'number' || !Number.isFinite(value.identityConfidence) ||
      value.identityConfidence < 0 || value.identityConfidence > 1 ||
      (value.fallingPersonMatch === 'confirmed_target' && value.identityConfidence === 0)) {
    invalidFields.push('identityConfidence');
  }
  if (invalidFields.length) {
    throw new Error(`โมเดลส่งค่าไม่ถูกต้องในช่อง: ${invalidFields.join(', ')}`);
  }
  return {
    status: value.status,
    confidence: value.confidence,
    reason: value.reason.trim(),
    peopleCount: value.peopleCount,
    subjectContinuity: value.subjectContinuity,
    fallingPersonMatch: value.fallingPersonMatch,
    identityConfidence: value.identityConfidence,
  };
}

export function validateIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('โมเดลส่งผลยืนยันบุคคลที่ไม่ใช่ข้อมูลแบบมีโครงสร้าง');
  }
  const invalidFields = [];
  if (typeof value.reason !== 'string' || !value.reason.trim()) invalidFields.push('reason');
  if (!Number.isSafeInteger(value.peopleCount) || value.peopleCount < 0 || value.peopleCount > 20) {
    invalidFields.push('peopleCount');
  }
  if (!identitySchema.properties.subjectContinuity.enum.includes(value.subjectContinuity) ||
      (value.peopleCount !== 1 && value.subjectContinuity === 'single_continuous_person')) {
    invalidFields.push('subjectContinuity');
  }
  if (!identitySchema.properties.fallingPersonMatch.enum.includes(value.fallingPersonMatch)) {
    invalidFields.push('fallingPersonMatch');
  }
  if (typeof value.identityConfidence !== 'number' || !Number.isFinite(value.identityConfidence) ||
      value.identityConfidence < 0 || value.identityConfidence > 1 ||
      (value.fallingPersonMatch === 'confirmed_target' && value.identityConfidence === 0)) {
    invalidFields.push('identityConfidence');
  }
  if (invalidFields.length) {
    throw new Error(`โมเดลส่งค่าไม่ถูกต้องในช่อง: ${invalidFields.join(', ')}`);
  }
  return {
    reason: value.reason.trim(),
    peopleCount: value.peopleCount,
    subjectContinuity: value.subjectContinuity,
    fallingPersonMatch: value.fallingPersonMatch,
    identityConfidence: value.identityConfidence,
  };
}

export function nextAlertState(state, result, now, config) {
  const positive = result.status === 'fall' && result.confidence >= config.confidence;
  const confirmations = positive ? state.confirmations + 1 : 0;
  const cooledDown = now - state.lastAlertAt >= config.cooldownMs;
  const alert = positive && confirmations >= config.confirmations && cooledDown && !state.alerting;
  return {
    confirmations,
    lastAlertAt: alert ? now : state.lastAlertAt,
    alerting: positive && (state.alerting || alert),
    alert,
  };
}

export function readPositiveInteger(name, source) {
  const value = Number(source[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`ต้องตั้งค่า ${name} เป็นจำนวนเต็มบวก`);
  return value;
}

export function readNonNegativeInteger(name, source) {
  const value = Number(source[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ต้องตั้งค่า ${name} เป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป`);
  return value;
}

export function readProbability(name, source) {
  const value = Number(source[name]);
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`ต้องตั้งค่า ${name} ระหว่าง 0 ถึง 1`);
  return value;
}

export function requireString(name, source) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`ต้องตั้งค่า ${name}`);
  return value;
}

const UUID_GROUP_LENGTHS = [8, 4, 4, 4, 12];
const HEX_CHARACTERS = new Set('0123456789abcdef'.split(''));

export function requireUuid(name, source) {
  const value = requireString(name, source).toLowerCase();
  const groups = value.split('-');
  const hasValidShape = groups.length === UUID_GROUP_LENGTHS.length && groups.every((group, index) =>
    group.length === UUID_GROUP_LENGTHS[index] &&
    [...group].every((character) => HEX_CHARACTERS.has(character))
  );
  if (!hasValidShape || groups.every((group) => [...group].every((character) => character === '0'))) {
    throw new Error(`${name} ต้องเป็นรหัส UUID จริงจาก Supabase และห้ามใช้ค่าตัวอย่างศูนย์ทั้งหมด`);
  }
  return value;
}
