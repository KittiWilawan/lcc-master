import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import { PoseNet } from '@tensorflow-models/posenet';
import { MobileNet } from '@tensorflow-models/posenet/dist/mobilenet';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { decode as bytesOf } from 'base64-arraybuffer';
import { decode as decodeJpeg } from 'jpeg-js';
import graph from '../../assets/pose/model.json';
import limits from '../config/bodyScan.json';
import type { Body } from './bodyPose';

let pending: Promise<PoseNet> | undefined;
async function loadModel() {
  if (!tf.env().platform) tf.setPlatform('mobile', {
    fetch: (url, init) => fetch(url, init), now: () => performance.now(),
    encode: value => new TextEncoder().encode(value), decode: bytes => new TextDecoder().decode(bytes),
  });
  await tf.setBackend('cpu');
  // Metro resolves bundled binary assets by a static require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = await Asset.fromModule(require('../../assets/pose/group1-shard1of1.bin')).downloadAsync();
  const location = asset.localUri ?? asset.uri;
  const weights = location.startsWith('file:') ? await new File(location).arrayBuffer() : await (await fetch(location)).arrayBuffer();
  const model = await loadGraphModel(tf.io.fromMemory({
    modelTopology: graph.modelTopology, weightSpecs: graph.weightsManifest[0].weights as tf.io.WeightsManifestEntry[],
    weightData: weights,
  }));
  return new PoseNet(new MobileNet(model, limits.outputStride as 16), [limits.inputResolution[0], limits.inputResolution[1]]);
}

export async function findBodies(jpeg: string): Promise<Body[]> {
  pending ??= loadModel().catch(error => { pending = undefined; throw error; });
  const model = await pending;
  const image = decodeJpeg(new Uint8Array(bytesOf(jpeg)), { useTArray: true, formatAsRGBA: false });
  const pixels = tf.tensor3d(image.data, [image.height, image.width, 3], 'int32');
  try {
    const poses = await model.estimateMultiplePoses(pixels, { flipHorizontal: false, maxDetections: limits.maxPeople, scoreThreshold: limits.minPersonScore });
    return poses.filter(pose => pose.score >= limits.minPersonScore).map(pose => ({
      score: pose.score, points: pose.keypoints.map(p => ({ part: p.part, score: p.score, x: p.position.x/image.width, y: p.position.y/image.height })),
    }));
  } finally { pixels.dispose(); }
}
