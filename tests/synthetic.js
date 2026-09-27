// Builds fake MediaPipe pose landmarks for simple, known movements so the rep
// counters can be tested without a camera. Coordinates are in pixels and get
// normalized to a 1280×720 frame.
import { P } from '../js/geometry.js';

export const W = 1280;
export const H = 720;
export const FPS = 30;
const rad = (deg) => (deg * Math.PI) / 180;

function blankPose() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
}

function put(lm, i, p, visibility) {
  lm[i] = { x: p.x / W, y: p.y / H, z: 0, visibility };
}

/**
 * Side view: the person's left side faces the camera; the far (right) side is
 * drawn slightly offset with low visibility, like MediaPipe reports it.
 */
function sideView(points) {
  const lm = blankPose();
  for (const [name, p] of Object.entries(points)) {
    const left = P[`left${name}`];
    const right = P[`right${name}`];
    if (left != null) put(lm, left, p, 0.95);
    if (right != null) put(lm, right, { x: p.x + 4, y: p.y - 3 }, 0.3);
  }
  if (points.Nose) put(lm, P.nose, points.Nose, 0.95);
  return lm;
}

/** Elbow position for a two-segment arm (both 150 px) between shoulder and wrist. */
function elbowBetween(S, Wr, seg = 150) {
  const dx = Wr.x - S.x;
  const dy = Wr.y - S.y;
  const d = Math.min(Math.hypot(dx, dy), 2 * seg - 0.01);
  const mx = (S.x + Wr.x) / 2;
  const my = (S.y + Wr.y) / 2;
  const off = Math.sqrt(seg * seg - (d / 2) ** 2);
  const n1 = { x: -dy / d, y: dx / d };
  const n = n1.x - n1.y >= 0 ? n1 : { x: -n1.x, y: -n1.y }; // bend toward the feet / upward
  return { x: mx + n.x * off, y: my + n.y * off };
}

/** Side-on push-up (head on the left) at a given elbow angle. */
export function pushupPose({ elbow, sag = 0, wrist = null, shoulder = null }) {
  const Wr = wrist || { x: 400, y: 600 };
  const d = Math.sqrt(2 * 150 * 150 * (1 - Math.cos(rad(elbow))));
  const S = shoulder || { x: Wr.x, y: Wr.y - d };
  const E = elbowBetween(S, Wr);
  const A = { x: 1000, y: 590 };
  const Hp = { x: S.x + 0.45 * (A.x - S.x), y: S.y + 0.45 * (A.y - S.y) + sag };
  const K = { x: Hp.x + 0.55 * (A.x - Hp.x), y: Hp.y + 0.55 * (A.y - Hp.y) };
  return sideView({
    Nose: { x: S.x - 60, y: S.y - 10 },
    Ear: { x: S.x - 40, y: S.y - 20 },
    Shoulder: S,
    Elbow: E,
    Wrist: Wr,
    Hip: Hp,
    Knee: K,
    Ankle: A,
    Heel: { x: A.x + 10, y: A.y - 5 },
    Foot: { x: A.x + 30, y: A.y + 10 },
  });
}

/**
 * Squat at progress f (0 standing → 1 deep). Side view faces left; front view
 * faces the camera. `lean` overrides the torso lean (deg); `valgus` pulls the
 * knees in at depth (front view).
 */
export function squatPose({ f, lean = null, front = false, valgus = false }) {
  const A = { x: 640, y: 650 };
  const beta = rad(100 * f); // thigh angle from vertical
  const gamma = rad(lean ?? 20 + 15 * f); // torso lean from vertical

  if (!front) {
    const alpha = rad(35 * f);
    const K = { x: A.x - 180 * Math.sin(alpha), y: A.y - 180 * Math.cos(alpha) };
    const Hp = { x: K.x + 180 * Math.sin(beta), y: K.y - 180 * Math.cos(beta) };
    const S = { x: Hp.x - 250 * Math.sin(gamma), y: Hp.y - 250 * Math.cos(gamma) };
    return sideView({
      Nose: { x: S.x - 20, y: S.y - 60 },
      Ear: { x: S.x, y: S.y - 55 },
      Shoulder: S,
      Elbow: { x: S.x - 120, y: S.y + 20 },
      Wrist: { x: S.x - 220, y: S.y + 10 },
      Hip: Hp,
      Knee: K,
      Ankle: A,
      Heel: { x: A.x + 15, y: A.y + 5 },
      Foot: { x: A.x - 40, y: A.y + 8 },
    });
  }

  const lm = blankPose();
  const kneeY = A.y - 180;
  const hipY = kneeY - 180 * Math.cos(beta);
  const shY = hipY - 250 * Math.cos(gamma);
  const kneeX = valgus ? 90 - 40 * f : 90 + 20 * f;
  const both = (name, dx, y) => {
    put(lm, P[`left${name}`], { x: A.x + dx, y }, 0.95); // person's left is on image right
    put(lm, P[`right${name}`], { x: A.x - dx, y }, 0.95);
  };
  both('Shoulder', 100, shY);
  both('Elbow', 120, shY + 120);
  both('Wrist', 110, shY + 220);
  both('Hip', 70, hipY);
  both('Knee', kneeX, kneeY);
  both('Ankle', 90, A.y);
  both('Heel', 90, A.y + 10);
  both('Foot', 100, A.y + 25);
  put(lm, P.nose, { x: A.x, y: shY - 70 }, 0.95);
  return lm;
}

/** Linear ramp of `frames` values from a to b (exclusive of a). */
export function ramp(a, b, seconds) {
  const n = Math.max(1, Math.round(seconds * FPS));
  return Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
}

export const hold = (v, seconds) => Array.from({ length: Math.round(seconds * FPS) }, () => v);

/** Feeds landmark lists through an analyzer at 30 fps; returns all events. */
export function run(analyzer, poses, source = '2d') {
  const events = [];
  poses.forEach((lm, i) => {
    const view = analyzer.update({ lm, world: null, w: W, h: H, t: (i * 1000) / FPS }, source);
    events.push(...view.events);
  });
  return events;
}
