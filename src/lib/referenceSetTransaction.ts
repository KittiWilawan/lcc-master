/** Staging never changes active references; the repository must commit the set in one operation. */
export async function commitReferenceSet<Pose extends string>(input: {
  poses: readonly Pose[];
  photos: Readonly<Partial<Record<Pose, string>>>;
  stillActive(): Promise<boolean>;
  stage(pose: Pose, base64: string): Promise<string>;
  commit(paths: Readonly<Partial<Record<Pose, string>>>): Promise<void>;
  discard(paths: readonly string[]): Promise<void>;
  onStaged(poses: Pose[]): void;
}): Promise<void> {
  if (!input.poses.length || new Set(input.poses).size !== input.poses.length ||
      Object.keys(input.photos).length !== input.poses.length || input.poses.some(pose => !input.photos[pose])) {
    throw new Error('รูปสแกนยังไม่ครบ กรุณาสแกนใหม่');
  }
  const staged: Partial<Record<Pose, string>> = {};
  let commitStarted = false;
  try {
    for (const pose of input.poses) {
      if (!await input.stillActive()) throw new Error('รอบสแกนถูกยกเลิก กรุณาเริ่มใหม่');
      staged[pose] = await input.stage(pose, input.photos[pose]!);
      input.onStaged(input.poses.filter(value => Boolean(staged[value])));
    }
    if (!await input.stillActive()) throw new Error('รอบสแกนถูกยกเลิก กรุณาเริ่มใหม่');
    commitStarted = true;
    await input.commit(staged);
  } catch (error) {
    // After a transport failure a commit may already have succeeded. Never delete its images.
    if (!commitStarted) await input.discard(Object.values(staged) as string[]).catch(() => undefined);
    throw error;
  }
}
