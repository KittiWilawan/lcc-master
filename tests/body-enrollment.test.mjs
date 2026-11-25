import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const filename = resolve('src/lib/bodyPose.ts');
const module = { exports: {} };
const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(filename) });
const { inspectBody } = module.exports;

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
