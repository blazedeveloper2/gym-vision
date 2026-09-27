// MediaPipe Pose landmark indices. "Left"/"right" are the person's own sides.
export const P = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
};

// Joint angles shown in tracker mode: angle at `b` between segments b→a and b→c.
export const JOINTS = [
  { key: 'elbow', label: 'Elbow', side: 'L', a: P.leftShoulder, b: P.leftElbow, c: P.leftWrist },
  { key: 'elbow', label: 'Elbow', side: 'R', a: P.rightShoulder, b: P.rightElbow, c: P.rightWrist },
  { key: 'shoulder', label: 'Shoulder', side: 'L', a: P.leftElbow, b: P.leftShoulder, c: P.leftHip },
  { key: 'shoulder', label: 'Shoulder', side: 'R', a: P.rightElbow, b: P.rightShoulder, c: P.rightHip },
  { key: 'hip', label: 'Hip', side: 'L', a: P.leftShoulder, b: P.leftHip, c: P.leftKnee },
  { key: 'hip', label: 'Hip', side: 'R', a: P.rightShoulder, b: P.rightHip, c: P.rightKnee },
  { key: 'knee', label: 'Knee', side: 'L', a: P.leftHip, b: P.leftKnee, c: P.leftAnkle },
  { key: 'knee', label: 'Knee', side: 'R', a: P.rightHip, b: P.rightKnee, c: P.rightAnkle },
];

export const vis = (lm) => (lm && lm.visibility != null ? lm.visibility : 0);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Angle in degrees at b, formed by points a-b-c. Works for 2D ({x,y}) or 3D ({x,y,z}). */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = (a.z || 0) - (b.z || 0);
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = (c.z || 0) - (b.z || 0);
  const n1 = Math.hypot(v1x, v1y, v1z);
  const n2 = Math.hypot(v2x, v2y, v2z);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = clamp((v1x * v2x + v1y * v2y + v1z * v2z) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Normalized landmark → pixel-space 2D point (z dropped). */
export const toPx = (lm, w, h) => ({ x: lm.x * w, y: lm.y * h, z: 0 });

/**
 * Builds an angle function over a frame. '2d' measures in the camera image
 * (pixel space, so aspect ratio is respected); '3d' uses MediaPipe's
 * estimated world coordinates in metres.
 */
export function angleFn(frame, source) {
  const { lm, world, w, h } = frame;
  if (source === '3d' && world) {
    return (a, b, c) => angleAt(world[a], world[b], world[c]);
  }
  return (a, b, c) => angleAt(toPx(lm[a], w, h), toPx(lm[b], w, h), toPx(lm[c], w, h));
}

/** Exponential moving average for jitter reduction. */
export class Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }
  next(v) {
    if (!Number.isFinite(v)) return this.value;
    this.value = this.value == null ? v : this.value + this.alpha * (v - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
  }
}
