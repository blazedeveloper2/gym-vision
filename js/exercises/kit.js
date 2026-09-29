import { P, vis, clamp, angleAt } from '../geometry.js';

/**
 * Measuring kit shared by the exercise families: one frame in pixels, 2D
 * vector helpers, and the body-relative directions most checks need (which
 * way the chest faces, where the floor is).
 */

export const LEFT = {
  key: 'L', sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, pinky: P.leftPinky, index: P.leftIndex, thumb: P.leftThumb,
  hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle, heel: P.leftHeel, toe: P.leftFoot, ear: P.leftEar,
};
export const RIGHT = {
  key: 'R', sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, pinky: P.rightPinky, index: P.rightIndex, thumb: P.rightThumb,
  hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle, heel: P.rightHeel, toe: P.rightFoot, ear: P.rightEar,
};
export const LIMBS = { left: LEFT, right: RIGHT };
export const other = (S) => (S === LEFT ? RIGHT : LEFT);

export const DEG = 180 / Math.PI;
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const len = (v) => Math.hypot(v.x, v.y);
export const unit = (v) => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const perp = (v) => ({ x: -v.y, y: v.x });
export const midPt = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp01 = (v, a, b) => (v - a) / (b - a);

/** Direction of v on screen: 0 = straight up, 90 = sideways, 180 = straight down. */
export const fromUp = (v) => Math.acos(clamp(-v.y / (len(v) || 1), -1, 1)) * DEG;
/** How far the line along v is tilted from horizontal: 0..90. */
export const tiltOf = (v) => Math.atan2(Math.abs(v.y), Math.abs(v.x)) * DEG;
/** Angle of v above the horizontal, -90 (down) .. 90 (up), whichever way it points sideways. */
export const elevation = (v) => Math.atan2(-v.y, Math.abs(v.x)) * DEG;
/** Unit normal of `axis` on the upper side of the screen (for a vertical axis, either). */
export const upNormal = (axis) => {
  const n = unit(perp(axis));
  return n.y <= 0 ? n : { x: -n.x, y: -n.y };
};
/** Signed angle (deg) that turns a onto b; positive = clockwise on screen. */
export const turn = (a, b) => Math.atan2(cross(a, b), dot(a, b)) * DEG;

/** One frame in pixel coordinates, with cached points. */
export class Frame {
  constructor(frame) {
    this.lm = frame.lm;
    this.world = frame.world || null;
    this.w = frame.w;
    this.h = frame.h;
    this.t = frame.t;
    this.cache = [];
  }
  v(i) {
    return vis(this.lm[i]);
  }
  seen(ids, min = 0.5) {
    return ids.every((i) => vis(this.lm[i]) >= min);
  }
  p(i) {
    let q = this.cache[i];
    if (!q) {
      const l = this.lm[i];
      q = this.cache[i] = { x: l.x * this.w, y: l.y * this.h };
    }
    return q;
  }
  /** 2D angle at b (as the camera sees it). */
  ang(a, b, c) {
    return angleAt(this.p(a), this.p(b), this.p(c));
  }
  /** 3D angle at b from the world landmarks, when there are any. */
  ang3(a, b, c) {
    return this.world ? angleAt(this.world[a], this.world[b], this.world[c]) : this.ang(a, b, c);
  }
  d(a, b) {
    return len(sub(this.p(a), this.p(b)));
  }
  mid(a, b) {
    return midPt(this.p(a), this.p(b));
  }
  /** Normalized landmark or midpoint for overlays. */
  n(a, b = null) {
    const p = b == null ? this.lm[a] : { x: (this.lm[a].x + this.lm[b].x) / 2, y: (this.lm[a].y + this.lm[b].y) / 2 };
    return { x: p.x, y: p.y };
  }
}

/** Picks the body side nearer the camera from the visibility of the given joints. */
export function nearSide(picker, f, keys) {
  const score = (S) => keys.reduce((s, k) => s + f.v(S[k]), 0);
  return LIMBS[picker.update(score(LEFT), score(RIGHT))];
}

