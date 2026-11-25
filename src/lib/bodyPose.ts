import limits from '../config/bodyScan.json';

export type BodyAngle = 'front' | 'left' | 'right';
export interface Point { part: string; x: number; y: number; score: number }
export interface Body { points: Point[]; score: number }
export const angles: BodyAngle[] = ['front', 'left', 'right'];
export const directions = { front: 'มองตรง', left: 'หันหน้าไปทางซ้ายเล็กน้อย', right: 'หันหน้าไปทางขวาเล็กน้อย' };
export const bodyGuide = 'ให้เห็นศีรษะ ไหล่ เข่า และเท้าทั้งสองข้างในกรอบ';

export function inspectBody(bodies: Body[], angle: BodyAngle, aspect: number) {
  if (bodies.length !== 1) return { hint: bodies.length ? 'ให้มีคนอยู่ในกรอบเพียงคนเดียว' : bodyGuide };
  const joints = new Map(bodies[0].points.map(p => [p.part, p]));
  const required = ['nose','leftEye','rightEye','leftShoulder','rightShoulder','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'];
  const margin = limits.frameInset;
  if (required.some(key => {
    const p = joints.get(key);
    return !p || p.score < limits.minJointScore || p.x < margin || p.x > 1-margin || p.y < margin || p.y > 1-margin;
  })) return { hint: bodyGuide };
  const nose = joints.get('nose')!;
  const feet = Math.max(joints.get('leftAnkle')!.y, joints.get('rightAnkle')!.y);
  if (feet - nose.y < limits.minHeight) return { hint: 'ขยับเข้ามาใกล้ขึ้น โดยให้ยังเห็นเท้าทั้งสองข้าง' };
  const eyes = [joints.get('leftEye')!, joints.get('rightEye')!];
  const eyeSpan = Math.abs(eyes[0].x-eyes[1].x);
  if (!eyeSpan) return { hint: 'เพิ่มแสงให้เห็นใบหน้าชัดขึ้น' };
  const offset = (nose.x - (eyes[0].x + eyes[1].x)/2) / eyeSpan;
  if (angle === 'front' ? Math.abs(offset) > limits.turnOffset : angle === 'left' ? offset < limits.turnOffset : offset > -limits.turnOffset)
    return { hint: directions[angle] };
  const width = Math.max(Math.abs(joints.get('leftShoulder')!.x - joints.get('rightShoulder')!.x) * limits.headBoxShoulderRatio, eyeSpan * 4);
  const height = width * aspect;
  const x = nose.x - width/2, y = nose.y - height/2;
  if (x < 0 || y < 0 || x+width > 1 || y+height > 1) return { hint: bodyGuide };
  return { hint: 'อยู่ในกรอบแล้ว ค้างสักครู่', head: { x, y, width, height }, center: nose };
}
