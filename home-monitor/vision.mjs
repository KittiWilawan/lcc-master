import {
  analysisSchema, identitySchema, validateAnalysis, validateIdentity,
} from './core.mjs';
import { spawn } from 'node:child_process';

const REQUIRED_IDENTITY_REFERENCE_COUNT = 4;

function validateImageBytes(bytes) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = bytes.length >= pngHeader.length && bytes.subarray(0, pngHeader.length).equals(pngHeader);
  if (!jpeg && !png) throw new Error('แหล่งภาพไม่ได้ส่ง JPEG หรือ PNG');
  return { bytes, contentType: jpeg ? 'image/jpeg' : 'image/png' };
}

function validateAllowedSource(url, config) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('ลิงก์กล้องต้องเป็น HTTP หรือ HTTPS');
  if (config.enforceAllowedOrigins !== false && !config.allowedOrigins.includes(parsed.origin)) {
    throw new Error('ลิงก์กล้องไม่ได้อยู่ในเกตเวย์ที่อนุญาต');
  }
  return parsed;
}

export async function analyzePoseSequence(images, config) {
  if (!Array.isArray(images) || images.length !== config.poseModelFrames) {
    throw new Error(`ต้องมีภาพต่อเนื่อง ${config.poseModelFrames} ภาพ`);
  }
  const response = await fetch(config.poseModelUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.poseModelTimeoutMs),
    body: JSON.stringify({
      images: images.map((image) => image.bytes.toString('base64')),
    }),
  });
  if (!response.ok) throw new Error(`โมเดลท่าทางไม่พร้อม (${response.status})`);
  const result = await response.json();
  if (!['normal', 'fall', 'uncertain'].includes(result.status) ||
      typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) ||
      result.confidence < 0 || result.confidence > 1 ||
      !Number.isSafeInteger(result.detectedPoseFrames) ||
      result.detectedPoseFrames < 0 || result.detectedPoseFrames > config.poseModelFrames ||
      !Number.isSafeInteger(result.peopleCount) || result.peopleCount < 0 ||
      !Number.isSafeInteger(result.evaluatedTracks) || result.evaluatedTracks < 0) {
    throw new Error('โมเดลท่าทางส่งผลวิเคราะห์ไม่ถูกต้อง');
  }
  return result;
}

export function poseOnlyAnalysis(result) {
  const uncertain = result.status === 'uncertain';
  return {
    status: result.status,
    confidence: uncertain ? 0 : result.status === 'fall' ? result.confidence : 1 - result.confidence,
    reason: uncertain
      ? 'ยังติดตามร่างเดียวกันได้ไม่ต่อเนื่องพอสำหรับตัดสิน'
      : result.status === 'fall'
      ? 'ลำดับการเคลื่อนไหวของโครงกระดูกสอดคล้องกับการล้ม'
      : 'ลำดับการเคลื่อนไหวของโครงกระดูกยังไม่สอดคล้องกับการล้ม',
    peopleCount: result.peopleCount,
    subjectContinuity: result.peopleCount === 1 ? 'single_continuous_person' : 'uncertain',
    fallingPersonMatch: 'uncertain',
    identityConfidence: 0,
  };
}

export function mergePoseAndIdentity(poseResult, identityResult) {
  return {
    ...identityResult,
    status: 'fall',
    confidence: poseResult.confidence,
    reason: `โมเดลท่าทางพบการล้ม; ${identityResult.reason}`,
  };
}

