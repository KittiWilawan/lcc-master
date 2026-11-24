/** A storage-pressure event keeps its metadata; a supplied image must still be valid. */
export function decodeEventImage(body: Record<string, unknown>, existing: boolean, maximumBytes: number): Uint8Array | null {
  const value = body.imageBase64;
  if (value === undefined && (existing || body.evidenceState === 'storage_pressure')) return null;
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4) throw new Error('invalid_image');
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('invalid_image'); }
  if (binary.length < 2 || binary.length > maximumBytes || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216) throw new Error('invalid_image');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
