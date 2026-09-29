import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';

const REFERENCE_UPLOAD_LIMIT_BYTES = 2_000_000;
const FACE_REFERENCE_WIDTH = 1024;
const FULL_BODY_REFERENCE_HEIGHT = 1600;
const JPEG_QUALITY_STEPS = [0.82, 0.68, 0.54, 0.42] as const;

export async function prepareIdentityImage(uri: string, fullBody: boolean): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (fullBody) context.resize({ height: FULL_BODY_REFERENCE_HEIGHT });
  else context.resize({ width: FACE_REFERENCE_WIDTH });

  const image = await context.renderAsync();
  for (const compress of JPEG_QUALITY_STEPS) {
    const result = await image.saveAsync({
      base64: true,
      compress,
      format: SaveFormat.JPEG,
    });
    if (!result.base64) continue;
    if (decode(result.base64).byteLength <= REFERENCE_UPLOAD_LIMIT_BYTES) return result.base64;
  }
  throw new Error('แอปปรับขนาดรูปไม่สำเร็จ กรุณาเลือกรูปอื่น');
}
