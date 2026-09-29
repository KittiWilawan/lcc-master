import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

function run(command, argumentsList) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argumentsList, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ทำงานไม่สำเร็จ (${code}): ${errorText.slice(-500)}`));
    });
  });
}

function parseAnnotations(text) {
  const rows = new Map();
  for (const rawLine of text.split('\n')) {
    const fields = rawLine.trim().split(',');
    if (fields.length < 3) continue;
    const sequence = fields[0];
    const frame = Number(fields[1]);
    const label = Number(fields[2]);
    if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(label)) continue;
    const sequenceRows = rows.get(sequence) || [];
    sequenceRows.push({ frame, label });
    rows.set(sequence, sequenceRows);
  }
  return rows;
}

async function extractFrame(videoPath, frameNumber, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const zeroBasedFrame = Math.max(0, frameNumber - 1);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
    '-vf', `select=eq(n\\,${zeroBasedFrame})`, '-frames:v', '1', '-q:v', '2', outputPath,
  ]);
}

function numberedId(prefix, index) {
  return `${prefix}-${String(index).padStart(2, '0')}`;
}

async function main() {
  const datasetRoot = resolve(process.argv[2] || 'D:/lcc-ai-benchmark/urfall');
  const outputRoot = resolve(process.argv[3] || 'test-artifacts/ai-evaluation/urfall-pilot');
  const annotations = parseAnnotations(await readFile(join(datasetRoot, 'urfall-cam0-falls.csv'), 'utf8'));
  const cases = [];

  for (let index = 1; index <= 6; index += 1) {
    const sequence = numberedId('fall', index);
    const rows = annotations.get(sequence) || [];
    const transition = rows.find((row) => row.label === 0);
    const onFloor = rows.find((row) => row.label === 1);
    if (!transition || !onFloor) throw new Error(`ไม่พบป้ายกำกับครบสำหรับ ${sequence}`);
    const previousFrame = Math.max(1, transition.frame - 8);
    const currentFrame = onFloor.frame + 8;
    for (const camera of ['cam0', 'cam1']) {
      const caseId = `${sequence}-${camera}`;
      const previousPath = join(outputRoot, 'frames', `${caseId}-previous.jpg`);
      const currentPath = join(outputRoot, 'frames', `${caseId}-current.jpg`);
      const videoPath = join(datasetRoot, `${sequence}-${camera}.mp4`);
      await extractFrame(videoPath, previousFrame, previousPath);
      await extractFrame(videoPath, currentFrame, currentPath);
      cases.push({
        caseId,
        label: 'fall',
        source: 'UR Fall Detection Dataset',
        license: 'CC BY-NC-SA 4.0',
        sequence,
        cameraAngle: camera === 'cam0' ? 'front_oblique' : 'side_oblique',
        action: 'fall_to_floor',
        ageGroup: 'not_provided',
        sex: 'not_provided',
        previousFrame: previousPath,
        currentFrame: currentPath,
      });
    }
  }

  for (let index = 1; index <= 6; index += 1) {
    const sequence = numberedId('adl', index);
    const caseId = `${sequence}-cam0`;
    const previousPath = join(outputRoot, 'frames', `${caseId}-previous.jpg`);
    const currentPath = join(outputRoot, 'frames', `${caseId}-current.jpg`);
    const videoPath = join(datasetRoot, `${sequence}-cam0.mp4`);
    await extractFrame(videoPath, 35, previousPath);
    await extractFrame(videoPath, 55, currentPath);
    cases.push({
      caseId,
      label: 'normal',
      source: 'UR Fall Detection Dataset',
      license: 'CC BY-NC-SA 4.0',
      sequence,
      cameraAngle: 'front_oblique',
      action: 'activity_of_daily_living',
      ageGroup: 'not_provided',
      sex: 'not_provided',
      previousFrame: previousPath,
      currentFrame: currentPath,
    });
  }

  await mkdir(outputRoot, { recursive: true });
  const manifestPath = join(outputRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({ dataset: 'UR Fall Detection Dataset', cases }, null, 2)}\n`);
  console.log(JSON.stringify({ manifestPath, cases: cases.length }, null, 2));
}

main().catch((error) => {
  console.error('เตรียมชุดทดสอบไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});
