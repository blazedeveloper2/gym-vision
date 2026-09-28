import { P, vis } from '../geometry.js';

/**
 * Body-part map.
 *
 * Two levels, both made of capsules (a line segment with a radius) built from
 * pose landmarks each frame:
 * - ~20 coarse regions (head, chest, left thigh, ...). A body pixel belongs to
 *   the region whose capsule surface is nearest.
 * - inside each region, detailed anatomical parts (left VMO, right rhomboid,
 *   sternum, ...), assigned the same way but only among that region's parts.
 *
 * The GL stage colours every body pixel with this rule and `identify()` names
 * a point with exactly the same rule, so the colour under your finger always
 * matches the name you get — and every pixel inside the body has a name.
 *
 * Which parts exist depends on the view (front, back or side-on): the camera
 * only sees one side of you. With `sex` set, the chest, throat and genital
 * area use sex-specific anatomical names; otherwise neutral ones.
 *
 * Close up (hips or legs out of frame), the torso is extrapolated from the
 * shoulders or the face so the parts in view still work.
 *
 * All coordinates are frame pixels of the unmirrored image. Sizes scale with
 * torso length T (mid-shoulders to mid-hips).
 */

export const MAX_COARSE = 40; // GL uniform arrays
export const MAX_ROWS = 320; // detailed parts + hand-shape capsules (data texture rows)

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Colour per kind of part. Neighbouring parts use contrasting kinds. */
export const KIND_COLORS = {
  scalp: '#f9a8d4', forehead: '#f472b6', brow: '#a78bfa', eye: '#38bdf8', temple: '#c084fc', nose: '#fb923c',
  cheek: '#fda4af', mouth: '#ef4444', jaw: '#e879f9', ear: '#fbbf24',
  throat: '#fb7185', larynx: '#f43f5e', neckSide: '#f97316', neckBack: '#fb7185',
  trap: '#8b5cf6', clavicle: '#e2e8f0', upperChest: '#f87171', pec: '#ef4444', breast: '#f87171', nipple: '#be123c',
  sternum: '#fecaca', lowerChest: '#dc2626', serratus: '#fb923c', armpit: '#fde68a',
  abs1: '#f97316', abs2: '#fdba74', abs3: '#ea580c', navel: '#78350f', oblique: '#facc15', lowerBelly: '#fcd34d',
  hipBone: '#e2e8f0', vline: '#a3e635', hipFlexor: '#84cc16', pubic: '#d946ef', genital: '#c026d3', perineum: '#a21caf', anus: '#86198f',
  midTrap: '#6366f1', rhomboid: '#22d3ee', rotator: '#2dd4bf', teres: '#14b8a6', lat: '#3b82f6', spine: '#f1f5f9',
  lowerBack: '#0ea5e9', ql: '#0284c7', glute: '#eab308', gluteMed: '#f59e0b', cleft: '#713f12', tailbone: '#fef3c7', gluteFold: '#a16207',
  frontDelt: '#a855f7', sideDelt: '#d8b4fe', rearDelt: '#7c3aed', joint: '#ffffff',
  biceps: '#3b82f6', brachialis: '#93c5fd', triceps: '#2563eb', tricepsLat: '#60a5fa',
  brachioradialis: '#67e8f9', forearm: '#06b6d4', flexors: '#06b6d4', extensors: '#0891b2',
  hand: '#2dd4bf', palm: '#5eead4', knuckles: '#0f766e', thumbPad: '#99f6e4', finger1: '#34d399', finger2: '#6ee7b7', finger3: '#10b981',
  quad: '#22c55e', vastusLat: '#4ade80', vmo: '#15803d', adductor: '#a3e635', tfl: '#bef264', itBand: '#d9f99d',
  hamstring: '#16a34a', hamstringOuter: '#4ade80',
  shin: '#84cc16', peroneal: '#bef264', calf: '#65a30d', calfOuter: '#a3e635', soleus: '#4d7c0f', achilles: '#ecfccb',
  heel: '#fde047', midfoot: '#facc15', toes: '#fef08a', head: '#f472b6',
};

const SIDES = [
  { key: 'L', word: 'Left', low: 'left', sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, idx: P.leftIndex, pk: P.leftPinky, hip: P.leftHip, kn: P.leftKnee, an: P.leftAnkle, heel: P.leftHeel, toe: P.leftFoot, eye: 2, ear: P.leftEar, mouth: 9 },
  { key: 'R', word: 'Right', low: 'right', sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, idx: P.rightIndex, pk: P.rightPinky, hip: P.rightHip, kn: P.rightKnee, an: P.rightAnkle, heel: P.rightHeel, toe: P.rightFoot, eye: 5, ear: P.rightEar, mouth: 10 },
];

const FINGERS = [
  { name: 'thumb', joints: [1, 2, 3, 4], segs: ['base of the thumb (metacarpal)', 'middle of the thumb (proximal phalanx)', 'tip of the thumb (distal phalanx)'] },
  { name: 'index finger', joints: [5, 6, 7, 8] },
  { name: 'middle finger', joints: [9, 10, 11, 12] },
  { name: 'ring finger', joints: [13, 14, 15, 16] },
  { name: 'pinky', joints: [17, 18, 19, 20] },
];
const fingerSeg = (f, k) => f.segs?.[k] ?? `${['base', 'middle', 'tip'][k]} of the ${f.name} (${['proximal', 'middle', 'distal'][k]} phalanx)`;

const V = (x, y) => ({ x, y });
const add = (a, b, s = 1) => V(a.x + b.x * s, a.y + b.y * s);
const lerp2 = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a, b) => {
  const l = dist(a, b) || 1;
  return V((b.x - a.x) / l, (b.y - a.y) / l);
};
const perp = (u) => V(u.y, -u.x); // (0,1) → (1,0): down → image right

/** Signed distance from (x, y) to a capsule's surface (negative inside). */
function capsuleSd(c, x, y) {
  const bx = c.b.x - c.a.x;
  const by = c.b.y - c.a.y;
  const t = Math.max(0, Math.min(1, ((x - c.a.x) * bx + (y - c.a.y) * by) / Math.max(bx * bx + by * by, 1e-6)));
  return Math.hypot(x - c.a.x - bx * t, y - c.a.y - by * t) - c.r;
}

/**
 * Which way the person faces: 'front', 'back' or 'side' — plus, side-on,
 * which image direction is their front (+1 = image right). Works without
 * the hips (close up) by falling back on the face.
 */
