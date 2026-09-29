import { spawn } from 'node:child_process';
import { requireString, readPositiveInteger } from './core.mjs';

const python = requireString('POSE_PYTHON_COMMAND', process.env);
const modelPath = requireString('POSE_MODEL_PATH', process.env);
const host = requireString('POSE_MODEL_HOST', process.env);
const port = readPositiveInteger('POSE_MODEL_PORT', process.env);
const maxRequestBytes = readPositiveInteger('POSE_MODEL_MAX_REQUEST_BYTES', process.env);
const landmarkerPath = requireString('POSE_LANDMARKER_PATH', process.env);
const maxPoses = readPositiveInteger('POSE_MODEL_MAX_POSES', process.env);
const maxTrackingDistance = requireString('POSE_MODEL_MAX_TRACKING_DISTANCE', process.env);
const minTrackFrames = readPositiveInteger('POSE_MODEL_MIN_TRACK_FRAMES', process.env);
const primaryThreshold = requireString('POSE_MODEL_PRIMARY_THRESHOLD', process.env);
const multiThreshold = requireString('POSE_MODEL_MULTI_THRESHOLD', process.env);

const child = spawn(python, [
  'home-monitor/training/pose_service.py',
  modelPath,
  '--host', host,
  '--port', String(port),
  '--max-request-bytes', String(maxRequestBytes),
  '--landmarker', landmarkerPath,
  '--max-poses', String(maxPoses),
  '--max-tracking-distance', maxTrackingDistance,
  '--min-track-frames', String(minTrackFrames),
  '--primary-threshold', primaryThreshold,
  '--multi-threshold', multiThreshold,
], { stdio: 'inherit', windowsHide: true });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('exit', (code, signal) => {
  if (signal) console.log(`Pose service stopped by ${signal}`);
  process.exitCode = code ?? 1;
});