export async function identifyFallingPerson(current, config, identityReferences) {
  if (!Array.isArray(identityReferences) || identityReferences.length < REQUIRED_IDENTITY_REFERENCE_COUNT) {
    throw new Error('ต้องมีภาพอ้างอิงครบก่อนยืนยันบุคคล');
  }
  const referenceMessages = identityReferences.map((reference, index) => ({
    role: 'user',
    content: `ภาพอ้างอิงบุคคลเป้าหมาย ลำดับ ${index + 1}`,
    images: [reference.bytes.toString('base64')],
  }));
  const messages = [
    {
      role: 'system',
      content: `${config.instructions}\n\nโมเดลท่าทางยืนยันเหตุล้มแล้ว งานนี้ให้ระบุตัวบุคคลเท่านั้น ห้ามประเมินสถานะการล้มซ้ำ`,
    },
    ...referenceMessages,
    {
      role: 'user',
      content: 'ภาพเหตุการณ์ล่าสุด เปรียบเทียบบุคคลที่อยู่ใกล้พื้นกับภาพอ้างอิง แล้วตอบ JSON ตาม schema',
      images: [current.bytes.toString('base64')],
    },
  ];
  const response = await fetch(config.ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.modelTimeoutMs),
    body: JSON.stringify({
      model: config.model,
      stream: false,
      think: false,
      options: { num_ctx: config.contextLength, num_gpu: config.gpuLayers },
      format: identitySchema,
      messages,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`โมเดลระบุตัวบุคคลไม่พร้อม (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (typeof payload.message?.content !== 'string') throw new Error('โมเดลไม่ส่งผลยืนยันบุคคล');
  try {
    return validateIdentity(JSON.parse(payload.message.content));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('โมเดลส่ง JSON ยืนยันบุคคลไม่สมบูรณ์');
    throw error;
  }
}

export async function readCameraImage(url, config) {
  const parsed = validateAllowedSource(url, config);
  const response = await fetch(parsed, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(config.imageTimeoutMs),
  });
  if (!response.ok || !response.body) throw new Error(`ดึงภาพนิ่งไม่สำเร็จ (${response.status})`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > config.maxImageBytes) {
    await response.body.cancel();
    throw new Error('ภาพนิ่งมีขนาดเกินที่ตั้งค่า');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > config.maxImageBytes) {
      throw new Error('ภาพนิ่งมีขนาดเกินที่ตั้งค่า');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return validateImageBytes(bytes);
}

export async function readCameraStreamFrame(url, config) {
  const parsed = validateAllowedSource(url, config);
  const timeoutMicroseconds = String(config.imageTimeoutMs * 1000);
  const argumentsList = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rw_timeout', timeoutMicroseconds,
    '-i', parsed.toString(),
    '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const process = spawn(config.ffmpegCommand, argumentsList, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errorChunks = [];
    let total = 0;
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      process.kill();
      finish(new Error('สตรีมกล้องใช้เวลาตอบกลับนานเกินไป'));
    }, config.imageTimeoutMs);
    process.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > config.maxImageBytes) {
        process.kill();
        finish(new Error('ภาพจากสตรีมมีขนาดเกินที่ตั้งค่า'));
        return;
      }
      chunks.push(chunk);
    });
    process.stderr.on('data', (chunk) => {
      if (errorChunks.reduce((sum, item) => sum + item.length, 0) < 2000) errorChunks.push(chunk);
    });
    process.once('error', () => finish(new Error('ยังไม่พบโปรแกรมอ่านสตรีมกล้องบนคอม')));
    process.once('close', (code) => {
      if (finished) return;
      if (code !== 0) {
        const detail = Buffer.concat(errorChunks).toString('utf8').trim().slice(0, 300);
        finish(new Error(detail || 'อ่านสตรีมกล้องไม่สำเร็จ'));
        return;
      }
      try {
        finish(null, validateImageBytes(Buffer.concat(chunks)));
      } catch (error) {
        finish(error);
      }
    });
  });
}

export function selectCameraSource(camera) {
  if (camera.snapshot_url) {
    const path = new URL(camera.snapshot_url).pathname.toLowerCase();
    const streamInSnapshotField = path.endsWith('.m3u8') || path.endsWith('.mjpg') || path.endsWith('.mjpeg');
    return { type: streamInSnapshotField ? 'stream' : 'image', url: camera.snapshot_url };
  }
  if (camera.url) return { type: 'stream', url: camera.url };
  return null;
}

export async function readCameraFrame(camera, config) {
  const source = selectCameraSource(camera);
  if (source?.type === 'image') return readCameraImage(source.url, config);
  if (source?.type === 'stream') return readCameraStreamFrame(source.url, config);
  throw new Error('กล้องยังไม่มีลิงก์ภาพหรือสตรีมสำหรับ AI');
}

export async function analyzePair(previous, current, config, identityReferences = []) {
  const identityContext = identityReferences.length
    ? `มีภาพอ้างอิงของบุคคลเป้าหมาย ${identityReferences.length} ภาพก่อนภาพจากกล้อง`
    : 'ไม่มีภาพอ้างอิงของบุคคลเป้าหมาย ให้ตอบ fallingPersonMatch เป็น uncertain และ identityConfidence เป็น 0';
  const referenceMessages = identityReferences.map((reference, index) => ({
    role: 'user',
    content: `ภาพอ้างอิงบุคคลเป้าหมาย ลำดับ ${index + 1}`,
    images: [reference.bytes.toString('base64')],
  }));
  const messages = [
    { role: 'system', content: config.instructions },
    ...referenceMessages,
    {
      role: 'user',
      content: `ภาพจากกล้องก่อนเกิดเหตุ ใช้เป็นจุดเริ่มต้นของลำดับเวลา ${identityContext}`,
      images: [previous.bytes.toString('base64')],
    },
    {
      role: 'user',
      content: 'ภาพล่าสุดจากกล้อง เปรียบเทียบท่าทางและตำแหน่งของคนกับภาพก่อนเกิดเหตุ แล้วตอบ JSON ตาม schema',
      images: [current.bytes.toString('base64')],
    },
  ];
  const response = await fetch(config.ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.modelTimeoutMs),
    body: JSON.stringify({
      model: config.model,
      stream: false,
      think: false,
      options: { num_ctx: config.contextLength, num_gpu: config.gpuLayers },
      format: analysisSchema,
      messages,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`โมเดลไม่พร้อม (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (typeof payload.message?.content !== 'string') throw new Error('โมเดลไม่ส่งผลวิเคราะห์');
  let result;
  try {
    result = JSON.parse(payload.message.content);
  } catch {
    throw new Error('โมเดลส่ง JSON ไม่สมบูรณ์');
  }
  const analysis = validateAnalysis(result);
  if (identityReferences.length < REQUIRED_IDENTITY_REFERENCE_COUNT) {
    return { ...analysis, fallingPersonMatch: 'uncertain', identityConfidence: 0 };
  }
  return analysis;
}