export function facingOf(lm, w, h) {
  const ls = lm[P.leftShoulder], rs = lm[P.rightShoulder], lh = lm[P.leftHip], rh = lm[P.rightHip];
  const shouldersSeen = vis(ls) >= 0.5 && vis(rs) >= 0.5;
  const torsoSeen = shouldersSeen && vis(lh) >= 0.5 && vis(rh) >= 0.5;
  // "Across" the body (image right for someone upright), so upside-down and
  // sideways views are judged the same as upright ones.
  const across = torsoSeen ? perp(unit(V((ls.x + rs.x) * w, (ls.y + rs.y) * h), V((lh.x + rh.x) * w, (lh.y + rh.y) * h))) : V(1, 0);
  const acrossOf = (p, q) => (p.x - q.x) * w * across.x + (p.y - q.y) * h * across.y;
  let frontSign = 0;
  const earMid = vis(lm[P.leftEar]) > vis(lm[P.rightEar]) ? lm[P.leftEar] : lm[P.rightEar];
  if (vis(lm[P.nose]) > 0.3 && vis(earMid) > 0.3) frontSign = Math.sign(acrossOf(lm[P.nose], earMid)) || 1;
  if (torsoSeen) {
    const torso = Math.hypot(((ls.x + rs.x) - (lh.x + rh.x)) * w / 2, ((ls.y + rs.y) - (lh.y + rh.y)) * h / 2) || 1;
    const spread = acrossOf(ls, rs) / torso;
    if (Math.abs(spread) < 0.4) return { facing: 'side', frontSign };
    // Facing the camera, the person's left shoulder appears on the image right.
    return { facing: spread > 0 ? 'front' : 'back', frontSign };
  }
  // Close up: judge from the face.
  const face = vis(lm[P.nose]) >= 0.5 && vis(lm[2]) >= 0.5 && vis(lm[5]) >= 0.5;
  if (face) {
    if (Math.min(vis(lm[P.leftEar]), vis(lm[P.rightEar])) < 0.25) return { facing: 'side', frontSign };
    return { facing: 'front', frontSign };
  }
  if (shouldersSeen) return { facing: vis(lm[P.nose]) < 0.3 ? 'back' : ls.x > rs.x ? 'front' : 'back', frontSign };
  const legs = vis(ls) < 0.5 && vis(rs) < 0.5 ? legFrame(lm, w, h) : null;
  if (legs) return { facing: legs.facing, frontSign: legs.frontSign || frontSign };
  return { facing: 'side', frontSign };
}

/**
 * Body frame from the legs alone (close up on the legs, no shoulders or face
 * in view). Works at any camera angle — even looking down at your own legs —
 * because it uses the legs' own down direction rather than the image's.
 * @returns {{u, T, Hc, facing, frontSign}} or null
 */
export function legFrame(lm, w, h) {
  const px = (i) => V(lm[i].x * w, lm[i].y * h);
  const ok = (i) => vis(lm[i]) >= 0.5;
  // Down the body: hip → knee, else knee → ankle, averaged over both legs.
  let dx = 0, dy = 0, T = 0;
  for (const s of SIDES) {
    const seg = ok(s.hip) && ok(s.kn) ? [s.hip, s.kn, 1.18] : ok(s.kn) && ok(s.an) ? [s.kn, s.an, 1.17] : null;
    if (!seg) continue;
    const a = px(seg[0]), b = px(seg[1]);
    const len = dist(a, b);
    if (len < 4) continue;
    dx += (b.x - a.x) / len;
    dy += (b.y - a.y) / len;
    T = Math.max(T, seg[2] * len); // thigh ≈ shin ≈ 0.85 of the torso
  }
  const dl = Math.hypot(dx, dy);
  if (!(T > 10) || dl < 0.3) return null;
  const u = V(dx / dl, dy / dl);
  const v = perp(u);

  // Front or back: facing the camera, the person's left leg is on the image
  // right of "down"; side-on the legs overlap (or the far one is hidden).
  let facing = 'side';
  const pair = [[P.leftHip, P.rightHip], [P.leftKnee, P.rightKnee], [P.leftAnkle, P.rightAnkle]].find(([l, r]) => ok(l) && ok(r));
  if (pair) {
    const lat = (px(pair[0]).x - px(pair[1]).x) * v.x + (px(pair[0]).y - px(pair[1]).y) * v.y;
    facing = Math.abs(lat) < 0.12 * T ? 'side' : lat > 0 ? 'front' : 'back';
  }

  // Side-on, which way is the front: the toes, else the way the knee bends.
  let frontSign = 0;
  for (const s of SIDES) {
    if (frontSign) break;
    if (vis(lm[s.heel]) >= 0.5 && vis(lm[s.toe]) >= 0.5) {
      const d = (px(s.toe).x - px(s.heel).x) * v.x + (px(s.toe).y - px(s.heel).y) * v.y;
      if (Math.abs(d) > 0.03 * T) frontSign = Math.sign(d);
    } else if (ok(s.hip) && ok(s.kn) && ok(s.an)) {
      const k = px(s.kn), line = lerp2(px(s.hip), px(s.an), 0.5);
      const bend = (k.x - line.x) * v.x + (k.y - line.y) * v.y;
      if (Math.abs(bend) > 0.05 * T) frontSign = Math.sign(bend);
    }
  }

  // Middle of the hips (extrapolated up the thighs if they're out of frame).
  const hips = SIDES.filter((s) => ok(s.hip));
  let Hc;
  if (hips.length === 2) Hc = lerp2(px(P.leftHip), px(P.rightHip), 0.5);
  else {
    const s = hips[0] || SIDES.find((x) => ok(x.kn)) || SIDES.find((x) => ok(x.an));
    const base = hips[0] ? px(s.hip) : ok(s.kn) ? add(px(s.kn), u, -0.85 * T) : add(px(s.an), u, -1.7 * T);
    // One leg: the midline is toward the person's other side.
    const toMid = facing === 'side' ? 0 : (s.key === 'L' ? -1 : 1) * (facing === 'back' ? -1 : 1) * 0.18 * T;
    Hc = add(base, v, toMid);
  }
  return { u, T, Hc, facing, frontSign };
}

// ------------------------------------------------------------ names

const genitalNames = (sex) =>
  sex === 'male'
    ? { mons: ['Pubic mound', 'mons pubis — above the penis'], main: [['Penis', 'penis (shaft and glans)']], low: ['Scrotum', 'scrotum and testicles'] }
    : sex === 'female'
      ? { mons: ['Mons pubis', 'pubic mound — above the vulva'], main: [['Vulva', 'vulva — labia majora and minora, clitoris at the top']], low: null }
      : { mons: ['Pubic mound', 'mons pubis'], main: [['Genitals', 'external genitals (set your sex in Settings for exact names)']], low: null };

/**
 * Builds the body-part map for one frame.
 * @param hands  HandLandmarker-style result ({landmarks: [...21 points]}) or null
 * @param opts.sex  '' | 'male' | 'female'
 */
