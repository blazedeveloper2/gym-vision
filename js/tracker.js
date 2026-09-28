import { LimbEngine } from './limbs.js';

/**
 * Chooses and steadies the pose for each frame.
 *
 * MediaPipe Pose finds people by their face. With a face or a shoulder in
 * view it's the best tracker; without one it finds no one, or invents a
 * person that isn't there. Close up (a leg, the feet, an arm) MoveNet finds
 * the joints instead, and the selfie segmenter says where the body actually
 * is, so:
 * - no body in the mask → nothing is shown (no parts on a mattress);
 * - a joint that isn't on the body is dropped;
 * - joints are smoothed and must be seen a couple of frames in a row before
 *   they count, so parts don't flicker in and out.
 * Switching between the two trackers also needs a few frames of agreement.
 */

const SWITCH_FRAMES = 3;
const MIN_BODY = 0.01; // share of the frame the body must cover

/** Is the head or a shoulder clearly in the frame (what the pose model locks on to)? */
export const anchored = (lm) => [0, 7, 8, 11, 12].some((i) => lm[i].visibility >= 0.5 && lm[i].x > 0 && lm[i].x < 1 && lm[i].y > 0 && lm[i].y < 1);

/** Float mask readable on the CPU: {data, width, height}, or an MPMask. */
export function maskData(mask) {
  if (!mask) return null;
  if (mask.data) return mask;
  return { data: mask.getAsFloat32Array(), width: mask.width, height: mask.height };
}

/** Largest mask value in a small square around (x, y) (0–1 frame coordinates). */
export function maskNear(m, x, y, r = 2) {
  const cx = Math.floor(x * m.width), cy = Math.floor(y * m.height);
  let best = 0;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= m.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= m.width) continue;
      best = Math.max(best, m.data[yy * m.width + xx]);
    }
  }
  return best;
}

/** Mean confidence over the pixels the mask calls body (a real person is usually near 1). */
export function maskConfidence(m) {
  let n = 0, sum = 0;
  for (let i = 0; i < m.data.length; i += 3) if (m.data[i] > 0.5) { n++; sum += m.data[i]; }
  return n ? sum / n : 0;
}

export function maskArea(m) {
  let n = 0;
  for (let i = 0; i < m.data.length; i += 3) if (m.data[i] > 0.5) n++;
  return (3 * n) / m.data.length;
}

