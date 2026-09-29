import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextAlertState, requireUuid, validateAnalysis, validateIdentity } from './core.mjs';
import {
  analyzePair, analyzePoseSequence, identifyFallingPerson, mergePoseAndIdentity,
  poseOnlyAnalysis, readCameraImage,
} from './vision.mjs';

test('requires two confirmed samples and resets after a non-fall result', () => {
  const config = { confidence: 0.9, confirmations: 2, cooldownMs: 300000 };
  const fall = { status: 'fall', confidence: 0.95 };
  const normal = { status: 'normal', confidence: 0.99 };
  let state = { confirmations: 0, lastAlertAt: -Infinity, alerting: false };
  state = nextAlertState(state, fall, 1000, config);
  assert.equal(state.alert, false);
  state = nextAlertState(state, fall, 2000, config);
  assert.equal(state.alert, true);
  state = nextAlertState(state, fall, 3000, config);
  assert.equal(state.alert, false);
  state = nextAlertState(state, normal, 4000, config);
  assert.equal(state.confirmations, 0);
  state = nextAlertState(state, fall, 5000, config);
  state = nextAlertState(state, fall, 6000, config);
  assert.equal(state.alert, false);
  state = nextAlertState(state, normal, 301000, config);
  state = nextAlertState(state, fall, 302000, config);
  state = nextAlertState(state, fall, 303000, config);
  assert.equal(state.alert, true);
});

test('accepts a real family UUID and rejects placeholder or malformed values', () => {
  assert.equal(
    requireUuid('HOME_MONITOR_FAMILY_ID', {
      HOME_MONITOR_FAMILY_ID: '1367748e-f0e8-4802-afe5-7f9ec756424b',
    }),
    '1367748e-f0e8-4802-afe5-7f9ec756424b',
  );
  assert.throws(() => requireUuid('HOME_MONITOR_FAMILY_ID', {
    HOME_MONITOR_FAMILY_ID: '00000000-0000-0000-0000-000000000000',
  }));
  assert.throws(() => requireUuid('HOME_MONITOR_FAMILY_ID', {
    HOME_MONITOR_FAMILY_ID: 'not-a-family-id',
  }));
});

test('rejects malformed or exaggerated model output', () => {
  assert.throws(() => validateAnalysis({ status: 'fall', confidence: 1.4, reason: 'x' }));
  assert.throws(() => validateAnalysis({ status: 'fall', confidence: '0.95', reason: 'x' }));
  assert.throws(() => validateAnalysis({ status: 'unknown', confidence: 0.95, reason: 'x' }));
  assert.throws(() => validateAnalysis({ status: 'possible_fall', confidence: 0.5, reason: 'possible_fall' }));
});

test('validates identity separately from fall detection', () => {
  const identity = validateIdentity({
    reason: 'เสื้อผ้าและรูปร่างสอดคล้องกับภาพอ้างอิง',
    peopleCount: 2,
    subjectContinuity: 'multiple_people',
    fallingPersonMatch: 'possible_target',
    identityConfidence: 0.72,
  });
  assert.equal(identity.fallingPersonMatch, 'possible_target');
  assert.throws(() => validateIdentity({
    reason: 'ยืนยันบุคคล',
    peopleCount: 2,
    subjectContinuity: 'single_continuous_person',
    fallingPersonMatch: 'confirmed_target',
    identityConfidence: 0,
  }));
});