export function computeParts(lm, w, h, hands = null, out = null, opts = {}) {
  const o = out || {
    coarseSegs: new Float32Array(MAX_COARSE * 4),
    coarseRads: new Float32Array(MAX_COARSE),
    coarseRange: new Int32Array(MAX_COARSE * 2),
    rowData: new Float32Array(MAX_ROWS * 12),
  };
  const sex = opts.sex || '';
  const coarse = [];
  const fine = [];
  const px = (i) => V(lm[i].x * w, lm[i].y * h);
  const seen = (i, k = 0.5) => vis(lm[i]) >= k;
  Object.assign(o, { lm, w, h, px, sex, coarse, fine, hands: [], shapes: [] });
  Object.assign(o, facingOf(lm, w, h));
  const facing = o.facing;

  // ---- torso frame (extrapolated when close up)
  const ls = px(P.leftShoulder), rs = px(P.rightShoulder), lhp = px(P.leftHip), rhp = px(P.rightHip);
  const shBoth = seen(P.leftShoulder) && seen(P.rightShoulder);
  const shOne = shBoth || seen(P.leftShoulder) || seen(P.rightShoulder);
  const hipBoth = seen(P.leftHip) && seen(P.rightHip);
  const eyesSeen = seen(2) && seen(5);
  const E = eyesSeen ? Math.max(dist(px(2), px(5)), 3) : 0; // eye distance
  let S = null;
  if (shBoth) S = lerp2(ls, rs, 0.5);
  else if (shOne) S = seen(P.leftShoulder) ? ls : rs;
  const headC = seen(P.leftEar) && seen(P.rightEar) ? lerp2(px(P.leftEar), px(P.rightEar), 0.5) : seen(P.nose) ? px(P.nose) : eyesSeen ? lerp2(px(2), px(5), 0.5) : null;

  // Torso length estimates: shoulder width (facing), head-to-shoulders, eyes.
  const est = [];
  if (shBoth && facing !== 'side') est.push(1.3 * dist(ls, rs));
  if (S && headC) est.push(2.1 * dist(S, headC));
  if (E && facing === 'front') est.push(7.2 * E);
  if (!est.length && S) {
    // Just an arm in view: arm segments give the scale.
    for (const s of SIDES) {
      if (seen(s.sh) && seen(s.el)) est.push(1.55 * dist(px(s.sh), px(s.el)));
      if (seen(s.el) && seen(s.wr)) est.push(1.97 * dist(px(s.el), px(s.wr)));
    }
  }
  const Test = est.length ? Math.max(...est) : 0;

  let Hc = null;
  let T = 0;
  let mode = 'none';
  const hipAny = hipBoth || seen(P.leftHip) || seen(P.rightHip);
  if (S && hipAny) {
    Hc = hipBoth ? lerp2(lhp, rhp, 0.5) : seen(P.leftHip) ? lhp : rhp;
    T = dist(S, Hc);
    mode = T > 10 ? 'full' : 'none';
  }
  if (mode === 'none' && S) {
    // Hips out of frame: trust the model's guess if it's plausible, else extrapolate.
    const guess = lerp2(lhp, rhp, 0.5);
    const gT = dist(S, guess);
    const down = headC ? unit(headC, S) : V(0, 1);
    if (Test && vis(lm[P.leftHip]) + vis(lm[P.rightHip]) > 0.05 && gT > 0.7 * Test && gT < 1.4 * Test && (guess.x - S.x) * down.x + (guess.y - S.y) * down.y > 0) {
      Hc = guess;
      T = gT;
    } else if (Test) {
      // Straight down the body: perpendicular to the shoulder line, away from the head.
      let d = down;
      if (shBoth) {
        const n = perp(unit(rs, ls));
        d = n.x * down.x + n.y * down.y >= 0 ? n : V(-n.x, -n.y);
      }
      Hc = add(S, d, Test);
      T = Test;
    }
    mode = T > 10 ? 'upper' : 'none';
  }
  if (mode === 'none' && headC && E) {
    mode = 'head';
    T = 7.2 * E;
    S = add(headC, V(0, 1), 0.45 * T);
    Hc = add(S, V(0, 1), T);
  }
  if (mode === 'none' && !headC) {
    // Close up on the legs: build the frame from the legs, torso above the hips.
    const lf = legFrame(lm, w, h);
    if (lf) {
      mode = 'legs';
      T = lf.T;
      Hc = lf.Hc;
      S = add(Hc, lf.u, -T);
    }
  }
  Object.assign(o, { S: S || V(0, 0), Hc: Hc || V(0, 0), T, mode, torsoOk: mode === 'full' || mode === 'upper', headC });
  if (mode === 'none') return pack(o);

  const u = unit(S, Hc); // down the torso
  const v = perp(u); // image right
  const up = V(-u.x, -u.y);
  const hw = shBoth && facing !== 'side' ? Math.max(dist(ls, rs) / 2, 0.3 * T) : 0.38 * T;
  const hh = hipBoth && facing !== 'side' ? Math.max(dist(lhp, rhp) / 2, 0.2 * T) : 0.24 * T;
  const tp = (tt, x, k = hw) => add(add(S, u, tt * T), v, x * k);
  // Side view: + toward the person's front.
  const fdir = V(v.x * (o.frontSign || 1), v.y * (o.frontSign || 1));
  const sp = (tt, f) => add(add(S, u, tt * T), fdir, f * 0.22 * T);
  // The person's left is on the image right when facing the camera.
  const sgn = (s) => (s.key === 'L' ? 1 : -1) * (facing === 'back' ? -1 : 1);
  const near = SIDES.reduce((b, s) => (vis(lm[s.sh]) + vis(lm[s.hip]) > vis(lm[b.sh]) + vis(lm[b.hip]) ? s : b));
  const bodyOk = mode === 'full' || mode === 'upper';

  // ---- builders
  let cur = -1;
  const region = (id, label, a, b, r, extra = {}) => {
    if (coarse.length >= MAX_COARSE || !(r > 0)) return false;
    cur = coarse.length;
    coarse.push({ id, label, a, b, r, start: fine.length, end: fine.length, ...extra });
    return true;
  };
  const part = (kind, name, detail, a, b, r) => {
    if (cur < 0 || fine.length >= MAX_ROWS - 60 || !(r > 0)) return;
    fine.push({ kind, name, detail, a, b: b || a, r, coarse: cur });
    coarse[cur].end = fine.length;
  };
  // Symmetric pair on the torso: x is + for the person's left side (flipped from behind).
  const pair = (kind, name, detail, tt0, x0, tt1, x1, r, k = hw) => {
    for (const s of SIDES) {
      const g = sgn(s);
      part(kind, typeof name === 'function' ? name(s) : `${s.word} ${name}`, detail, tp(tt0, x0 * g, k), tp(tt1, x1 * g, k), r * T);
    }
  };
  const mid = (kind, name, detail, tt0, tt1, r) => part(kind, name, detail, tp(tt0, 0), tp(tt1, 0), r * T);
  const sidePart = (kind, name, detail, tt0, f0, tt1, f1, r) => part(kind, name, detail, sp(tt0, f0), sp(tt1, f1), r * T);

  // ---- head & face
  if (headC) {
    const R = 0.24 * T;
    region('head', 'Head', headC, add(headC, up, 0.3 * (dist(S, headC) || T * 0.45)), R);
    const Ef = E || 0.14 * T;
    if (facing === 'back') {
      part('scalp', 'Back of the head', 'occipital scalp', headC, add(headC, up, 0.25 * R), 0.5 * R);
      part('scalp', 'Crown', 'top of the head', add(headC, up, 0.85 * R), add(headC, up, 0.95 * R), 0.4 * R);
      part('neckBack', 'Base of the skull', 'where the neck muscles attach (suboccipitals)', add(add(headC, up, -0.55 * R), v, -0.3 * R), add(add(headC, up, -0.55 * R), v, 0.3 * R), 0.22 * R);
      for (const s of SIDES) if (seen(s.ear, 0.3)) part('ear', `${s.word} ear`, 'ear (outer ear / auricle)', px(s.ear), null, 0.2 * Ef);
    } else if (facing === 'side') {
      const hf = V(fdir.x, fdir.y);
      part('cheek', 'Face', 'cheek and side of the face', add(headC, hf, 0.45 * R), add(add(headC, hf, 0.5 * R), up, 0.2 * R), 0.45 * R);
      part('scalp', 'Back of the head', 'occipital scalp', add(headC, hf, -0.45 * R), add(add(headC, hf, -0.3 * R), up, 0.4 * R), 0.55 * R);
      part('scalp', 'Top of the head', 'scalp', add(headC, up, 0.9 * R), null, 0.4 * R);
      part('jaw', 'Jaw', 'mandible and masseter', add(add(headC, hf, 0.35 * R), up, -0.55 * R), add(add(headC, hf, 0.75 * R), up, -0.6 * R), 0.22 * R);
      part('temple', `${near.word} temple`, 'temple (temporalis)', add(add(headC, hf, 0.2 * R), up, 0.45 * R), null, 0.2 * R);
      for (const s of SIDES) {
        if (seen(s.ear, 0.3)) part('ear', `${s.word} ear`, 'ear (outer ear / auricle)', px(s.ear), null, 0.22 * Ef);
        if (seen(s.eye)) part('eye', `${s.word} eye`, 'eye and eyelid', px(s.eye), null, 0.18 * Ef);
      }
      if (seen(P.nose)) part('nose', 'Nose', 'nose', px(P.nose), null, 0.2 * Ef);
      if (seen(9) || seen(10)) part('mouth', 'Mouth', 'lips', px(seen(9) ? 9 : 10), null, 0.16 * Ef);
    } else {
      const le = eyesSeen ? px(2) : add(headC, v, 0.5 * Ef);
      const re = eyesSeen ? px(5) : add(headC, v, -0.5 * Ef);
      const em = lerp2(le, re, 0.5);
      const hx = eyesSeen ? unit(re, le) : v; // toward the person's left eye
      const hu = V(hx.y, -hx.x); // head up
      const at = (p, x, y) => add(add(p, hx, x * Ef), hu, y * Ef);
      part('scalp', 'Top of the head', 'scalp', at(em, -0.55, 1.35), at(em, 0.55, 1.35), 0.45 * Ef);
      part('forehead', 'Forehead', 'frontalis', at(em, -0.5, 0.75), at(em, 0.5, 0.75), 0.3 * Ef);
      const mouthC = seen(9) && seen(10) ? lerp2(px(9), px(10), 0.5) : at(em, 0, -1.05);
      for (const [s, eye, sg] of [[SIDES[0], le, 1], [SIDES[1], re, -1]]) {
        part('brow', `${s.word} eyebrow`, 'eyebrow (brow ridge)', at(eye, -0.2 * sg, 0.3), at(eye, 0.22 * sg, 0.32), 0.09 * Ef);
        part('eye', `${s.word} eye`, 'eye and eyelids', eye, null, 0.16 * Ef);
        part('temple', `${s.word} temple`, 'temple (temporalis)', at(eye, 0.62 * sg, 0.2), null, 0.2 * Ef);
        part('cheek', `${s.word} cheek`, 'cheek (zygomatic area)', at(eye, 0.12 * sg, -0.62), null, 0.28 * Ef);
        part('jaw', `${s.word} jaw`, 'jawline and masseter', at(mouthC, 0.72 * sg, 0.05), at(mouthC, 0.55 * sg, -0.35), 0.2 * Ef);
        if (seen(s.ear, 0.3)) part('ear', `${s.word} ear`, 'ear (outer ear / auricle)', px(s.ear), null, 0.2 * Ef);
      }
      part('nose', 'Nose', 'nose', at(em, 0, -0.2), seen(P.nose) ? px(P.nose) : at(em, 0, -0.5), 0.17 * Ef);
      part('mouth', 'Mouth', 'lips', seen(9) ? px(9) : at(mouthC, 0.2, 0), seen(10) ? px(10) : at(mouthC, -0.2, 0), 0.14 * Ef);
      part('jaw', 'Chin', 'chin (mentalis)', at(mouthC, -0.3, -0.5), at(mouthC, 0.3, -0.5), 0.24 * Ef);
    }
  }
  // Legs close up: no torso in view, only the hips when they show.
  if (!bodyOk && mode !== 'legs') return pack(o);
  const hipSeen = seen(P.leftHip) || seen(P.rightHip);

  if (bodyOk) {
    // ---- neck
    region('neck', 'Neck', S, add(S, up, 0.45 * T), 0.12 * T);
    if (facing === 'side') {
      sidePart('throat', 'Throat', 'front of the neck (trachea)', -0.05, 0.45, -0.4, 0.4, 0.06);
      if (sex === 'male') sidePart('larynx', 'Adam’s apple', 'larynx (thyroid cartilage)', -0.25, 0.5, -0.3, 0.5, 0.055);
      sidePart('neckSide', `${near.word} side of neck`, 'sternocleidomastoid', -0.05, 0.1, -0.4, 0, 0.05);
      sidePart('neckBack', 'Back of neck', 'neck extensors and upper traps', -0.05, -0.45, -0.4, -0.4, 0.06);
    } else if (facing === 'back') {
      mid('neckBack', 'Back of neck', 'neck extensors (splenius, semispinalis)', -0.05, -0.42, 0.05);
      pair('neckSide', 'side of neck', 'levator scapulae and upper traps', -0.05, 0.28, -0.35, 0.16, 0.045);
    } else {
      mid('throat', 'Throat', sex === 'male' ? 'front of the neck (trachea)' : 'front of the neck (trachea, thyroid)', -0.05, -0.42, 0.045);
      if (sex === 'male') mid('larynx', 'Adam’s apple', 'larynx (thyroid cartilage)', -0.25, -0.3, 0.055);
      pair('neckSide', 'side of neck', 'sternocleidomastoid', -0.02, 0.2, -0.38, 0.12, 0.045);
    }
  
    // ---- chest / upper back
    region('chest', facing === 'back' ? 'Upper back' : 'Chest', tp(0.12, 0), tp(0.42, 0), 0.3 * T);
    if (facing === 'front') {
      const female = sex === 'female';
      pair('trap', 'trap', 'upper trapezius', -0.08, 0.3, 0.0, 0.78, 0.06);
      pair('clavicle', 'collarbone', 'clavicle', 0.02, 0.12, -0.01, 0.8, 0.03);
      pair('upperChest', 'upper chest', 'clavicular (upper) head of the pectoralis major', 0.12, 0.2, 0.12, 0.62, 0.065);
      if (female) pair('breast', 'breast', 'breast, over the pectoralis major', 0.28, 0.2, 0.31, 0.6, 0.12);
      else pair('pec', 'pec', 'pectoralis major', 0.25, 0.18, 0.27, 0.62, 0.1);
      pair('nipple', female ? 'nipple & areola' : 'nipple', female ? 'nipple and areola' : 'nipple', 0.3, 0.5, 0.3, 0.5, female ? 0.035 : 0.028);
      mid('sternum', 'Sternum', 'breastbone', 0.04, 0.4, 0.03);
      pair('lowerChest', female ? 'underbust' : 'lower chest', female ? 'fold under the breast (inframammary)' : 'sternal (lower) head of the pectoralis major', 0.42, 0.2, 0.43, 0.55, 0.05);
      pair('serratus', 'serratus', 'serratus anterior (side ribs)', 0.3, 0.86, 0.48, 0.8, 0.06);
      pair('armpit', 'armpit', 'axilla', 0.14, 0.95, 0.16, 0.95, 0.05);
    } else if (facing === 'back') {
      pair('trap', 'upper trap', 'upper trapezius', -0.05, 0.2, 0.02, 0.76, 0.075);
      pair('midTrap', 'mid trap', 'middle trapezius', 0.14, 0.1, 0.2, 0.45, 0.065);
      pair('rhomboid', 'rhomboid', 'rhomboids (between the shoulder blades)', 0.24, 0.12, 0.34, 0.3, 0.05);
      pair('rotator', 'rotator cuff', 'infraspinatus, on the shoulder blade', 0.2, 0.55, 0.3, 0.6, 0.075);
      pair('teres', 'teres major', 'teres major', 0.3, 0.82, 0.32, 0.84, 0.05);
      pair('lat', 'lat', 'latissimus dorsi', 0.38, 0.7, 0.6, 0.45, 0.1);
      mid('spine', 'Upper spine', 'thoracic spine', 0.0, 0.46, 0.025);
    } else {
      const female = sex === 'female';
      sidePart(female ? 'breast' : 'pec', `${near.word} ${female ? 'breast' : 'pec'}`, female ? 'breast, over the pectoralis major' : 'pectoralis major', 0.14, 0.55, 0.4, 0.6, 0.13);
      sidePart('nipple', `${near.word} nipple`, female ? 'nipple and areola' : 'nipple', 0.3, 0.98, 0.3, 0.98, 0.03);
      sidePart('trap', `${near.word} upper trap`, 'upper trapezius', -0.03, -0.3, 0.1, -0.35, 0.08);
      sidePart('lat', `${near.word} lat`, 'latissimus dorsi and rhomboids', 0.2, -0.55, 0.5, -0.55, 0.13);
      sidePart('serratus', `${near.word} serratus`, 'serratus anterior and ribs', 0.25, 0, 0.5, 0.05, 0.08);
      sidePart('armpit', `${near.word} armpit`, 'axilla', 0.12, 0, 0.12, 0, 0.05);
    }
  
    // ---- midsection
    region('core', facing === 'back' ? 'Lower back' : 'Midsection', tp(0.52, 0), tp(0.82, 0), 0.26 * T);
    if (facing === 'front') {
      const rows = [['abs1', 'Upper abs', 0.52], ['abs2', 'Middle abs', 0.64], ['abs3', 'Lower abs', 0.75]];
      for (const [kind, name, tt] of rows) pair(kind, () => name, 'rectus abdominis (six-pack)', tt, 0.05, tt, 0.26, 0.055);
      mid('navel', 'Belly button', 'navel (umbilicus)', 0.81, 0.81, 0.028);
      pair('oblique', 'obliques', 'external obliques', 0.52, 0.62, 0.85, 0.55, 0.1);
      pair('lowerBelly', () => 'Lower belly', 'lower rectus abdominis, below the belly button', 0.9, 0.05, 0.9, 0.3, 0.055);
    } else if (facing === 'back') {
      mid('spine', 'Lower spine', 'lumbar spine', 0.48, 0.92, 0.025);
      pair('lowerBack', 'lower back', 'erector spinae', 0.5, 0.14, 0.9, 0.14, 0.07);
      pair('lat', 'lat', 'latissimus dorsi (lower)', 0.5, 0.55, 0.64, 0.45, 0.08);
      pair('ql', 'QL', 'quadratus lumborum (deep side of the lower back)', 0.72, 0.42, 0.86, 0.45, 0.055);
      pair('oblique', 'obliques', 'external obliques (love handles)', 0.6, 0.8, 0.85, 0.75, 0.06);
    } else {
      sidePart('abs1', 'Abs', 'rectus abdominis', 0.5, 0.6, 0.85, 0.6, 0.12);
      sidePart('oblique', `${near.word} obliques`, 'external obliques', 0.5, 0, 0.85, 0, 0.1);
      sidePart('lowerBack', 'Lower back', 'erector spinae', 0.5, -0.6, 0.9, -0.6, 0.12);
    }
  }

  if (bodyOk || hipSeen) {
    // ---- hips & pelvis
    const hipA = seen(P.leftHip) ? lhp : tp(1, sgn(SIDES[0]), hh);
    const hipB = seen(P.rightHip) ? rhp : tp(1, sgn(SIDES[1]), hh);
    region('hips', facing === 'back' ? 'Glutes' : 'Hips', mode !== 'upper' ? hipA : tp(1, 0.9, hh), mode !== 'upper' ? hipB : tp(1, -0.9, hh), 0.2 * T);
    if (facing === 'front') {
      pair('lowerBelly', () => 'Lower belly', 'lower rectus abdominis, below the belly button', 0.88, 0.05, 0.9, 0.3, 0.055);
      pair('hipBone', 'hip bone', 'iliac crest (front of the pelvis)', 0.88, 1.1, 0.9, 1.05, 0.05, hh);
      pair('vline', 'V-line', 'inguinal crease', 0.92, 0.85, 1.05, 0.35, 0.035, hh);
      pair('hipFlexor', 'hip flexor', 'iliopsoas', 0.98, 0.8, 1.1, 0.85, 0.07, hh);
      for (const s of SIDES) if (seen(s.hip)) part('joint', `${s.word} hip joint`, 'hip joint (femoral head)', px(s.hip), null, 0.045 * T);
      const g = genitalNames(sex);
      mid('pubic', g.mons[0], g.mons[1], 1.0, 1.08, 0.06);
    } else if (facing === 'back') {
      pair('gluteMed', 'glute medius', 'gluteus medius (upper outer glute)', 0.9, 1.0, 0.98, 1.05, 0.08, hh);
      pair('glute', 'glute', 'gluteus maximus', 1.02, 0.5, 1.18, 0.6, 0.12, hh);
      mid('tailbone', 'Tailbone', 'sacrum and coccyx', 0.9, 1.03, 0.045);
      pair('lowerBack', 'lower back', 'erector spinae', 0.86, 0.14, 0.9, 0.14, 0.06);
    } else {
      sidePart('hipFlexor', `${near.word} hip flexor`, 'iliopsoas', 0.95, 0.5, 1.1, 0.5, 0.08);
      sidePart('glute', `${near.word} glute`, 'gluteus maximus', 0.95, -0.55, 1.15, -0.55, 0.14);
      sidePart('gluteMed', `${near.word} glute medius`, 'gluteus medius (side of the hip)', 0.86, -0.1, 0.96, -0.1, 0.08);
      sidePart('hipBone', `${near.word} hip bone`, 'iliac crest', 0.88, 0.25, 0.88, 0.25, 0.05);
      if (seen(near.hip)) part('joint', `${near.word} hip joint`, 'hip joint (greater trochanter)', px(near.hip), null, 0.045 * T);
    }
  
    // ---- crotch: genitals from the front, perineum and anus from behind
    const g = genitalNames(sex);
    if (facing === 'front') {
      region('crotch', 'Groin', tp(1.05, 0), tp(1.28, 0), 0.08 * T);
      mid('pubic', g.mons[0], g.mons[1], 1.0, 1.08, 0.06);
      for (const [name, detail] of g.main) mid('genital', name, detail, 1.12, 1.22, 0.04);
      if (g.low) mid('perineum', g.low[0], g.low[1], 1.22, 1.29, 0.045);
      pair('vline', 'groin crease', 'inguinal fold, where the thigh meets the pelvis', 1.08, 0.5, 1.22, 0.3, 0.03, hh);
    } else if (facing === 'back') {
      region('crotch', 'Buttocks', tp(1.05, 0), tp(1.3, 0), 0.08 * T);
      mid('cleft', 'Gluteal cleft', 'the crease between the buttocks', 1.04, 1.18, 0.025);
      mid('anus', 'Anus', 'anus', 1.2, 1.22, 0.025);
      mid('perineum', 'Perineum', 'perineum and pelvic floor (between the anus and the genitals)', 1.25, 1.3, 0.03);
      pair('gluteFold', 'glute fold', 'where the glute meets the hamstring', 1.28, 0.25, 1.28, 0.85, 0.03, hh);
      pair('glute', 'glute', 'gluteus maximus', 1.1, 0.5, 1.2, 0.6, 0.1, hh);
    } else {
      region('crotch', 'Groin', sp(1.0, 0.8), sp(1.2, 0.85), 0.08 * T);
      sidePart('pubic', g.mons[0], g.mons[1], 1.0, 0.85, 1.06, 0.9, 0.055);
      for (const [name, detail] of g.main) sidePart('genital', name, detail, 1.1, 0.9, 1.2, 0.9, 0.04);
      if (g.low) sidePart('perineum', g.low[0], g.low[1], 1.2, 0.75, 1.26, 0.7, 0.04);
    }
  }

  // ---- limbs
  const trackedSides = new Set();
  for (const hand of hands?.landmarks || []) {
    const pts = hand.map((p) => V(p.x * w, p.y * h));
    const side = SIDES.find((x) => x.key === hand.side) || SIDES.reduce((best, s) => (vis(lm[s.wr]) < 0.3 ? best : !best || dist(px(s.wr), pts[0]) < dist(px(best.wr), pts[0]) ? s : best), null) || SIDES[0];
    o.hands.push({ side, pts });
    trackedSides.add(side.key);
  }

  // Close up, a limb often runs off the edge of the frame. The joint past the
  // edge is estimated (the model's guess, else straight on), so the part of
  // the limb that is in view still gets its own name.
  const inferred = new Map();
  const offFrame = (p) => p.x < 0 || p.y < 0 || p.x > w || p.y > h;
  const infer = (from, midJ, to, len) => {
    if (vis(lm[midJ]) < 0.35 || vis(lm[to]) >= 0.35 || inferred.has(to)) return;
    const m = px(midJ);
    const guess = px(to);
    const d = dist(m, guess);
    if (d > 0.5 * len && d < 1.6 * len && offFrame(guess)) return inferred.set(to, guess);
    if (vis(lm[from]) < 0.35) return;
    const p = add(m, unit(px(from), m), len);
    if (offFrame(p)) inferred.set(to, p);
  };
  for (const s of SIDES) {
    for (const [a, b, c, l1, l2] of [[s.sh, s.el, s.wr, 0.65, 0.5], [s.hip, s.kn, s.an, 0.85, 0.85]]) {
      infer(a, b, c, l2 * T);
      infer(c, b, a, l1 * T);
    }
  }
  const jp = (i) => inferred.get(i) || px(i);
  const limbOk = (...ids) => ids.every((i) => vis(lm[i]) >= 0.35 || inferred.has(i));
  for (const s of SIDES) {
    const g2 = sgn(s);
    const sideOn = facing === 'side';
    const word = s.word;
    // Perpendicular offset: + = outer (away from the midline), or + = front when side-on.
    const limb = (a, b) => {
      const n = perp(unit(a, b));
      const c = lerp2(a, b, 0.5);
      const ref = sideOn ? (n.x * fdir.x + n.y * fdir.y) : (c.x - S.x) * n.x + (c.y - S.y) * n.y;
      const nn = ref >= 0 ? n : V(-n.x, -n.y);
      return (t0, t1, off, r, R) => [add(lerp2(a, b, t0), nn, off * R), add(lerp2(a, b, t1), nn, off * R), r * R];
    };
    const L = (kind, name, detail, seg) => part(kind, `${word} ${name}`, detail, seg[0], seg[1], seg[2]);
    const joint = (name, detail, p, r) => part('joint', `${word} ${name}`, detail, p, null, r * T);

    const sh = jp(s.sh), el = jp(s.el), wr = jp(s.wr);
    if (limbOk(s.sh, s.el)) {
      // Shoulder cap
      const Rs = 0.14 * T;
      const cap = lerp2(sh, el, 0.18);
      region(`shoulder${s.key}`, `${word} shoulder`, sh, cap, Rs, { side: s });
      const f = limb(sh, cap);
      if (sideOn) {
        L('frontDelt', 'front delt', 'anterior deltoid', f(0, 1, 0.5, 0.55, Rs));
        L('rearDelt', 'rear delt', 'posterior deltoid', f(0, 1, -0.5, 0.55, Rs));
        L('sideDelt', 'side delt', 'lateral deltoid', f(0, 1, 0, 0.45, Rs));
      } else {
        L(facing === 'back' ? 'rearDelt' : 'frontDelt', facing === 'back' ? 'rear delt' : 'front delt', facing === 'back' ? 'posterior deltoid' : 'anterior deltoid', f(0, 1, -0.3, 0.7, Rs));
        L('sideDelt', 'side delt', 'lateral deltoid', f(0, 1, 0.6, 0.55, Rs));
      }
      joint('shoulder joint', 'shoulder joint (glenohumeral)', sh, 0.04);

      // Upper arm
      const Ru = 0.11 * T;
      region(`upperArm${s.key}`, `${word} upper arm`, cap, el, Ru, { side: s });
      const a = limb(cap, el);
      if (sideOn) {
        L('biceps', 'biceps', 'biceps brachii', a(0.05, 0.9, 0.45, 0.6, Ru));
        L('triceps', 'triceps', 'triceps brachii', a(0.05, 0.9, -0.45, 0.6, Ru));
        L('brachialis', 'brachialis', 'brachialis (under the biceps)', a(0.6, 0.92, 0.1, 0.3, Ru));
      } else if (facing === 'back') {
        L('triceps', 'triceps', 'long head of the triceps', a(0.05, 0.8, -0.35, 0.6, Ru));
        L('tricepsLat', 'outer triceps', 'lateral head of the triceps', a(0.05, 0.7, 0.45, 0.5, Ru));
        L('triceps', 'triceps tendon', 'triceps tendon, above the elbow', a(0.85, 0.95, 0, 0.35, Ru));
      } else {
        L('biceps', 'biceps', 'biceps brachii', a(0.1, 0.85, -0.1, 0.75, Ru));
        L('brachialis', 'brachialis', 'brachialis and outer biceps', a(0.45, 0.95, 0.75, 0.35, Ru));
      }
      const elbowName = facing === 'back' ? ['elbow point', 'olecranon — where the triceps attaches'] : facing === 'front' ? ['inner elbow', 'crook of the elbow (cubital fossa)'] : ['elbow', 'elbow joint'];
      joint(elbowName[0], elbowName[1], el, 0.05);

      if (limbOk(s.wr)) {
        const Rf = 0.085 * T;
        region(`forearm${s.key}`, `${word} forearm`, el, wr, Rf, { side: s });
        const b = limb(el, wr);
        joint(elbowName[0], elbowName[1], el, 0.05);
        L('brachioradialis', 'brachioradialis', 'brachioradialis (top of the forearm)', b(0.03, 0.45, sideOn ? 0.35 : 0.45, 0.55, Rf));
        if (sideOn) L('forearm', 'forearm', 'forearm flexors and extensors', b(0.35, 0.95, 0, 0.75, Rf));
        else if (facing === 'back') L('extensors', 'forearm extensors', 'wrist and finger extensors', b(0.1, 0.95, -0.1, 0.7, Rf));
        else L('flexors', 'forearm flexors', 'wrist and finger flexors', b(0.1, 0.95, -0.25, 0.7, Rf));
        joint('wrist', 'wrist joint', wr, 0.04);

        if (!trackedSides.has(s.key) && vis(lm[s.idx]) >= 0.3) {
          const tip = lerp2(wr, lerp2(px(s.idx), px(s.pk), 0.5), 1.3);
          const Rh = 0.07 * T;
          region(`hand${s.key}`, `${word} hand`, wr, tip, Rh, { side: s });
          joint('wrist', 'wrist joint', wr, 0.04);
          part('hand', `${word} hand`, 'hand — turn on Fingers for each finger', wr, lerp2(wr, tip, 0.45), Rh);
          part('finger2', `${word} fingers`, 'fingers — turn on Fingers for each finger', lerp2(wr, tip, 0.6), tip, 0.8 * Rh);
        }
      }
    }

    const hip = jp(s.hip), kn = jp(s.kn), an = jp(s.an);
    if (limbOk(s.hip, s.kn)) {
      const Rt = 0.17 * T;
      region(`thigh${s.key}`, `${word} thigh`, hip, kn, Rt, { side: s });
      const t = limb(hip, kn);
      if (sideOn) {
        L('quad', 'quads', 'quadriceps (front of the thigh)', t(0.1, 0.9, 0.45, 0.6, Rt));
        L('hamstring', 'hamstrings', 'back of the thigh', t(0.3, 0.9, -0.45, 0.6, Rt));
        L('glute', 'glute', 'gluteus maximus (lower part)', t(0, 0.2, -0.5, 0.6, Rt));
        L('itBand', 'IT band', 'iliotibial band (outer thigh)', t(0.3, 0.9, 0, 0.2, Rt));
        L('tfl', 'TFL', 'tensor fasciae latae (front of the hip)', t(0, 0.2, 0.3, 0.35, Rt));
      } else if (facing === 'back') {
        L('glute', 'glute', 'gluteus maximus (lower part)', t(0, 0.2, -0.15, 0.75, Rt));
        L('gluteFold', 'glute fold', 'where the glute meets the hamstring', t(0.3, 0.3, 0, 0.35, Rt));
        L('hamstringOuter', 'outer hamstring', 'biceps femoris', t(0.4, 0.85, 0.4, 0.55, Rt));
        L('hamstring', 'inner hamstring', 'semitendinosus and semimembranosus', t(0.4, 0.85, -0.4, 0.55, Rt));
        L('adductor', 'inner thigh', 'adductor magnus', t(0.3, 0.5, -0.8, 0.3, Rt));
        L('itBand', 'IT band', 'iliotibial band (outer thigh)', t(0.35, 0.9, 0.95, 0.18, Rt));
      } else {
        L('quad', 'quads', 'rectus femoris (middle of the quads)', t(0.12, 0.8, 0, 0.5, Rt));
        L('vastusLat', 'outer quad', 'vastus lateralis', t(0.2, 0.85, 0.55, 0.45, Rt));
        L('vmo', 'teardrop (VMO)', 'vastus medialis oblique, just above the knee', t(0.66, 0.88, -0.45, 0.35, Rt));
        L('adductor', 'inner thigh', 'adductors', t(0.08, 0.55, -0.6, 0.45, Rt));
        L('tfl', 'TFL', 'tensor fasciae latae (front of the hip)', t(0, 0.2, 0.75, 0.3, Rt));
        L('itBand', 'IT band', 'iliotibial band (outer thigh)', t(0.3, 0.9, 0.95, 0.18, Rt));
      }
      const kneeName = facing === 'front' ? ['kneecap', 'patella'] : facing === 'back' ? ['knee', 'back of the knee — hamstring and calf tendons (popliteal area)'] : ['knee', 'knee joint'];
      const kneeLabel = facing === 'back' ? `Back of ${s.low} knee` : `${word} ${kneeName[0]}`;
      part('joint', kneeLabel, kneeName[1], kn, null, 0.075 * T);

      if (limbOk(s.an)) {
        const Rl = 0.11 * T;
        region(`lowerLeg${s.key}`, `${word} lower leg`, kn, an, Rl, { side: s });
        part('joint', kneeLabel, kneeName[1], kn, null, 0.075 * T);
        const c = limb(kn, an);
        if (sideOn) {
          L('shin', 'shin', 'tibialis anterior', c(0.08, 0.92, 0.5, 0.45, Rl));
          L('calf', 'calf', 'gastrocnemius', c(0.08, 0.55, -0.4, 0.6, Rl));
          L('soleus', 'soleus', 'soleus (lower calf)', c(0.55, 0.8, -0.3, 0.45, Rl));
          L('achilles', 'Achilles tendon', 'Achilles tendon', c(0.8, 1, -0.35, 0.3, Rl));
        } else if (facing === 'back') {
          L('calf', 'inner calf', 'medial gastrocnemius', c(0.08, 0.5, -0.4, 0.55, Rl));
          L('calfOuter', 'outer calf', 'lateral gastrocnemius', c(0.08, 0.5, 0.4, 0.55, Rl));
          L('soleus', 'soleus', 'soleus (lower calf)', c(0.5, 0.8, 0, 0.5, Rl));
          L('achilles', 'Achilles tendon', 'Achilles tendon', c(0.8, 1, 0, 0.3, Rl));
        } else {
          L('shin', 'shin', 'tibialis anterior', c(0.08, 0.92, 0.1, 0.55, Rl));
          L('peroneal', 'peroneals', 'fibularis (outer shin)', c(0.1, 0.75, 0.75, 0.3, Rl));
          L('calf', 'inner calf', 'medial gastrocnemius', c(0.1, 0.5, -0.7, 0.35, Rl));
        }
        joint('ankle', 'ankle joint', an, 0.05);

        if (vis(lm[s.heel]) >= 0.3 && vis(lm[s.toe]) >= 0.3) {
          const heel = px(s.heel), toe = px(s.toe);
          const Rft = 0.06 * T;
          region(`foot${s.key}`, `${word} foot`, heel, toe, Rft, { side: s });
          joint('ankle', 'ankle joint', an, 0.05);
          part('heel', `${word} heel`, 'heel (calcaneus)', heel, lerp2(heel, toe, 0.2), 0.9 * Rft);
          part('midfoot', sideOn ? `${word} arch` : facing === 'back' ? `${word} foot` : `Top of ${s.low} foot`, sideOn ? 'arch of the foot' : 'midfoot', lerp2(heel, toe, 0.3), lerp2(heel, toe, 0.65), 0.8 * Rft);
          part('toes', `${word} toes`, 'toes', lerp2(heel, toe, 0.75), toe, 0.7 * Rft);
        }
      }
    }
  }

  // ---- tracked hands: every finger bone, palm, knuckles
  for (const { side, pts } of o.hands) {
    const word = side.word;
    const fr = 0.1 * dist(pts[0], pts[9]);
    const pw = dist(pts[5], pts[17]);
    if (!(fr > 0.5)) continue;
    const v1 = V(pts[5].x - pts[0].x, pts[5].y - pts[0].y);
    const v2 = V(pts[17].x - pts[0].x, pts[17].y - pts[0].y);
    const cz = v1.x * v2.y - v1.y * v2.x;
    const palmSide = side.key === 'R' ? cz < 0 : cz > 0;
    const dir = unit(pts[0], pts[9]);
    // The region reaches every landmark (thumb included) with some margin, so
    // a hand in front of the body wins over the body behind it.
    const ax = pts[0], bx = pts[12];
    let spread = 0;
    for (const p of pts) spread = Math.max(spread, capsuleSd({ a: ax, b: bx, r: 0 }, p.x, p.y));
    region(`hand${side.key}`, `${word} hand`, ax, bx, spread + fr + 0.25 * pw, { side, tracked: true });
    for (const [fi, f] of FINGERS.entries()) {
      for (let k = 0; k < 3; k++) {
        part(`finger${k + 1}`, `${word} ${f.name}`, fingerSeg(f, k), pts[f.joints[k]], pts[f.joints[k + 1]], (fi === 0 ? 1.2 : 1) * fr * (1 - 0.08 * k));
      }
    }
    const palmName = palmSide ? [`${word} palm`, 'palm of the hand'] : [`Back of ${side.low} hand`, 'back of the hand (metacarpals)'];
    part('palm', ...palmName, pts[0], lerp2(pts[0], pts[9], 0.85), 0.42 * pw);
    part('palm', ...palmName, lerp2(pts[0], pts[5], 0.4), lerp2(pts[0], pts[17], 0.4), 0.3 * pw);
    part('knuckles', `${word} knuckles`, 'knuckles (where the fingers join the hand)', pts[5], pts[17], 0.9 * fr);
    if (palmSide) part('thumbPad', `${word} thumb pad`, 'thenar eminence (base of the thumb)', pts[1], lerp2(pts[1], pts[2], 0.8), 1.5 * fr);
    part('joint', `${word} wrist`, 'wrist joint', pts[0], add(pts[0], dir, -0.35 * pw), 0.38 * pw);

    // Shape of the hand for sharpening the body outline around the fingers.
    const shape = [];
    const cap = (a, b, r) => shape.push({ a, b, r });
    for (const [fi, f] of FINGERS.entries()) for (let k = 0; k < 3; k++) cap(pts[f.joints[k]], pts[f.joints[k + 1]], (fi === 0 ? 1.2 : 1) * fr * (1 - 0.08 * k));
    cap(pts[0], lerp2(pts[0], pts[9], 0.9), 0.4 * pw);
    cap(pts[5], pts[17], fr * 1.05);
    cap(pts[0], pts[5], fr * 1.3);
    cap(pts[0], pts[17], fr * 1.3);
    cap(pts[1], pts[5], fr * 0.9);
    cap(pts[0], add(pts[0], dir, -0.5 * pw), 0.42 * pw);
    let reach = 0;
    const c = lerp2(pts[0], pts[9], 0.6);
    for (const p of pts) reach = Math.max(reach, dist(c, p));
    o.shapes.push({ c, zoneR: reach + 2.5 * fr, wrist: pts[0], dir, len: dist(pts[0], pts[12]) || 1, caps: shape });
  }
  return pack(o);
}

