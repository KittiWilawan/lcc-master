import type { FacePose } from './guidedFaceScan';

export type ScanPhotoSet = Record<FacePose, string>;
export interface ScanSaveOptions { isActive(): boolean; onProgress(poses: FacePose[]): void }

/** One immutable capture set is handed to the repository, which stages then commits atomically. */
export async function saveScanPhotoSet(input: {
  poses: readonly FacePose[];
  photos: Readonly<Partial<Record<FacePose, string>>>;
  isActive(): boolean;
  store(photos: ScanPhotoSet, options: ScanSaveOptions): Promise<void>;
  onProgress(saved: FacePose[]): void;
}): Promise<boolean> {
  if (!input.poses.length || input.poses.some(pose => !input.photos[pose])) throw new Error('รูปสแกนยังไม่ครบ กรุณาสแกนใหม่');
  if (!input.isActive()) return false;
  await input.store({ ...input.photos } as ScanPhotoSet, { isActive: input.isActive, onProgress: input.onProgress });
  return true;
}
