import { loadConfig } from './config.mjs';
import { advanceEpisodes } from './episodes.mjs';
import { analyzePoseSequence, readCameraFrame } from './vision.mjs';
import { openOutbox, scopeRevision } from './outbox.mjs';
import {
  connectFamily,
  finalizeOutstandingFalls,
  publishFall,
  publishHealth,
  readCameras,
} from './cloud.mjs';
import {
  connectDevice,
  finalizeDeviceFalls,
  publishDeviceFall,
  publishDeviceHealth,
  readDeviceCameras,
} from './device-cloud.mjs';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const report = (message, details = '') => console.log(new Date().toISOString(), message, details);

async function connectWithRetry(config, connect) {
  let latestError;
  for (let attempt = 1; attempt <= config.startupRetries; attempt += 1) {
    try {
      return await connect(config);
    } catch (error) {
      latestError = error;
      report('เชื่อมต่อฐานข้อมูลไม่สำเร็จ', `ครั้งที่ ${attempt}/${config.startupRetries}`);
      if (attempt < config.startupRetries) await pause(config.startupRetryMs);
    }
  }
  throw latestError;
}

async function monitorCamera(connection, config, camera, state, outbox) {
  try {
    const image = await readCameraFrame(camera, config);
    state.lastFrameAt = new Date().toISOString();
    if (!state.previous) {
      state.previous = image;
      state.frames = [image];
      report(`เริ่มรับภาพ ${camera.name}`);
      return 'warming';
    }
    const analysisStartedAt = Date.now();
    state.frames.push(image);
    if (state.frames.length > config.poseModelFrames) state.frames.shift();
    if (state.frames.length < config.poseModelFrames) {
      state.previous = image;
      report(`${camera.name}: กำลังสะสมลำดับภาพ`, `${state.frames.length}/${config.poseModelFrames}`);
      return 'warming';
    }
    const result = await analyzePoseSequence(state.frames, config, camera.identityReferenceImages);
    if (!Array.isArray(result.people)) throw new Error('กรุณาอัปเดตบริการวิเคราะห์ท่าทางบนคอม');
    const analysisDuration = Date.now() - analysisStartedAt;
    if (analysisDuration > config.maxAnalysisMs) {
      throw new Error(`โมเดลวิเคราะห์ช้าเกินกำหนด (${analysisDuration} ms)`);
    }
    state.previous = image;
    const next = { tracks: state.tracks };
    const events = advanceEpisodes(next, result.people, camera, Date.now(), config);
    outbox.enqueue(events, camera, image);
    state.tracks = next.tracks;
    return 'analyzed';
  } catch (error) {
    state.previous = undefined;
    state.frames = [];
    state.tracks = undefined;
    state.confirmations = 0;
    state.alerting = false;
    report(`${camera.name}: ตรวจภาพไม่สำเร็จ`, error.message);
    return 'error';
  }
}

