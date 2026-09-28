import { P, vis } from '../geometry.js';

/**
 * Body measurements from the person-segmentation mask.
 *
 * Widths are found by walking out from a limb or torso axis until the mask
 * drops below 0.5, with sub-pixel interpolation of the edge. Your height
 * (head top to soles, also found in the mask) converts pixels to centimetres.
 * Circumferences are estimated from widths:
 * - limbs are close to round: C ≈ π·width
 * - torso sections are boxier ellipses: Ramanujan's perimeter on width × depth
 *   (depth from a side-on capture, or a typical ratio), ×1.08 for the corners.
 *
 * These are estimates (clothing, posture and distance all matter); they are
 * most useful for tracking change with the same setup over time.
 */

/** Bilinear sampler over a Float32Array mask; outside the image is 0. */
export function createSampler(data, w, h) {
  return (x, y) => {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * w + x0;
    const top = data[i] + (data[i + 1] - data[i]) * tx;
    const bot = data[i + w] + (data[i + w + 1] - data[i + w]) * tx;
    return top + (bot - top) * ty;
  };
}

/**
 * Distance from (cx, cy) along unit (dx, dy) to where the mask drops below
 * 0.5. Returns null if the start is outside the body or no edge is found
 * within maxDist. With `stopAtLimit`, hitting the limit returns the limit.
 */
export function edgeDistance(sample, cx, cy, dx, dy, maxDist, { step = 0.5, stopAtLimit = false } = {}) {
  let prev = sample(cx, cy);
  if (prev < 0.5) return null;
  for (let s = step; s <= maxDist; s += step) {
    const v = sample(cx + dx * s, cy + dy * s);
    if (v < 0.5) return s - step + ((prev - 0.5) / (prev - v)) * step;
    prev = v;
  }
  return stopAtLimit ? maxDist : null;
}

/**
 * Width across a limb or torso at point c, perpendicular to unit direction
 * `along`. `limits` = [max distance one way, max the other way]; `soft` sides
 * may stop at their limit (e.g. thighs touching).
 */
export function crossWidth(sample, c, along, limits, soft = [false, false]) {
  const nx = -along.y;
  const ny = along.x;
  const a = edgeDistance(sample, c.x, c.y, nx, ny, limits[0], { stopAtLimit: soft[0] });
  const b = edgeDistance(sample, c.x, c.y, -nx, -ny, limits[1], { stopAtLimit: soft[1] });
  if (a == null || b == null) return null;
  return {
    width: a + b,
    touched: (soft[0] && a >= limits[0]) || (soft[1] && b >= limits[1]),
    p1: { x: c.x + nx * a, y: c.y + ny * a },
    p2: { x: c.x - nx * b, y: c.y - ny * b },
  };
}

const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Widest (or narrowest) cross-section between fractions t0..t1 of a→b.
 * `limitsFn(t, c)` returns [max one way, max the other way], or
 * {limits, soft} when a side may stop at its limit.
 */
function scanAlong(sample, a, b, t0, t1, limitsFn, { mode = 'max', steps = 9, soft } = {}) {
  const dir = unit(a, b);
  let best = null;
  for (let k = 0; k < steps; k++) {
    const t = t0 + ((t1 - t0) * k) / (steps - 1);
    const c = at(a, b, t);
    const lim = limitsFn(t, c);
    const r = Array.isArray(lim) ? crossWidth(sample, c, dir, lim, soft) : crossWidth(sample, c, dir, lim.limits, lim.soft);
    if (!r) continue;
    if (!best || (mode === 'max' ? r.width > best.width : r.width < best.width)) best = { ...r, t };
  }
  return best;
}

export const MEASURES = {
  shoulders: { name: 'Shoulder width', kind: 'width' },
  chest: { name: 'Chest', kind: 'torso', ratio: 0.72 },
  waist: { name: 'Waist', kind: 'torso', ratio: 0.78 },
  hips: { name: 'Hips', kind: 'torso', ratio: 0.8 },
  armL: { name: 'Upper arm (left)', kind: 'limb' },
  armR: { name: 'Upper arm (right)', kind: 'limb' },
  flexL: { name: 'Flexed biceps (left)', kind: 'flex' },
  flexR: { name: 'Flexed biceps (right)', kind: 'flex' },
  forearmL: { name: 'Forearm (left)', kind: 'limb' },
  forearmR: { name: 'Forearm (right)', kind: 'limb' },
  thighL: { name: 'Mid-thigh (left)', kind: 'limb' },
  thighR: { name: 'Mid-thigh (right)', kind: 'limb' },
  calfL: { name: 'Calf (left)', kind: 'limb' },
  calfR: { name: 'Calf (right)', kind: 'limb' },
};

