// A tiny forward-kinematics body for tests: pose it with joint angles, then
// "film" it from the front or the side to get MediaPipe-style landmarks
// (normalized image coords + world coords in metres, y pointing down).
import { P } from '../js/geometry.js';

export const W = 1280;
export const H = 720;
const SCALE = 300; // px per metre
const rad = (d) => (d * Math.PI) / 180;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Unit vector perpendicular to `dir`, in the plane of `dir` and `toward` (`fallback` if they're parallel). */
const perpToward = (dir, toward, fallback = [0, 0, -1]) => {
  const v = add(toward, dir, -dot(toward, dir));
  if (Math.hypot(...v) > 1e-6) return norm(v);
  const w = add(fallback, dir, -dot(fallback, dir));
  return Math.hypot(...w) > 1e-6 ? norm(w) : norm(add([0, 1, 0], dir, -dot([0, 1, 0], dir)));
};
/** Turns `dir` toward `toward` by `deg` (in their common plane). */
const bendToward = (dir, toward, deg) => {
  const b = perpToward(dir, toward);
  return norm(add(scale(dir, Math.cos(rad(deg))), b, Math.sin(rad(deg))));
};

const FORWARD = [0, 0, -1]; // toward the camera in the front view
const UP = [0, -1, 0];
const DOWN = [0, 1, 0];

/** Rotation about x (pitch: + tips the body forward onto its face), z (roll) and y (yaw). */
function rotator({ pitch = 0, roll = 0, yaw = 0 } = {}) {
  const [cp, sp] = [Math.cos(rad(pitch)), Math.sin(rad(pitch))];
  const [cr, sr] = [Math.cos(rad(roll)), Math.sin(rad(roll))];
  const [cy, sy] = [Math.cos(rad(yaw)), Math.sin(rad(yaw))];
  return ([x, y, z]) => {
    // roll about z
    [x, y] = [cr * x - sr * y, sr * x + cr * y];
    // pitch about x: up [0,-1,0] → [0,-cos,-sin]
    [y, z] = [cp * y - sp * z, sp * y + cp * z];
    // yaw about y
    [x, z] = [cy * x + sy * z, -sy * x + cy * z];
    return [x, y, z];
  };
}

/**
 * @param o.lean   torso lean forward (deg), legs stay put
 * @param o.neck   head bend (deg): + chin toward the chest, − looking up
 * @param o.arms   [left, right] each { abd, flex, elbow, plane: 'forward'|'up' }
 *                 abd: arm out to the side (0 down, 90 horizontal, 180 up);
 *                 flex: arm forward (negative: behind you); elbow: bend (0 straight); plane: bend direction.
 *                 Or give directions outright: dir (upper arm), fore (forearm), hand — [out, down, back]
 *                 vectors, "out" being away from the body's midline on that side.
 * @param o.legs   [left, right] each { hip, knee, abd, ankle } — hip flexion forward, knee bend,
 *                 abduction, ankle (+ points the toes, as in a calf raise). Or dir (thigh) and shin.
 * @param o.rot    whole-body rotation { pitch, roll, yaw } (deg) about the pelvis:
 *                 pitch 90 lies face down, −90 face up, 180 upside down
 * @param o.at     [x, y, z] metres to move the pelvis after rotating
 */
export function skeleton(o = {}) {
  const lean = rad(o.lean ?? 0);
  const up = [0, -Math.cos(lean), -Math.sin(lean)];
  const fwdT = [0, Math.sin(lean), -Math.cos(lean)]; // chest direction
  const j = {};
  const pelvis = [0, 0, 0];
  const shoulderC = add(pelvis, up, 0.5);
  const arms = o.arms ?? [{}, {}];
  const legs = o.legs ?? [{}, {}];
  const side = (s, v) => [s * v[0], v[1], v[2]];

  for (const [i, sideName] of [[0, 'left'], [1, 'right']]) {
    const s = i === 0 ? 1 : -1; // person's left = +x (image right when facing the camera)
    const A = arms[i] || {};
    let upperDir, foreDir;
    if (A.dir) {
      upperDir = norm(side(s, A.dir));
    } else {
      const abd = rad(A.abd ?? 5);
      const flex = rad(A.flex ?? 0);
      upperDir = norm([s * Math.sin(abd) * Math.cos(flex), Math.cos(abd) * Math.cos(flex), -Math.sin(flex)]);
    }
    if (A.fore) {
      foreDir = norm(side(s, A.fore));
    } else {
      const bend = rad(A.elbow ?? 0);
      const bendDir = perpToward(upperDir, A.plane === 'up' ? UP : A.plane === 'back' ? [0, 0, 1] : FORWARD);
      foreDir = norm(add(upperDir.map((v) => v * Math.cos(bend)), bendDir, Math.sin(bend)));
    }
    const handDir = A.hand ? norm(side(s, A.hand)) : foreDir;
    const sh = add(shoulderC, [s * 0.19, 0, 0]);
    const el = add(sh, upperDir, 0.3);
    const wr = add(el, foreDir, 0.27);
    Object.assign(j, {
      [`${sideName}Shoulder`]: sh,
      [`${sideName}Elbow`]: el,
      [`${sideName}Wrist`]: wr,
      [`${sideName}Index`]: add(wr, handDir, 0.08),
      [`${sideName}Pinky`]: add(add(wr, handDir, 0.07), [s * 0.02, 0, 0]),
      [`${sideName}Thumb`]: add(add(wr, handDir, 0.04), [-s * 0.02, 0, 0]),
    });

    const L = legs[i] || {};
    const labd = rad(L.abd ?? 3);
    const legDir = (a) => norm([s * Math.sin(labd), Math.cos(labd) * Math.cos(a), -Math.cos(labd) * Math.sin(a)]);
    const hipA = rad(L.hip ?? 0);
    const knee = rad(L.knee ?? 0);
    const thigh = L.dir ? norm(side(s, L.dir)) : legDir(hipA);
    const shin = L.shin ? norm(side(s, L.shin)) : L.dir ? bendToward(thigh, [0, 0, 1], L.knee ?? 0) : legDir(hipA - knee);
    const hp = add(pelvis, [s * 0.1, 0, 0]);
    const kn = add(hp, thigh, 0.43);
    const an = add(kn, shin, 0.42);
    // Foot: in the plane of the shin, toes forward; `ankle` tips the toes down.
    const fwd0 = perpToward(shin, FORWARD, DOWN);
    const pf = rad(L.ankle ?? 0);
    const sd = norm(add(scale(shin, Math.cos(pf)), fwd0, -Math.sin(pf)));
    const fw = norm(add(scale(fwd0, Math.cos(pf)), shin, Math.sin(pf)));
    Object.assign(j, {
      [`${sideName}Hip`]: hp,
      [`${sideName}Knee`]: kn,
      [`${sideName}Ankle`]: an,
      [`${sideName}Heel`]: add(add(an, sd, 0.05), fw, -0.05),
      [`${sideName}Foot`]: add(add(an, sd, 0.06), fw, 0.15),
    });
  }

  // Head, bent at the neck by `neck`.
  const nk = rad(o.neck ?? 0);
  const hUp = norm(add(scale(up, Math.cos(nk)), fwdT, Math.sin(nk)));
  const hFwd = norm(add(scale(fwdT, Math.cos(nk)), up, -Math.sin(nk)));
  const headPt = (u, f, x = 0) => add(add(add(shoulderC, hUp, u), hFwd, f), [x, 0, 0]);
  j.leftEar = headPt(0.22, 0, 0.07);
  j.rightEar = headPt(0.22, 0, -0.07);
  j.nose = headPt(0.25, 0.08);
  j.leftEye = headPt(0.28, 0.07, 0.035);
  j.rightEye = headPt(0.28, 0.07, -0.035);
  j.mouthLeft = headPt(0.19, 0.07, 0.025);
  j.mouthRight = headPt(0.19, 0.07, -0.025);

  if (o.rot || o.at) {
    const R = rotator(o.rot);
    const at = o.at ?? [0, 0, 0];
    for (const k of Object.keys(j)) j[k] = add(R(j[k]), at);
  }
  return j;
}

/** Lowest point of a skeleton (largest y), e.g. to stand it on a floor. */
export const lowest = (j, names = null) => Math.max(...(names || Object.keys(j)).map((k) => j[k][1]));

const EXTRA = { leftEye: 2, rightEye: 5, mouthLeft: 9, mouthRight: 10 };

/**
 * Projects a skeleton to landmarks. 'front': the person faces the camera;
 * 'back': the camera is behind them; 'side': they face image-left with their
 * left side toward the camera.
 */
export function film(joints, { view = 'front', farVis = 0.3, offset = [640, 330], vis = null } = {}) {
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
      visibility: vis?.[name] ?? (far ? farVis : 0.95),
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

/** Like play, but also returns every view (for checking messages and statuses). */
export function playViews(analyzer, poses, source = 'auto') {
  return poses.map((pose, i) => analyzer.update({ lm: pose.lm, world: pose.world, w: W, h: H, t: (i * 1000) / FPS }, source));
}

export const repsOf = (events) => events.filter((e) => e.type === 'rep').map((e) => e.rep);
export const lerp = (a, b, t) => a + (b - a) * t;