test('sends both frames to local model and validates its response', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.messages[1].images, ['AQID']);
      assert.deepEqual(body.messages[2].images, ['BAUG']);
      assert.equal(body.messages[1].content.includes('ก่อนเกิดเหตุ'), true);
      assert.equal(body.messages[2].content.includes('ภาพล่าสุด'), true);
      assert.equal(body.format.properties.status.type, 'string');
      return Response.json({ message: { content: JSON.stringify({
        status: 'uncertain', confidence: 0.2, reason: 'ภาพไม่ชัด',
        peopleCount: 1, subjectContinuity: 'uncertain',
        fallingPersonMatch: 'uncertain', identityConfidence: 0,
      }) } });
    };
    const result = await analyzePair(
      { bytes: Buffer.from([1, 2, 3]) },
      { bytes: Buffer.from([4, 5, 6]) },
      { ollamaUrl: 'http://127.0.0.1:11434/api/chat', model: 'test-model', instructions: 'test', contextLength: 4096, modelTimeoutMs: 1000 },
    );
    assert.equal(result.status, 'uncertain');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('sends identity references before camera frames', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.messages.slice(1).flatMap((message) => message.images), [
        'BwgJ', 'CgsM', 'DQ4P', 'EBES', 'AQID', 'BAUG',
      ]);
      return Response.json({ message: { content: JSON.stringify({
        status: 'fall', confidence: 0.95, reason: 'พบบุคคลล้มบนพื้น',
        peopleCount: 3, subjectContinuity: 'multiple_people',
        fallingPersonMatch: 'confirmed_target', identityConfidence: 0.88,
      }) } });
    };
    const result = await analyzePair(
      { bytes: Buffer.from([1, 2, 3]) },
      { bytes: Buffer.from([4, 5, 6]) },
      { ollamaUrl: 'http://127.0.0.1:11434/api/chat', model: 'test-model', instructions: 'test', contextLength: 4096, modelTimeoutMs: 1000 },
      [
        { pose: 'front', bytes: Buffer.from([7, 8, 9]) },
        { pose: 'left', bytes: Buffer.from([10, 11, 12]) },
        { pose: 'right', bytes: Buffer.from([13, 14, 15]) },
        { pose: 'full_body', bytes: Buffer.from([16, 17, 18]) },
      ],
    );
    assert.equal(result.fallingPersonMatch, 'confirmed_target');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('identity-only analysis cannot override the pose fall decision', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.format.properties.status, undefined);
      assert.equal(body.messages.length, 6);
      return Response.json({ message: { content: JSON.stringify({
        reason: 'รูปร่างคล้ายแต่ใบหน้าถูกบัง',
        peopleCount: 3,
        subjectContinuity: 'multiple_people',
        fallingPersonMatch: 'possible_target',
        identityConfidence: 0.7,
      }) } });
    };
    const identity = await identifyFallingPerson(
      { bytes: Buffer.from([1, 2, 3]) },
      { ollamaUrl: 'http://127.0.0.1:11434/api/chat', model: 'test-model', instructions: 'test', contextLength: 4096, modelTimeoutMs: 1000 },
      [1, 2, 3, 4].map((value) => ({ bytes: Buffer.from([value]) })),
    );
    const merged = mergePoseAndIdentity({ status: 'fall', confidence: 0.96 }, identity);
    assert.equal(merged.status, 'fall');
    assert.equal(merged.confidence, 0.96);
    assert.equal(merged.fallingPersonMatch, 'possible_target');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('does not confirm identity until all four reference poses exist', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ message: { content: JSON.stringify({
      status: 'fall', confidence: 0.95, reason: 'พบบุคคลล้มบนพื้น',
      peopleCount: 2, subjectContinuity: 'multiple_people',
      fallingPersonMatch: 'confirmed_target', identityConfidence: 0.99,
    }) } });
    const result = await analyzePair(
      { bytes: Buffer.from([1]) },
      { bytes: Buffer.from([2]) },
      { ollamaUrl: 'http://127.0.0.1:11434/api/chat', model: 'test-model', instructions: 'test', contextLength: 4096, modelTimeoutMs: 1000 },
      [{ pose: 'front', bytes: Buffer.from([3]) }],
    );
    assert.equal(result.fallingPersonMatch, 'uncertain');
    assert.equal(result.identityConfidence, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('camera source is restricted to configured origin and rejects redirects', async () => {
  const oldFetch = globalThis.fetch;
  const config = { allowedOrigins: ['http://127.0.0.1:1984'], imageTimeoutMs: 1000, maxImageBytes: 1000 };
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'http://another-host/image.jpg' } });
    };
    await assert.rejects(readCameraImage('http://127.0.0.1:1984/frame', config));
    await assert.rejects(readCameraImage('http://another-host/frame', config));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('pose sequence sends every frame and rejects malformed output', async () => {
  const oldFetch = globalThis.fetch;
  const config = {
    poseModelUrl: 'http://127.0.0.1:8765/analyze',
    poseModelTimeoutMs: 1000,
    poseModelFrames: 4,
  };
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.images, ['AQ==', 'Ag==', 'Aw==', 'BA==']);
      return Response.json({
        status: 'fall', confidence: 0.97, detectedPoseFrames: 4, peopleCount: 3, evaluatedTracks: 3,
      });
    };
    const result = await analyzePoseSequence(
      [1, 2, 3, 4].map((value) => ({ bytes: Buffer.from([value]) })), config,
    );
    assert.equal(result.status, 'fall');
    globalThis.fetch = async () => Response.json({ status: 'maybe', confidence: 2 });
    await assert.rejects(analyzePoseSequence(
      [1, 2, 3, 4].map((value) => ({ bytes: Buffer.from([value]) })), config,
    ));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('pose detector controls fall status while visual model supplies identity', () => {
  const pose = {
    status: 'fall', confidence: 0.96, detectedPoseFrames: 4, peopleCount: 2, evaluatedTracks: 2,
  };
  const identity = {
    status: 'normal', confidence: 0.8, reason: 'เห็นใบหน้าตรงกับรูปอ้างอิง',
    peopleCount: 2, subjectContinuity: 'multiple_people',
    fallingPersonMatch: 'confirmed_target', identityConfidence: 0.91,
  };
  const merged = mergePoseAndIdentity(pose, identity);
  assert.equal(merged.status, 'fall');
  assert.equal(merged.confidence, 0.96);
  assert.equal(merged.fallingPersonMatch, 'confirmed_target');
  assert.equal(poseOnlyAnalysis({
    status: 'normal', confidence: 0.08, detectedPoseFrames: 4, peopleCount: 2, evaluatedTracks: 2,
  }).confidence, 0.92);
});