/** Distance along the ray c + s·d (s > 0) to the polyline `pts`, or Infinity. */
function rayHit(c, d, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const ex = pts[i + 1].x - a.x;
    const ey = pts[i + 1].y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den;
    if (s > 0 && u >= 0 && u <= 1) best = Math.min(best, s);
  }
  return best;
}

export const STEPS = {
  front: {
    title: 'Front',
    instruction: 'Face the camera, 2–3 m away. Arms out a little (like an A), feet hip-width apart.',
    needed: [P.nose, P.leftShoulder, P.rightShoulder, P.leftElbow, P.rightElbow, P.leftWrist, P.rightWrist, P.leftHip, P.rightHip, P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle],
  },
  flex: {
    title: 'Flex',
    instruction: 'Double-biceps pose: upper arms out to the sides at shoulder height, fists up, flex hard.',
    needed: [P.nose, P.leftShoulder, P.rightShoulder, P.leftElbow, P.rightElbow, P.leftWrist, P.rightWrist, P.leftHip, P.rightHip, P.leftAnkle, P.rightAnkle],
  },
  side: {
    title: 'Side',
    instruction: 'Turn 90° so your side faces the camera. Arms relaxed, stand tall.',
    needed: [P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip, P.leftAnkle, P.rightAnkle],
  },
};

/**
 * Checks that the pose suits a capture step. Returns a list of problems
 * (empty = good to capture). `lenient` (while capturing) only checks what
 * would make the numbers wrong, not small posture wobbles.
 */
export function checkPose(step, landmarks, w, h, { lenient = false } = {}) {
  const problems = [];
  if (STEPS[step].needed.some((i) => vis(landmarks[i]) < 0.5)) return ['Step back so your whole body, head to feet, is in view'];
  const lm = landmarks.map((p) => ({ x: p.x * w, y: p.y * h })); // pixels, so x and y share a scale
  const ls = lm[P.leftShoulder], rs = lm[P.rightShoulder], lh = lm[P.leftHip], rh = lm[P.rightHip];
  const S = at(ls, rs, 0.5);
  const Hc = at(lh, rh, 0.5);
  const torso = Math.hypot(S.x - Hc.x, S.y - Hc.y) || 1;
  // Height needs the top of the head and the soles inside the frame.
  const ys = (ids) => ids.filter((i) => vis(landmarks[i]) >= 0.3).map((i) => lm[i].y);
  const headTop = Math.min(...ys([P.nose, P.leftEar, P.rightEar])) - 0.45 * torso;
  const soles = Math.max(...ys([P.leftAnkle, P.rightAnkle, P.leftHeel, P.rightHeel, P.leftFoot, P.rightFoot])) + 0.04 * torso;
  if (headTop < 2) return ['Step back or tilt the phone — the top of your head is cut off'];
  if (soles > h - 2) return ['Step back or tilt the phone — your feet are cut off'];
  const spread = Math.abs(ls.x - rs.x) / torso;
  const upright = Math.abs(S.x - Hc.x) / torso < 0.2;
  if (!upright && !lenient) problems.push('Stand up straight');
  if (step === 'side') {
    if (spread > 0.35) problems.push('Turn so your side faces the camera');
    return problems;
  }
  if (spread < 0.45) problems.push('Face the camera');
  if (lenient) return problems;
  const le = lm[P.leftElbow], re = lm[P.rightElbow], lw = lm[P.leftWrist], rw = lm[P.rightWrist];
  if (step === 'front') {
    // Each arm (shoulder → wrist) should angle out from the body, like an A.
    const down = unit(S, Hc);
    const outAngle = (sh, wr) => {
      const a = unit(sh, wr);
      return (Math.acos(Math.max(-1, Math.min(1, a.x * down.x + a.y * down.y))) * 180) / Math.PI;
    };
    if (Math.min(outAngle(ls, lw), outAngle(rs, rw)) < 10) problems.push('Hold your arms a little away from your body');
    if (lw.y < ls.y || rw.y < rs.y) problems.push('Lower your arms to your sides');
  } else if (step === 'flex') {
    const elbowsUp = Math.abs(le.y - ls.y) / torso < 0.3 && Math.abs(re.y - rs.y) / torso < 0.3;
    if (!elbowsUp) problems.push('Raise your elbows to shoulder height');
    if (lw.y > le.y || rw.y > re.y) problems.push('Fists up — bend your elbows');
  }
  return problems;
}