/** Packs capsules into GL-ready buffers: coarse uniforms and a data texture. */
function pack(o) {
  const { coarse, fine } = o;
  o.coarseCount = Math.min(coarse.length, MAX_COARSE);
  for (let i = 0; i < o.coarseCount; i++) {
    const c = coarse[i];
    o.coarseSegs.set([c.a.x, c.a.y, c.b.x, c.b.y], i * 4);
    o.coarseRads[i] = c.r;
    o.coarseRange[i * 2] = c.start;
    o.coarseRange[i * 2 + 1] = c.end;
  }
  // Rows: [a.x, a.y, b.x, b.y] [r, 0, 0, 0] [R, G, B, 1]
  let row = 0;
  const put = (a, b, r, col) => {
    if (row >= MAX_ROWS) return;
    o.rowData.set([a.x, a.y, b.x, b.y, r, 0, 0, 0, col[0], col[1], col[2], 1], row * 12);
    row++;
  };
  for (const f of fine) {
    f.color = KIND_COLORS[f.kind] || KIND_COLORS.head;
    put(f.a, f.b, f.r, hex(f.color));
  }
  o.fineCount = row;
  for (const s of o.shapes) {
    s.start = row;
    for (const c of s.caps) put(c.a, c.b, c.r, [0, 0, 0]);
    s.end = row;
  }
  o.rows = row;
  return o;
}