/**
 * True when the side being read has just switched (near leg ↔ far leg).
 * References learned on one side's landmarks (a resting height, a floor)
 * mean nothing on the other's, so callers re-learn them.
 */
export function sideSwitched(an, S) {
  const changed = an._side != null && an._side !== S;
  an._side = S;
  return changed;
}

/** Small movements need a big enough picture: is this segment at least `min` pixels long? */
export const bigEnough = (f, a, b, min) => f.d(a, b) >= min;

/**
 * Which side of the torso line the chest is on, as a unit normal. Read from
 * the face (the nose sits in front of the ear), the knees (a bent knee always
 * points to the front of the body — this still works with the head hanging
 * back off a bench) and the feet (toes point forward). Latched, so a turned
 * head can't flip it for a frame.
 */
export class ChestSide {
  constructor() {
    this.sign = 0;
    this.against = 0;
  }
  reset() {
    this.sign = 0;
    this.against = 0;
  }
  /** @returns unit normal pointing out of the chest, or null while unknown. */
  update(f, S, axis) {
    const n = unit(perp(axis));
    const torso = f.d(S.sh, S.hip) || 1;
    let s = 0;
    if (f.v(P.nose) >= 0.5 && f.v(S.ear) >= 0.3) s += dot(sub(f.p(P.nose), f.p(S.ear)), n) / torso;
    if (f.v(S.toe) >= 0.5 && f.v(S.heel) >= 0.5) s += (0.5 * dot(sub(f.p(S.toe), f.p(S.heel)), n)) / torso;
    if (f.seen([S.hip, S.knee, S.ank], 0.5) && f.ang(S.hip, S.knee, S.ank) < 150) {
      // The knee sticks out in front of the hip–ankle line.
      s += (1.5 * dot(sub(f.p(S.knee), midPt(f.p(S.hip), f.p(S.ank))), n)) / torso;
    }
    const want = s > 0.03 ? 1 : s < -0.03 ? -1 : 0;
    if (!this.sign) this.sign = want;
    else if (want && want !== this.sign) {
      if (++this.against >= 4) {
        this.sign = want;
        this.against = 0;
      }
    } else this.against = 0;
    return this.sign ? { x: n.x * this.sign, y: n.y * this.sign } : null;
  }
}

/** A value remembered at rest (running mean), for "compared with how you started" checks. */
export class Baseline {
  constructor(alpha = 0.1) {
    this.alpha = alpha;
    this.value = null;
  }
  learn(v) {
    if (!Number.isFinite(v)) return this.value;
    this.value = this.value == null ? v : this.value + this.alpha * (v - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
  }
}

/** Standard messages. */
export const MSG = {
  side: 'Turn side-on to the camera so I can see your whole body',
  sideSay: 'Turn side on to the camera',
  front: 'Face the camera so I can see both arms',
  frontSay: 'Face the camera',
  back: 'Move back so your whole body is in the frame',
  backSay: 'Move back',
};

export const partial = (message = MSG.side, say = null) => ({ status: 'partial', message, say: say ?? message });
export const setup = (message, say = null) => ({ status: 'setup', message, say: say ?? message });

/** Overlay helpers (points are landmark ids or normalized {x, y}). */
export const seg = (a, b, tone = 'go', w) => ({ type: 'seg', a, b, tone, ...(w ? { w } : {}) });
export const dash = (a, b, tone = 'neutral', w) => ({ type: 'dash', a, b, tone, ...(w ? { w } : {}) });
export const arc = (a, b, c, label, tone = 'go') => ({ type: 'arc', a, b, c, tone, label });
export const dots = (ids, tone = 'go') => ({ type: 'dots', ids, tone });
export const label = (at, text, tone = 'neutral', size = 12) => ({ type: 'label', at, text, tone, size });
/** Normalized point from a pixel point. */
export const norm = (f, p) => ({ x: p.x / f.w, y: p.y / f.h });

export const r0 = (v) => Math.round(v);
export const deg = (v) => `${Math.round(v)}°`;
