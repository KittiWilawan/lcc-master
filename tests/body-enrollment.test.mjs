import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

function load(relative) {
  const filename = resolve(relative);
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(filename), setTimeout, clearTimeout });
  return module.exports;
}
const { inspectBody } = load('src/lib/bodyPose.ts');
const { EnrollmentFrameRequest } = load('src/lib/enrollmentFrameRequest.ts');

function person(noseX = 0.5) {
  const points = [['nose',noseX,.22], ['leftEye',.53,.20], ['rightEye',.47,.20],
    ['leftShoulder',.60,.32], ['rightShoulder',.40,.32], ['leftHip',.56,.53], ['rightHip',.44,.53],
    ['leftKnee',.58,.70], ['rightKnee',.42,.70], ['leftAnkle',.60,.90], ['rightAnkle',.40,.90]];
  return { score: .9, points: points.map(([part,x,y]) => ({ part,x,y,score:.9 })) };
}

test('full-body enrollment only captures the requested angle of one visible person', () => {
  assert.ok(inspectBody([person()], 'front', .75).head);
  assert.ok(inspectBody([person(.52)], 'left', .75).head);
  assert.ok(inspectBody([person(.48)], 'right', .75).head);
  assert.equal(inspectBody([person(.48)], 'left', .75).head, undefined);
  for (const group of [[], [person(),person()]]) assert.equal(inspectBody(group, 'front', .75).head, undefined);
});

test('an obscured or cropped foot and a missing face prevent full-body enrollment', () => {
  for (const key of ['nose','leftAnkle','rightAnkle']) {
    const blurred = person();
    blurred.points.find(p => p.part === key).score = 0;
    assert.equal(inspectBody([blurred], 'front', .75).head, undefined);
  }
  const cropped = person();
  cropped.points.find(p => p.part === 'rightAnkle').y = 1;
  assert.equal(inspectBody([cropped], 'front', .75).head, undefined);
});

test('cancelling a scan releases the capture loop without waiting for inference', async () => {
  let sent;
  const requests = new EnrollmentFrameRequest(frame => { sent = frame; });
  const scan = new AbortController();
  const done = requests.analyze('image', scan.signal);
  scan.abort();
  await assert.rejects(done, /Scan ended/);
  assert.equal(requests.receive(sent.id, [person()]), false);
});

test('only the new camera may supply the result after a lens switch', async () => {
  const frames = [];
  const requests = new EnrollmentFrameRequest(frame => frames.push(frame));
  const back = new AbortController();
  const previous = requests.analyze('back', back.signal);
  back.abort();
  const next = requests.analyze('front', new AbortController().signal);
  assert.equal(requests.receive(frames[0].id, null), false);
  assert.equal(requests.receive(frames[1].id, []), true);
  await assert.rejects(previous, /Scan ended/);
  assert.deepEqual(await next, []);
});
