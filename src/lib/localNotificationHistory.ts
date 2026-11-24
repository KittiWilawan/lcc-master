import AsyncStorage from '@react-native-async-storage/async-storage';

export type ScheduledTest = { id: string; createdAt: number };

const storageKey = (userId: string) => '@local_notification_tests:' + userId;

export async function saveScheduledTest(userId: string, test: ScheduledTest) {
  // Merge by OS request identifier so overlapping tests cannot overwrite one another.
  await AsyncStorage.mergeItem(storageKey(userId), JSON.stringify({ [test.id]: test.createdAt }));
}

export async function getScheduledTests(userId: string): Promise<ScheduledTest[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  const records: Record<string, unknown> = JSON.parse(raw);
  return Object.entries(records).flatMap(([id, createdAt]) =>
    typeof createdAt === 'number' && Number.isFinite(createdAt) ? [{ id, createdAt }] : []);
}
