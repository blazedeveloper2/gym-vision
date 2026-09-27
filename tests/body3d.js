// A tiny forward-kinematics body for tests: pose it with joint angles, then
// "film" it from the front or the side to get MediaPipe-style landmarks
// (normalized image coords + world coords in metres, y pointing down).
import { P } from '../js/geometry.js';

export const W = 1280;
export const H = 720;
const SCALE = 300; // px per metre
const rad = (d) => (d * Math.PI) / 180;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Unit vector perpendicular to `dir`, in the plane of `dir` and `toward` (forward if they're parallel). */
const perpToward = (dir, toward) => {
  const v = add(toward, dir, -dot(toward, dir));
  return Math.hypot(...v) < 1e-6 ? perpToward(dir, [0, 0, -1]) : norm(v);
};

const FORWARD = [0, 0, -1]; // toward the camera in the front view
const UP = [0, -1, 0];

/**
 * @param o.lean   torso lean forward (deg)
 * @param o.arms   [left, right] each { abd, flex, elbow, plane: 'forward'|'up' }
 *                 abd: arm out to the side (0 down, 90 horizontal, 180 up);
 *                 flex: arm forward; elbow: bend (0 straight); plane: bend direction
 * @param o.legs   [left, right] each { hip, knee, abd } — hip flexion forward, knee bend, abduction
 */
export function skeleton(o = {}) {
  const lean = rad(o.lean ?? 0);
  const up = [0, -Math.cos(lean), -Math.sin(lean)];
  const j = {};
  const pelvis = [0, 0, 0];
  const shoulderC = add(pelvis, up, 0.5);
  const arms = o.arms ?? [{}, {}];
  const legs = o.legs ?? [{}, {}];

  for (const [i, side] of [[0, 'left'], [1, 'right']]) {
    const s = i === 0 ? 1 : -1; // person's left = +x (image right when facing the camera)
    const A = arms[i];
    const abd = rad(A.abd ?? 5);
    const flex = rad(A.flex ?? 0);
    const upperDir = norm([s * Math.sin(abd) * Math.cos(flex), Math.cos(abd) * Math.cos(flex), -Math.sin(flex)]);
    const bend = rad(A.elbow ?? 0);
    const bendDir = perpToward(upperDir, A.plane === 'up' ? UP : FORWARD);
    const foreDir = norm(add(upperDir.map((v) => v * Math.cos(bend)), bendDir, Math.sin(bend)));
    const sh = add(shoulderC, [s * 0.19, 0, 0]);
    const el = add(sh, upperDir, 0.3);
    const wr = add(el, foreDir, 0.27);
    Object.assign(j, {
      [`${side}Shoulder`]: sh,
      [`${side}Elbow`]: el,
      [`${side}Wrist`]: wr,
      [`${side}Index`]: add(wr, foreDir, 0.08),
      [`${side}Pinky`]: add(add(wr, foreDir, 0.07), [s * 0.02, 0, 0]),
      [`${side}Thumb`]: add(add(wr, foreDir, 0.04), [-s * 0.02, 0, 0]),
    });

    const L = legs[i];
    const hipA = rad(L.hip ?? 0);
    const knee = rad(L.knee ?? 0);
    const labd = rad(L.abd ?? 3);
    const legDir = (a) => norm([s * Math.sin(labd), Math.cos(labd) * Math.cos(a), -Math.cos(labd) * Math.sin(a)]);
    const hp = add(pelvis, [s * 0.1, 0, 0]);
    const kn = add(hp, legDir(hipA), 0.43);
    const an = add(kn, legDir(hipA - knee), 0.42);
    Object.assign(j, {
      [`${side}Hip`]: hp,
      [`${side}Knee`]: kn,
      [`${side}Ankle`]: an,
      [`${side}Heel`]: add(an, [0, 0.05, 0.05]),
      [`${side}Foot`]: add(an, [0, 0.06, -0.15]),
      [`${side}Ear`]: add(add(shoulderC, up, 0.22), [s * 0.07, 0, 0]),
    });
  }
  j.nose = add(add(shoulderC, up, 0.25), FORWARD, 0.08);
  j.leftEye = add(add(add(shoulderC, up, 0.28), FORWARD, 0.07), [0.035, 0, 0]);
  j.rightEye = add(add(add(shoulderC, up, 0.28), FORWARD, 0.07), [-0.035, 0, 0]);
  j.mouthLeft = add(add(add(shoulderC, up, 0.19), FORWARD, 0.07), [0.025, 0, 0]);
  j.mouthRight = add(add(add(shoulderC, up, 0.19), FORWARD, 0.07), [-0.025, 0, 0]);
  return j;
}

const EXTRA = { leftEye: 2, rightEye: 5, mouthLeft: 9, mouthRight: 10 };

/**
 * Projects a skeleton to landmarks. 'front': the person faces the camera;
 * 'back': the camera is behind them; 'side': they face image-left with their
 * left side toward the camera.
 */
export function film(joints, { view = 'front', farVis = 0.3, offset = [640, 330] } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [name, p] of Object.entries(joints)) {
    const i = P[name] ?? EXTRA[name];
    if (i == null) continue;
    const face = name === 'nose' || name.endsWith('Eye') || name.startsWith('mouth');
    const far = (view === 'side' && name.startsWith('right')) || (view === 'back' && face);
    const x = view === 'front' ? p[0] : view === 'back' ? -p[0] : p[2];
    lm[i] = {
      x: (offset[0] + x * SCALE + (far ? 4 : 0)) / W,
      y: (offset[1] + p[1] * SCALE - (far ? 3 : 0)) / H,
      z: 0,
      visibility: far ? farVis : 0.95,
    };
    world[i] = { x: p[0], y: p[1], z: p[2] };
  }
  return { lm, world };
}

export const FPS = 30;
/** Values from a to b over `seconds` (excluding a). */
export const ramp = (a, b, seconds) => {
  const n = Math.max(1, Math.round(seconds * FPS));
  return Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
};
export const hold = (v, seconds) => Array.from({ length: Math.round(seconds * FPS) }, () => v);
/** Linear 0→1→0 over `seconds`, with pauses. */
export const cycle = (seconds = 2, pause = 0.3) => [...hold(0, pause), ...ramp(0, 1, seconds / 2), ...hold(1, 0.15), ...ramp(1, 0, seconds / 2)];

/** Runs poses through an analyzer at 30 fps; returns the events. */
export function play(analyzer, poses, source = 'auto') {
  const events = [];
  poses.forEach((pose, i) => {
    const view = analyzer.update({ lm: pose.lm, world: pose.world, w: W, h: H, t: (i * 1000) / FPS }, source);
    events.push(...view.events);
  });
  return events;
}

export const repsOf = (events) => events.filter((e) => e.type === 'rep').map((e) => e.rep);
export const lerp = (a, b, t) => a + (b - a) * t;