/**
 * Measures one frame. `mask` = {data: Float32Array, w, h}; landmarks are
 * normalized. Returns { heightPx, widths: {id: {width, p1, p2, touched}} } in mask pixels.
 */
export function measureFrame(step, mask, lm) {
  const { w, h } = mask;
  const sample = createSampler(mask.data, w, h);
  const px = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const S = at(px(P.leftShoulder), px(P.rightShoulder), 0.5);
  const Hc = at(px(P.leftHip), px(P.rightHip), 0.5);
  const T = Math.hypot(S.x - Hc.x, S.y - Hc.y);

  // Height: head top (walk up from the head centre) to the lowest sole.
  const headC = vis(lm[P.leftEar]) > 0.5 && vis(lm[P.rightEar]) > 0.5 ? at(px(P.leftEar), px(P.rightEar), 0.5) : px(P.nose);
  const up = edgeDistance(sample, headC.x, headC.y, 0, -1, 1.2 * T);
  let bottom = null;
  for (const ank of [P.leftAnkle, P.rightAnkle]) {
    const a = px(ank);
    const d = edgeDistance(sample, a.x, a.y, 0, 1, 0.6 * T);
    if (d != null) bottom = Math.max(bottom ?? -Infinity, a.y + d);
  }
  // An "edge" at the image border means the body is cut off, not measured.
  const top = up != null ? headC.y - up : null;
  const cut = (top != null && top < 1.5) || (bottom != null && bottom > h - 1.5);
  const heightPx = top != null && bottom != null && !cut ? bottom - top : null;
  const widths = {};
  const put = (id, r) => {
    if (r) widths[id] = r;
  };
  const torsoDir = unit(S, Hc);
  const torsoLimit = () => [0.9 * T, 0.9 * T];
  // Front view: arms close to the sides would otherwise be counted as torso.
  // Each side's scan stops at the inner edge of the arm it runs into.
  const arms = [
    [px(P.leftShoulder), px(P.leftElbow), px(P.leftWrist)],
    [px(P.rightShoulder), px(P.rightElbow), px(P.rightWrist)],
  ];
  const armHalf = 0.09 * T;
  const torsoArmLimit = (t, c) => {
    const n = { x: -torsoDir.y, y: torsoDir.x }; // crossWidth's first scan direction
    const limits = [0.9 * T, 0.9 * T];
    const soft = [false, false];
    [n, { x: -n.x, y: -n.y }].forEach((d, i) => {
      const hit = Math.min(...arms.map((a) => rayHit(c, d, a)));
      if (hit - armHalf < limits[i]) {
        limits[i] = Math.max(hit - armHalf, 0.1 * T);
        soft[i] = true;
      }
    });
    return { limits, soft };
  };

  if (step === 'front') {
    put('shoulders', crossWidth(sample, S, torsoDir, [1.1 * T, 1.1 * T]));
    put('chest', scanAlong(sample, S, Hc, 0.26, 0.34, torsoArmLimit, { steps: 3 }));
    put('waist', scanAlong(sample, S, Hc, 0.55, 0.85, torsoArmLimit, { mode: 'min', steps: 7 }));
    put('hips', scanAlong(sample, S, Hc, 0.95, 1.12, torsoArmLimit, { steps: 5 }));
    const L = { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, kn: P.leftKnee, an: P.leftAnkle };
    const R = { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, kn: P.rightKnee, an: P.rightAnkle };
    for (const [k, s, o] of [['L', L, R], ['R', R, L]]) {
      put(`arm${k}`, scanAlong(sample, px(s.sh), px(s.el), 0.3, 0.65, () => [0.3 * T, 0.3 * T]));
      put(`forearm${k}`, scanAlong(sample, px(s.el), px(s.wr), 0.15, 0.45, () => [0.25 * T, 0.25 * T]));
      // Legs may touch: cap the inner side at the midpoint between the two legs.
      const leg = (a, b, t0, t1, outerLimit) => {
        const dir = unit(px(a(s)), px(b(s)));
        const n = { x: -dir.y, y: dir.x }; // crossWidth's first scan direction
        return scanAlong(sample, px(a(s)), px(b(s)), t0, t1, (t, c) => {
          const other = at(px(a(o)), px(b(o)), t);
          const toward = (other.x - c.x) * n.x + (other.y - c.y) * n.y; // + if n points at the other leg
          const gap = Math.max(Math.abs(toward) / 2, 4);
          return toward > 0 ? [gap, outerLimit] : [outerLimit, gap];
        }, {
          soft: (() => {
            const other = at(px(a(o)), px(b(o)), (t0 + t1) / 2);
            const c = at(px(a(s)), px(b(s)), (t0 + t1) / 2);
            return (other.x - c.x) * n.x + (other.y - c.y) * n.y > 0 ? [true, false] : [false, true];
          })(),
        });
      };
      put(`thigh${k}`, leg((x) => x.hip, (x) => x.kn, 0.3, 0.5, 0.5 * T));
      put(`calf${k}`, leg((x) => x.kn, (x) => x.an, 0.2, 0.5, 0.35 * T));
    }
  } else if (step === 'flex') {
    put('flexL', scanAlong(sample, px(P.leftShoulder), px(P.leftElbow), 0.3, 0.8, () => [0.4 * T, 0.4 * T], { steps: 11 }));
    put('flexR', scanAlong(sample, px(P.rightShoulder), px(P.rightElbow), 0.3, 0.8, () => [0.4 * T, 0.4 * T], { steps: 11 }));
  } else if (step === 'side') {
    // Depth of the torso seen side-on, at the same heights as the front widths.
    put('chest', scanAlong(sample, S, Hc, 0.26, 0.34, torsoLimit, { steps: 3 }));
    put('waist', scanAlong(sample, S, Hc, 0.55, 0.85, torsoLimit, { mode: 'min', steps: 7 }));
    put('hips', scanAlong(sample, S, Hc, 0.95, 1.12, torsoLimit, { steps: 5 }));
  }
  return { heightPx, widths };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** Collects frames for one step and reduces them to centimetres. */
export class StepCapture {
  constructor(step, heightCm) {
    this.step = step;
    this.heightCm = heightCm;
    this.samples = {}; // id -> [cm]
    this.frames = 0;
    this.touched = new Set();
    this.lines = null; // measurement lines from one representative frame (mask px)
    this.scalePx = []; // cm per px per frame
  }

  add(result) {
    if (!result.heightPx || result.heightPx < 50) return false;
    const cmPerPx = this.heightCm / result.heightPx;
    this.scalePx.push(cmPerPx);
    for (const [id, r] of Object.entries(result.widths)) {
      (this.samples[id] ??= []).push(r.width * cmPerPx);
      if (r.touched) this.touched.add(id);
    }
    this.frames++;
    this.lines = result.widths;
    return true;
  }

  /** {id: {width, spread}} in cm, using parts seen in at least half the frames. */
  widths() {
    const out = {};
    for (const [id, xs] of Object.entries(this.samples)) {
      if (xs.length < Math.max(3, this.frames / 2)) continue;
      const pxErr = median(this.scalePx); // ~1 px total: sub-pixel edges, averaged over frames
      out[id] = { width: median(xs), spread: (quantile(xs, 0.75) - quantile(xs, 0.25)) / 2 + pxErr };
    }
    return out;
  }
}

const ellipse = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

/**
 * Combines captured steps into final results.
 * @returns [{id, name, kind, value (cm), plusMinus (cm), note}]
 */
export function combine({ front, flex = null, side = null }) {
  const f = front ? front.widths() : {};
  const fl = flex ? flex.widths() : {};
  const sd = side ? side.widths() : {};
  const out = [];
  for (const [id, m] of Object.entries(MEASURES)) {
    const src = m.kind === 'flex' ? fl[id] : f[id];
    if (!src) continue;
    let value;
    let plusMinus;
    let note = '';
    if (m.kind === 'width') {
      value = src.width;
      plusMinus = src.spread;
    } else if (m.kind === 'limb') {
      value = Math.PI * src.width;
      plusMinus = Math.PI * src.spread;
    } else if (m.kind === 'flex') {
      value = ellipse(src.width / 2, (0.85 * src.width) / 2);
      plusMinus = Math.PI * src.spread;
    } else {
      const depth = sd[id]?.width;
      const d = depth ?? src.width * m.ratio;
      value = 1.08 * ellipse(src.width / 2, d / 2);
      plusMinus = 1.7 * src.spread + (depth ? 1.7 * sd[id].spread : 0.04 * value);
      note = depth ? 'front + side' : 'depth estimated — add a side capture';
    }
    if (front?.touched.has(id)) note = m.kind === 'limb' ? 'legs touching — stand with feet apart' : 'arms close to your body — hold them out a little more';
    out.push({ id, name: m.name, kind: m.kind, value, plusMinus, note });
  }
  return out;
}