/** Nearest coarse region, and the nearest detailed part inside it. */
function locate(ctx, x, y) {
  let ci = -1;
  let cd = Infinity;
  for (let i = 0; i < ctx.coarseCount; i++) {
    const d = capsuleSd(ctx.coarse[i], x, y);
    if (d < cd) {
      cd = d;
      ci = i;
    }
  }
  if (ci < 0) return null;
  const c = ctx.coarse[ci];
  let fi = -1;
  let fd = Infinity;
  for (let k = c.start; k < c.end; k++) {
    const d = capsuleSd(ctx.fine[k], x, y);
    if (d < fd) {
      fd = d;
      fi = k;
    }
  }
  return { ci, cd, fi };
}

/**
 * Names the body point (x, y) — the same part the GL stage coloured there.
 * `inside`: whether the point is inside the body outline (from the mask);
 * without it, points must be within reach of a region's capsule.
 * @returns {{name, detail, region, kind, color, index}} or null
 */
export function identify(ctx, x, y, { inside = null } = {}) {
  if (!ctx || !ctx.coarseCount) return null;
  const hit = locate(ctx, x, y);
  if (!hit) return null;
  const c = ctx.coarse[hit.ci];
  if (inside === false) return null;
  if (inside == null && hit.cd > 0.35 * c.r) return null;
  if (hit.fi < 0) return { name: c.label, detail: '', region: c.label, kind: 'head', color: KIND_COLORS.head, index: -1 };
  const f = ctx.fine[hit.fi];
  return { name: f.name, detail: f.detail, region: c.label, kind: f.kind, color: f.color, index: hit.fi };
}

/** Frame-pixel point to label a part at: the middle of its on-screen portion, or null if off-screen. */
export function labelPoint(p, w, h) {
  const inside = (q) => q.x >= 0 && q.y >= 0 && q.x <= w && q.y <= h;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const q = lerp2(p.a, p.b, k / 8);
    if (inside(q)) pts.push(q);
  }
  return pts.length ? pts[pts.length >> 1] : null;
}

/** Short on-body label for a detailed part: drop the "Left/Right" (colour + position say it). */
export const shortName = (name) => name.replace(/^(Left|Right) /, '').replace(/^Back of (left|right) /, 'Back of ').replace(/^Top of (left|right) /, 'Top of ');
