import { readBodyPoseWeights } from './bodyPoseWeights';
import { inferBodies } from './bodyPoseInference';

export function findBodies(jpeg: string) {
  return inferBodies(jpeg, readBodyPoseWeights);
}
