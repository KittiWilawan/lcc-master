import { readPositiveInteger, requireString } from './core.mjs';
import { readAllowedOrigins } from './config.mjs';
import { readCameraFrame } from './vision.mjs';

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('ระบุ URL จากกล้อง');
  const image = await readCameraFrame({ url }, {
    imageTimeoutMs: readPositiveInteger('HOME_MONITOR_IMAGE_TIMEOUT_MS', process.env),
    maxImageBytes: readPositiveInteger('HOME_MONITOR_MAX_IMAGE_BYTES', process.env),
    allowedOrigins: readAllowedOrigins(process.env),
    ffmpegCommand: requireString('FFMPEG_COMMAND', process.env),
  });
  console.log(`รับภาพสำเร็จ: ${image.contentType}, ${image.bytes.length} bytes`);
}

main().catch((error) => {
  console.error('ทดสอบกล้องไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});
