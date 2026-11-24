import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PhoneTest {
  id: string;
  requestedAt: number;
  sentAt?: number;
  observedAt?: number;
  failed?: boolean;
  correlated?: boolean;
}

const key = (userId: string) => '@last_push_test:' + userId;
const listeners = new Set<(userId: string, test: PhoneTest) => void>();
let writes: Promise<void> = Promise.resolve();

export async function lastPhoneTest(userId: string): Promise<PhoneTest | null> {
  await writes;
  const raw = await AsyncStorage.getItem(key(userId));
  return raw ? JSON.parse(raw) : null;
}

/** Serialize read-modify-write so a phone receipt arriving before the send response is retained. */
function write(userId: string, change: (current: PhoneTest | null) => PhoneTest | null) {
  const operation = writes.then(async () => {
    const raw = await AsyncStorage.getItem(key(userId));
    const current: PhoneTest | null = raw ? JSON.parse(raw) : null;
    const next = change(current);
    if (!next || next === current) return;
    await AsyncStorage.setItem(key(userId), JSON.stringify(next));
    for (const notify of listeners) notify(userId, next);
  });
  writes = operation.catch(() => undefined);
  return operation;
}

export function startPhoneTest(userId: string, id: string) {
  return write(userId, () => ({ id, requestedAt: Date.now() }));
}
export function finishPhoneTest(userId: string, id: string, accepted: boolean, correlated: boolean) {
  const answeredAt = Date.now();
  return write(userId, current => current?.id === id
    ? { ...current, sentAt: accepted ? answeredAt : undefined, failed: !accepted, correlated } : current);
}
export function observePhoneTest(userId: string, data?: Record<string, unknown>) {
  if (data?.type !== 'notification_test' || data.userId !== userId || typeof data.testId !== 'string') return Promise.resolve();
  const observedAt = Date.now();
  return write(userId, current => current && current.id === data.testId && !current.observedAt
    ? { ...current, observedAt } : current);
}
export function onPhoneTestChanged(listener: (userId: string, test: PhoneTest) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