// Bones used to check that joints hang together (pose indices).
const BONES = [
  [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [11, 12], [23, 24], [11, 23], [12, 24], // torso
  [0, 11], [0, 12],
];

/**
 * Keeps only joints that are on the body and connected to another kept
 * joint; returns null when too little is left to say anything.
 */
export function validateCloseUp(lm, mask) {
  if (!mask || maskArea(mask) < MIN_BODY || maskConfidence(mask) < 0.7) return null;
  const on = lm.map((p) => p.visibility >= 0.35 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && maskNear(mask, p.x, p.y) >= 0.5);
  // Close up, MoveNet often reports one joint twice, as a knee and an elbow
  // (or ankle and wrist) at the same spot. Keep the limb with more support.
  const ARM = [11, 12, 13, 14, 15, 16], LEG = [23, 24, 25, 26, 27, 28];
  const support = (ids) => ids.reduce((a, i) => a + (on[i] ? lm[i].visibility : 0), 0);
  const dup = [];
  for (const a of ARM) for (const l of LEG) if (on[a] && on[l] && Math.hypot(lm[a].x - lm[l].x, lm[a].y - lm[l].y) < 0.05) dup.push([a, l]);
  if (dup.length) {
    const legs = support(LEG) >= support(ARM);
    for (const [a, l] of dup) on[legs ? a : l] = false;
  }
  // Legs: thigh and shin are about the same length; drop the weaker end of a chain that isn't.
  for (const [hip, kn, an] of [[23, 25, 27], [24, 26, 28]]) {
    if (!(on[hip] && on[kn] && on[an])) continue;
    const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    const r = d(hip, kn) / Math.max(d(kn, an), 1e-6);
    if (r < 0.3 || r > 3.3) on[lm[hip].visibility < lm[an].visibility ? hip : an] = false;
  }
  // The head and shoulders sit far from the knees; a "shoulder" on a leg is a guess.
  for (const [sh, hip, kn] of [[11, 23, 25], [12, 24, 26]]) {
    if (!(on[sh] && on[hip] && on[kn])) continue;
    const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    if (d(sh, hip) < 0.5 * d(hip, kn) || d(sh, kn) < d(hip, kn)) on[sh] = false;
  }
  const linked = on.map((v, i) => v && BONES.some(([a, b]) => (a === i && on[b]) || (b === i && on[a])));
  if (!linked.some(Boolean)) return null;
  return lm.map((p, i) => (linked[i] ? p : { ...p, visibility: Math.min(p.visibility, 0.1) }));
}

/** One Euro filter for one value (smooth when still, responsive when moving). */
class OneEuro {
  constructor(minCutoff = 1.2, beta = 6, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  next(v, t) {
    if (this.x == null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const a = OneEuro.alpha(this.dCutoff, dt);
    this.dx += a * ((v - this.x) / dt - this.dx);
    const b = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x += b * (v - this.x);
    return this.x;
  }
}

/**
 * Smooths landmark positions and gives visibility hysteresis: a joint must
 * be seen 2 frames running to appear and missed 4 frames running to go.
 */
export class LandmarkSmoother {
  constructor() {
    this.reset();
  }
  reset() {
    this.fx = [];
    this.fy = [];
    this.state = [];
  }
  next(lm, t) {
    return lm.map((p, i) => {
      const st = (this.state[i] ??= { on: false, hits: 0, misses: 0, last: null });
      const seen = p.visibility >= 0.5;
      st.hits = seen ? st.hits + 1 : 0;
      st.misses = seen ? 0 : st.misses + 1;
      if (!st.on && st.hits >= 2) st.on = true;
      if (st.on && st.misses >= 4) st.on = false;
      if (!st.on) {
        this.fx[i] = this.fy[i] = null;
        return { ...p, visibility: Math.min(p.visibility, 0.3) };
      }
      if (!seen && st.last) return { ...st.last, visibility: 0.6 }; // briefly held
      this.fx[i] ??= new OneEuro();
      this.fy[i] ??= new OneEuro();
      const q = { x: this.fx[i].next(p.x, t), y: this.fy[i].next(p.y, t), z: p.z || 0, visibility: Math.max(p.visibility, 0.6) };
      st.last = q;
      return q;
    });
  }
}

export class Tracker {
  /**
   * @param engine     PoseEngine
   * @param segmenter  BodySegmenter giving CPU masks (close-ups)
   */
  constructor({ engine, segmenter, checks = true }) {
    this.engine = engine;
    this.checks = checks; // off only to measure what the checks buy (tests)
    this.segmenter = segmenter;
    this.limbs = new LimbEngine();
    this.failed = false;
    this.smoother = new LandmarkSmoother();
    this.poseSmoother = new LandmarkSmoother();
    this.source = 'pose';
    this.pending = null;
    this.pendingCount = 0;
    this.trusted = true;
    this.checkAt = 0;
    this.frames = 0;
  }

  get closeUpReady() {
    return !this.failed && this.limbs.ready && this.segmenter.ready;
  }

  async loadCloseUp(delegate) {
    if (this.failed || this.closeUpReady) return;
    try {
      await Promise.all([this.limbs.load(), this.segmenter.load(delegate)]);
    } catch (err) {
      // Everything else still works; close-ups just need the face in view.
      console.warn('close-up tracking unavailable', err);
      this.failed = true;
    }
  }

  /** Only switch trackers after a few frames of wanting to. */
  choose(want, currentHasPose) {
    if (!this.checks) return (this.source = want);
    if (want === this.source) {
      this.pending = null;
      return this.source;
    }
    if (this.pending !== want) {
      this.pending = want;
      this.pendingCount = 0;
    }
    if (++this.pendingCount >= SWITCH_FRAMES || !currentHasPose) {
      this.source = want;
      this.pending = null;
      this.smoother.reset();
      this.poseSmoother.reset();
      this.limbs.reset();
    }
    return this.source;
  }

  /** Given only a leg, the pose model can invent a whole person; now and then check it. */
  trustPose(lm, source) {
    if (!this.checks) return this.limbs.agrees(lm, source);
    if (this.frames >= this.checkAt) {
      let ok = this.limbs.agrees(lm, source);
      if (ok) {
        // Its head and shoulders must be on a body, too.
        const m = this.segmenter.segmentData(source, this.engine.nextTimestamp());
        if (m) ok = maskArea(m) >= MIN_BODY && [0, 11, 12, 23, 24].filter((i) => lm[i].visibility >= 0.5 && lm[i].x > 0 && lm[i].x < 1 && lm[i].y > 0 && lm[i].y < 1).every((i) => maskNear(m, lm[i].x, lm[i].y, 3) >= 0.5);
      }
      this.trusted = ok;
      this.checkAt = this.frames + (ok ? 15 : 5);
    }
    return this.trusted;
  }

  /**
   * Tracks one frame. `cb(frame, mask, ts)` runs once, synchronously, while
   * the mask is valid. frame = {lm, world, source: 'pose' | 'closeup'}.
   * `closeUp`: allow the close-up tracker (Body Scan).
   * Returns false if the pose engine wasn't ready.
   */
  track(source, { closeUp = false } = {}, cb) {
    this.frames++;
    const useCloseUp = closeUp && this.closeUpReady;
    let pose = null;
    let done = false;
    const ran = this.engine.detect(source, (res, ts) => {
      const lm = res.landmarks?.[0] || null;
      pose = { lm, world: res.worldLandmarks?.[0] || null, ts };
      if (!useCloseUp) {
        done = true;
        cb({ lm, world: pose.world, source: 'pose' }, res.segmentationMasks?.[0] || null, ts);
        return;
      }
      const want = lm && anchored(lm) && this.trustPose(lm, source) ? 'pose' : 'closeup';
      if (this.choose(want, !!lm) === 'pose') {
        done = true;
        // Body Scan labels every part, so steady the joints (exercises keep them raw).
        const steady = lm && this.checks ? this.poseSmoother.next(lm, ts) : lm;
        cb({ lm: steady, world: pose.world, source: 'pose' }, res.segmentationMasks?.[0] || null, ts);
      }
    });
    if (!ran || done) return ran;
    this.closeUp(source, pose, cb);
    return true;
  }

  closeUp(source, pose, cb) {
    let lm = null;
    const ts = this.engine.nextTimestamp();
    const mask = this.segmenter.segmentData(source, ts);
    try {
      lm = this.limbs.detect(source);
    } catch (err) {
      console.warn('close-up tracking failed', err);
      this.failed = true;
    }
    if (!this.checks) {
      cb({ lm, world: null, source: 'closeup' }, mask, pose.ts);
      return;
    }
    this.stats = { raw: lm, q: this.limbs.lastQ, area: mask ? maskArea(mask) : 0, conf: mask ? maskConfidence(mask) : 0 };
    // MoveNet always answers; only trust it when it's reasonably sure it sees a body.
    lm = lm && (this.limbs.lastQ ?? 0) >= 0.3 ? validateCloseUp(lm, mask) : null;
    lm = lm ? this.smoother.next(lm, pose.ts) : (this.smoother.next(emptyPose(), pose.ts), null);
    if (lm && !lm.some((p) => p.visibility >= 0.5)) lm = null;
    const body = mask && maskArea(mask) >= MIN_BODY ? mask : null;
    cb({ lm, world: null, source: 'closeup' }, body, pose.ts);
  }
}

const emptyPose = () => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