async function main() {
  const config = await loadConfig();
  const deviceMode = config.connectionMode === 'device';
  const operations = deviceMode ? {
    connect: connectDevice,
    finalize: finalizeDeviceFalls,
    publishFall: publishDeviceFall,
    publishHealth: publishDeviceHealth,
    readCameras: (connection) => readDeviceCameras(connection),
  } : {
    connect: connectFamily,
    finalize: finalizeOutstandingFalls,
    publishFall,
    publishHealth,
    readCameras: (connection) => readCameras(connection, config.familyId),
  };
  const supabase = await connectWithRetry(config, operations.connect);
  report('เข้าสู่ระบบครอบครัวสำเร็จ');
  await operations.publishHealth(supabase, config, {
    state: 'idle', cameraCount: 0, analyzedCount: 0, errorCount: 0,
    detail: 'กำลังค้นหากล้อง',
  });
  const outbox = openOutbox(config);
  let lastFrameAt = null;
  let cameras = [];
  let refreshedAt = 0;
  let healthPublishedAt = 0;
  let healthSignature = '';
  const states = new Map();
  let running = true;
  process.once('SIGINT', () => { running = false; });
  process.once('SIGTERM', () => { running = false; });
  while (running) {
    const startedAt = Date.now();
    let refreshError = null;
    try {
      await operations.finalize(supabase, config, report);
    } catch (error) {
      refreshError = error;
      report('ยืนยันเหตุค้างจากรอบก่อนหน้าไม่สำเร็จ', error.message);
    }
    if (startedAt - refreshedAt >= config.refreshMs) {
      try {
        cameras = await operations.readCameras(supabase);
        const ids = new Set(cameras.map((camera) => camera.id));
        for (const id of states.keys()) if (!ids.has(id)) states.delete(id);
        refreshedAt = Date.now();
        const allPeopleCount = cameras.filter((camera) => camera.allPeopleMode).length;
        report('อัปเดตรายการกล้อง', allPeopleCount
          ? `${cameras.length} ตัว · โหมดตรวจทุกคน`
          : `${cameras.length} ตัวที่ผูกกับบุคคลเป้าหมาย`);
      } catch (error) {
        refreshError = error;
        cameras = [];
        states.clear();
        report('โหลดรายการกล้องไม่สำเร็จ', error.message);
      }
    }
    let analyzedCount = 0;
    let errorCount = 0;
    for (const camera of cameras) {
      if (!running) break;
      const state = states.get(camera.id) || {
        previous: undefined,
        frames: [],
        confirmations: 0,
        lastAlertAt: -Infinity,
        alerting: false,
        sourceUrl: camera.snapshot_url || camera.url,
        identityReferenceSignature: scopeRevision(camera),
      };
      const sourceUrl = camera.snapshot_url || camera.url;
      if (state.sourceUrl !== sourceUrl ||
          state.identityReferenceSignature !== scopeRevision(camera)) {
        state.previous = undefined;
        state.frames = [];
        state.confirmations = 0;
        state.alerting = false;
        state.sourceUrl = sourceUrl;
        state.identityReferenceSignature = scopeRevision(camera);
        state.tracks = undefined;
      }
      states.set(camera.id, state);
      const outcome = await monitorCamera(supabase, config, camera, state, outbox);
      if (state.lastFrameAt && (!lastFrameAt || state.lastFrameAt > lastFrameAt)) lastFrameAt = state.lastFrameAt;
      if (outcome === 'analyzed') analyzedCount += 1;
      if (outcome === 'error') errorCount += 1;
    }
    if (!refreshError) {
      try { await outbox.deliver(cameras, (camera, image, result) => operations.publishFall(supabase, config, camera, image, result, report)); }
      catch (error) { errorCount++; report('ยังส่งเหตุค้างไม่สำเร็จ', error.message); }
    }
    const state = refreshError || errorCount ? 'degraded' : cameras.length ? 'running' : 'idle';
    const detail = refreshError ? 'อ่านรายการกล้องไม่สำเร็จ' :
      errorCount ? `ตรวจภาพไม่สำเร็จ ${errorCount} กล้อง` :
      cameras.length && !analyzedCount ? 'กำลังรับภาพแรกจากกล้อง' :
      cameras.length ? null : 'ยังไม่มีกล้องที่พร้อมส่งภาพให้ AI';
    const nextHealthSignature = JSON.stringify({ state, cameraCount: cameras.length, detail });
    if (nextHealthSignature !== healthSignature || Date.now() - healthPublishedAt >= config.healthIntervalMs) {
      try {
        await operations.publishHealth(supabase, config, {
          state, cameraCount: cameras.length, analyzedCount, errorCount, detail, lastFrameAt,
        });
        healthPublishedAt = Date.now();
        healthSignature = nextHealthSignature;
      } catch (error) {
        report('ส่งสถานะคอมไปมือถือไม่สำเร็จ', error.message);
      }
    }
    const remaining = config.intervalMs - (Date.now() - startedAt);
    if (running && remaining > 0) await pause(remaining);
  }
  try {
    await operations.publishHealth(supabase, config, {
      state: 'stopped', cameraCount: cameras.length, analyzedCount: 0, errorCount: 0,
      lastFrameAt, detail: 'โปรแกรมเฝ้าระวังหยุดทำงาน',
    });
  } catch (error) {
    report('ส่งสถานะหยุดทำงานไม่สำเร็จ', error.message);
  }
  outbox.close();
  if (!deviceMode) await supabase.auth.signOut();
  report('หยุดเฝ้าระวัง');
}

main().catch((error) => {
  console.error('เริ่มระบบเฝ้าระวังไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});
