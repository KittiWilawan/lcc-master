/** Trim only records confirmed stored in the cloud; unsynced records stay until durable sync. */
export function retainEvidenceRecords<T extends { cloudSynced?: boolean }>(records: T[], cloudHistoryLimit: number): T[] {
  if (!Number.isSafeInteger(cloudHistoryLimit) || cloudHistoryLimit <= 0) throw new Error('Invalid history limit');
  let confirmed = 0;
  return records.filter((record) => record.cloudSynced !== true || confirmed++ < cloudHistoryLimit);
}
