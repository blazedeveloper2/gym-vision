import { P, vis } from '../geometry.js';

/**
 * Body-part identifier.
 *
 * Coarse regions (head, chest, thighs, ...) are capsules — a line segment with
 * a radius — built from pose landmarks. Inside the body mask, each pixel
 * belongs to the region whose capsule surface is nearest; the GL stage does
 * this per pixel for the colour overlay.
 *
 * `identify()` then resolves a point to a detailed name (≈100 of them) using
 * local coordinates within the region — along the limb, across it (inner vs
 * outer), and which way the person faces (front, back or side-on) — plus face
 * landmarks, joints, and finger landmarks when hand tracking is on.
 *
 * All coordinates are frame pixels of the unmirrored image. Sizes scale with
 * torso length (T).
 */

export const MAX_PARTS = 32;

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const PART_COLORS = {
  head: '#f472b6',
  neck: '#fb7185',
  chest: '#ef4444',
  core: '#f97316',
  hips: '#eab308',
  shoulder: '#a855f7',
  upperArm: '#3b82f6',
  forearm: '#06b6d4',
  hand: '#2dd4bf',
  finger: '#5eead4',
  thigh: '#22c55e',
  lowerLeg: '#84cc16',
  foot: '#bef264',
};

const SIDES = [
  { key: 'L', word: 'Left', sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, idx: P.leftIndex, pk: P.leftPinky, hip: P.leftHip, kn: P.leftKnee, an: P.leftAnkle, heel: P.leftHeel, toe: P.leftFoot, eye: 2, ear: P.leftEar },
  { key: 'R', word: 'Right', sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, idx: P.rightIndex, pk: P.rightPinky, hip: P.rightHip, kn: P.rightKnee, an: P.rightAnkle, heel: P.rightHeel, toe: P.rightFoot, eye: 5, ear: P.rightEar },
];

const FINGERS = [
  { name: 'thumb', joints: [1, 2, 3, 4], segs: ['base (metacarpal)', 'middle', 'tip'] },
  { name: 'index finger', joints: [5, 6, 7, 8], segs: ['base', 'middle', 'tip'] },
  { name: 'middle finger', joints: [9, 10, 11, 12], segs: ['base', 'middle', 'tip'] },
  { name: 'ring finger', joints: [13, 14, 15, 16], segs: ['base', 'middle', 'tip'] },
  { name: 'pinky', joints: [17, 18, 19, 20], segs: ['base', 'middle', 'tip'] },
];

const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest point on segment a→b: returns {t (0..1), d (distance), q (point)}. */
function project(a, b, x, y) {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * bx + (y - a.y) * by) / Math.max(bx * bx + by * by, 1e-6)));
  const q = { x: a.x + bx * t, y: a.y + by * t };
  return { t, d: Math.hypot(x - q.x, y - q.y), q };
}

function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Which way the person faces: 'front', 'back' or 'side' — plus, side-on,
 * which image direction is their front (+1 = image right).
 */
export function facingOf(lm, w, h) {
  const ls = lm[P.leftShoulder], rs = lm[P.rightShoulder], lh = lm[P.leftHip], rh = lm[P.rightHip];
  let frontSign = 0;
  const earMid = vis(lm[P.leftEar]) > vis(lm[P.rightEar]) ? lm[P.leftEar] : lm[P.rightEar];
  if (vis(lm[P.nose]) > 0.3 && vis(earMid) > 0.3) frontSign = Math.sign(lm[P.nose].x - earMid.x) || 1;
  if ([ls, rs, lh, rh].some((p) => vis(p) < 0.5)) return { facing: 'side', frontSign };
  const torso = Math.hypot(((ls.x + rs.x) - (lh.x + rh.x)) * w / 2, ((ls.y + rs.y) - (lh.y + rh.y)) * h / 2) || 1;
  const spread = Math.abs(ls.x - rs.x) * w / torso;
  if (spread < 0.4) return { facing: 'side', frontSign };
  // Facing the camera, the person's left shoulder appears on the image right.
  return { facing: ls.x > rs.x ? 'front' : 'back', frontSign };
}

/**
 * Builds the coarse region capsules for one frame (and finger capsules if
 * hand landmarks are given). The returned context is also what `identify`
 * needs.
 * @param hands  HandLandmarker result or null
 */
export function computeParts(lm, w, h, hands = null, out = null) {
  const o = out || { segs: new Float32Array(MAX_PARTS * 4), rads: new Float32Array(MAX_PARTS), cols: new Float32Array(MAX_PARTS * 3), list: [] };
  o.list.length = 0;
  const px = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const ok = (...ids) => ids.every((i) => vis(lm[i]) >= 0.5);
  const add = (id, group, a, b, r, visible, extra = {}) => o.list.push({ id, group, a, b, r, visible: visible && r > 0, ...extra });

  // Side-on, the far shoulder and hip are often hidden: use whichever are seen.
  const avg = (ids) => {
    const seen = ids.filter((i) => vis(lm[i]) >= 0.5).map(px);
    return seen.length ? { x: seen.reduce((a, p) => a + p.x, 0) / seen.length, y: seen.reduce((a, p) => a + p.y, 0) / seen.length } : null;
  };
  const S0 = avg([P.leftShoulder, P.rightShoulder]);
  const H0 = avg([P.leftHip, P.rightHip]);
  const torsoOk = !!S0 && !!H0 && dist(S0, H0) > 10;
  const S = torsoOk ? S0 : { x: 0, y: 0 };
  const Hc = torsoOk ? H0 : { x: 0, y: 0 };
  const T = torsoOk ? dist(S, Hc) : 0;
  const hipA = ok(P.leftHip) ? px(P.leftHip) : Hc;
  const hipB = ok(P.rightHip) ? px(P.rightHip) : Hc;
  Object.assign(o, { lm, w, h, px, S, Hc, T, torsoOk, ...facingOf(lm, w, h) });

  const earsOk = ok(P.leftEar, P.rightEar);
  const headC = earsOk ? lerp2(px(P.leftEar), px(P.rightEar), 0.5) : ok(P.nose) ? px(P.nose) : null;
  const headOk = torsoOk && !!headC;
  const up = headOk ? { x: headC.x - S.x, y: headC.y - S.y } : { x: 0, y: -1 };
  o.headC = headC;
  add('head', 'head', headOk ? headC : S, headOk ? { x: headC.x + up.x * 0.3, y: headC.y + up.y * 0.3 } : S, 0.24 * T, headOk);
  add('neck', 'neck', S, headOk ? { x: S.x + up.x * 0.45, y: S.y + up.y * 0.45 } : S, 0.12 * T, headOk);
  add('chest', 'chest', lerp2(S, Hc, 0.12), lerp2(S, Hc, 0.42), 0.3 * T, torsoOk);
  add('core', 'core', lerp2(S, Hc, 0.52), lerp2(S, Hc, 0.82), 0.26 * T, torsoOk);
  add('hips', 'hips', hipA, hipB, 0.2 * T, torsoOk);

  for (const s of SIDES) {
    const armOk = torsoOk && ok(s.sh, s.el);
    const sh = px(s.sh), el = px(s.el), wr = px(s.wr);
    add(`shoulder${s.key}`, 'shoulder', sh, lerp2(sh, el, 0.18), 0.14 * T, armOk, { side: s });
    add(`upperArm${s.key}`, 'upperArm', lerp2(sh, el, 0.18), el, 0.11 * T, armOk, { side: s });
    const foreOk = armOk && ok(s.wr);
    add(`forearm${s.key}`, 'forearm', el, wr, 0.085 * T, foreOk, { side: s });
    const handOk = foreOk && vis(lm[s.idx]) >= 0.3;
    const tip = handOk ? lerp2(wr, lerp2(px(s.idx), px(s.pk), 0.5), 1.3) : wr;
    add(`hand${s.key}`, 'hand', wr, tip, 0.07 * T, handOk, { side: s });

    const legOk = torsoOk && ok(s.hip, s.kn);
    const hip = px(s.hip), kn = px(s.kn), an = px(s.an);
    add(`thigh${s.key}`, 'thigh', hip, kn, 0.17 * T, legOk, { side: s });
    const shinOk = legOk && ok(s.an);
    add(`lowerLeg${s.key}`, 'lowerLeg', kn, an, 0.11 * T, shinOk, { side: s });
    const footOk = shinOk && vis(lm[s.heel]) >= 0.3 && vis(lm[s.toe]) >= 0.3;
    add(`foot${s.key}`, 'foot', footOk ? px(s.heel) : an, footOk ? px(s.toe) : an, 0.06 * T, footOk, { side: s });
  }

  // Detailed hands: match each tracked hand to the nearest pose wrist.
  o.hands = [];
  for (const hand of hands?.landmarks || []) {
    const pts = hand.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z }));
    const side = SIDES.reduce((best, s) => (vis(lm[s.wr]) < 0.3 ? best : !best || dist(px(s.wr), pts[0]) < dist(px(best.wr), pts[0]) ? s : best), null) || SIDES[0];
    const r = 0.1 * dist(pts[0], pts[9]);
    o.hands.push({ side, pts, r });
    for (const f of FINGERS) {
      if (o.list.length >= MAX_PARTS) break;
      add(`finger${side.key}${f.name}`, 'finger', pts[f.joints[0]], pts[f.joints[3]], r, true, { side });
    }
  }

  o.count = Math.min(o.list.length, MAX_PARTS);
  for (let i = 0; i < o.count; i++) {
    const p = o.list[i];
    o.segs.set([p.a.x, p.a.y, p.b.x, p.b.y], i * 4);
    o.rads[i] = p.visible ? p.r : -1;
    o.cols.set(hex(PART_COLORS[p.group]), i * 3);
  }
  return o;
}

/** Index of the coarse region under (x, y), or -1. */
export function hitTest(parts, x, y, slack = 0.6) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < parts.count; i++) {
    const p = parts.list[i];
    if (!p.visible) continue;
    const d = project(p.a, p.b, x, y).d - p.r;
    if (d < bestD && d < slack * p.r) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export const partCenter = (p) => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });

const REGION_NAMES = {
  head: 'Head', neck: 'Neck', chest: 'Upper torso', core: 'Midsection', hips: 'Hips & pelvis',
  shoulder: 'shoulder', upperArm: 'upper arm', forearm: 'forearm', hand: 'hand', finger: 'hand',
  thigh: 'thigh', lowerLeg: 'lower leg', foot: 'foot',
};

/** Short label for a coarse region (used for on-body labels). */
export function regionLabel(part, ctx) {
  const base = REGION_NAMES[part.group];
  if (part.side) return `${part.side.word} ${base}`;
  if (part.group === 'chest') return ctx.facing === 'back' ? 'Upper back' : ctx.facing === 'side' ? 'Chest / back' : 'Chest';
  if (part.group === 'core') return ctx.facing === 'back' ? 'Lower back' : 'Abs';
  if (part.group === 'hips') return ctx.facing === 'back' ? 'Glutes' : 'Hips';
  return base;
}

/**
 * Detailed name for the body point (x, y), or null if it's not on the body.
 * @returns {{name, detail, region, group, index}}
 */
export function identify(ctx, x, y) {
  if (!ctx?.torsoOk) return null;
  const { px, facing, T } = ctx;
  const res = (name, detail, index) => ({ name, detail, index, group: index >= 0 ? ctx.list[index].group : 'hand', region: index >= 0 ? regionLabel(ctx.list[index], ctx) : '' });

  // 1. Fingers and hands (only with hand tracking).
  for (const hand of ctx.hands) {
    const { pts, r, side } = hand;
    let best = null;
    for (const f of FINGERS) {
      for (let k = 0; k < 3; k++) {
        const pr = project(pts[f.joints[k]], pts[f.joints[k + 1]], x, y);
        if (pr.d < r * 1.25 && (!best || pr.d < best.d)) best = { d: pr.d, f, k };
      }
    }
    const idx = ctx.list.findIndex((p) => p.group === 'finger' && p.side === side);
    if (best) return res(`${side.word} ${best.f.name}`, `${best.f.segs[best.k]} of the ${best.f.name}`, idx);
    if ([5, 9, 13, 17].some((i) => dist(pts[i], { x, y }) < r)) return res(`${side.word} knuckles`, 'where the fingers join the hand', idx);
    if (inPolygon([0, 1, 2, 5, 9, 13, 17].map((i) => pts[i]), x, y)) {
      // Palm normal from the index and pinky knuckles; its sign flips between hands.
      const v1 = { x: pts[5].x - pts[0].x, y: pts[5].y - pts[0].y };
      const v2 = { x: pts[17].x - pts[0].x, y: pts[17].y - pts[0].y };
      const cz = v1.x * v2.y - v1.y * v2.x;
      const palm = side.key === 'R' ? cz < 0 : cz > 0;
      return res(palm ? `${side.word} palm` : `Back of ${side.word.toLowerCase()} hand`, 'hand', idx);
    }
    if (dist(pts[0], { x, y }) < r * 1.6) return res(`${side.word} wrist`, 'wrist joint', idx);
  }

  // 2. Joints get priority over the limbs around them.
  for (const s of SIDES) {
    const near = (i, k) => vis(ctx.lm[i]) >= 0.5 && dist(px(i), { x, y }) < k * T;
    const index = (g) => ctx.list.findIndex((p) => p.group === g && p.side === s);
    if (near(s.kn, 0.075)) {
      return res(facing === 'front' ? `${s.word} kneecap` : facing === 'back' ? `Back of ${s.word.toLowerCase()} knee` : `${s.word} knee`, facing === 'back' ? 'hamstring and calf tendons (popliteal area)' : 'patella and knee joint', index('thigh'));
    }
    if (near(s.el, 0.06)) {
      return res(facing === 'back' ? `${s.word} elbow point` : facing === 'front' ? `${s.word} inner elbow` : `${s.word} elbow`, facing === 'back' ? 'olecranon — where the triceps attaches' : 'elbow joint', index('upperArm'));
    }
    if (near(s.wr, 0.045)) return res(`${s.word} wrist`, 'wrist joint', index('forearm'));
    if (near(s.an, 0.05)) return res(`${s.word} ankle`, 'ankle joint', index('lowerLeg'));
  }

  // 3. Coarse region, then refine within it.
  const i = hitTest(ctx, x, y, 0.35);
  if (i < 0) return null;
  const part = ctx.list[i];
  const pr = project(part.a, part.b, x, y);
  const t = pr.t;
  // Horizontal offset from the axis, in radii: + = outer side (front/back views), + = front (side view).
  const dx = (x - pr.q.x) / part.r;
  // Which of the person's own sides a torso point is on: facing the camera,
  // their left appears on the image right; from behind it's the image left.
  const sideOf = () => ((x > ctx.S.x) !== (facing === 'back') ? 'Left' : 'Right');
  const front = ctx.frontSign ? dx * ctx.frontSign : 0; // side view: + toward their front
  const s = part.side;
  const outer = s ? dx * Math.sign(partCenter(part).x - ctx.S.x || 1) : 0; // + away from the midline

  switch (part.group) {
    case 'head':
      return res(...faceName(ctx, x, y), i);
    case 'neck':
      if (facing === 'side') return res(front > 0 ? 'Throat' : 'Back of neck', front > 0 ? 'front of the neck' : 'neck extensors and upper traps', i);
      if (Math.abs((x - ctx.S.x) / (0.12 * T)) < 0.45) return res(facing === 'back' ? 'Back of neck' : 'Throat', facing === 'back' ? 'neck extensors' : 'front of the neck', i);
      return res(facing === 'back' ? `${sideOf()} upper trap` : `${sideOf()} side of neck`, facing === 'back' ? 'upper trapezius' : 'sternocleidomastoid', i);
    case 'chest':
    case 'core':
    case 'hips':
      return res(...torsoName(ctx, part.group, x, y, sideOf()), i);
    case 'shoulder':
      if (facing === 'side') return res(front > 0.3 ? `${s.word} front delt` : front < -0.3 ? `${s.word} rear delt` : `${s.word} side delt`, 'deltoid', i);
      if (outer > 0.5) return res(`${s.word} side delt`, 'lateral deltoid', i);
      return res(facing === 'back' ? `${s.word} rear delt` : `${s.word} front delt`, facing === 'back' ? 'posterior deltoid' : 'anterior deltoid', i);
    case 'upperArm': {
      const biceps = facing === 'side' ? front > 0 : facing !== 'back';
      if (facing !== 'side' && outer > 0.55) return res(`${s.word} outer upper arm`, biceps ? 'brachialis and lateral triceps' : 'lateral head of the triceps', i);
      return res(`${s.word} ${biceps ? 'biceps' : 'triceps'}`, biceps ? 'biceps brachii' : 'triceps brachii', i);
    }
    case 'forearm':
      if (t < 0.28) return res(`${s.word} upper forearm`, 'brachioradialis', i);
      if (facing === 'side') return res(`${s.word} forearm`, 'forearm flexors and extensors', i);
      return res(outer > 0 ? `${s.word} outer forearm` : `${s.word} inner forearm`, outer > 0 ? 'wrist extensors' : 'wrist flexors', i);
    case 'hand':
      return res(t < 0.45 ? `${s.word} hand` : `${s.word} fingers`, 'turn on Fingers for each finger', i);
    case 'finger':
      return res(`${s.word} hand`, 'hand', i);
    case 'thigh':
      if (facing === 'side') {
        if (front > 0.25) return res(`${s.word} quads`, 'quadriceps (front of the thigh)', i);
        if (front < -0.25) return res(`${s.word} hamstrings`, 'back of the thigh', i);
        return res(`${s.word} outer thigh`, 'IT band and vastus lateralis', i);
      }
      if (facing === 'back') {
        if (t < 0.15) return res(`${s.word} glute fold`, 'where the glute meets the hamstring', i);
        return res(outer > 0 ? `${s.word} outer hamstring` : `${s.word} inner hamstring`, outer > 0 ? 'biceps femoris' : 'semitendinosus and semimembranosus', i);
      }
      if (outer < -0.4) return res(t < 0.25 ? `${s.word} groin` : `${s.word} inner thigh`, t < 0.25 ? 'adductors and hip flexor tendon' : 'adductors', i);
      if (outer > 0.45) return res(`${s.word} outer quad`, 'vastus lateralis', i);
      if (t > 0.65 && outer < 0) return res(`${s.word} inner quad`, 'vastus medialis (teardrop)', i);
      return res(`${s.word} quads`, 'rectus femoris — front of the thigh', i);
    case 'lowerLeg':
      if (facing === 'side') {
        if (front > 0.2) return res(`${s.word} shin`, 'tibialis anterior', i);
        return res(t > 0.62 ? `${s.word} Achilles` : `${s.word} calf`, t > 0.62 ? 'Achilles tendon and soleus' : 'gastrocnemius', i);
      }
      if (facing === 'back') {
        if (t > 0.62) return res(`${s.word} lower calf`, 'soleus and Achilles tendon', i);
        return res(`${s.word} calf — ${outer > 0 ? 'outer' : 'inner'} head`, 'gastrocnemius', i);
      }
      if (outer < -0.35) return res(`${s.word} inner calf`, 'medial gastrocnemius', i);
      return res(`${s.word} shin`, outer > 0.45 ? 'peroneals' : 'tibialis anterior', i);
    case 'foot':
      if (t < 0.28) return res(`${s.word} heel`, 'heel (calcaneus)', i);
      if (t > 0.75) return res(`${s.word} toes`, 'toes', i);
      return res(facing === 'side' ? `${s.word} arch` : `Top of ${s.word.toLowerCase()} foot`, 'midfoot', i);
    default:
      return res(regionLabel(part, ctx), '', i);
  }
}

function torsoName(ctx, group, x, y, side) {
  const { S, Hc, T, facing } = ctx;
  const ax = { x: Hc.x - S.x, y: Hc.y - S.y };
  const tt = ((x - S.x) * ax.x + (y - S.y) * ax.y) / (T * T); // 0 at the shoulders, 1 at the hips
  const half = Math.max(dist(ctx.px(P.leftShoulder), ctx.px(P.rightShoulder)) / 2, 0.2 * T);
  const q = { x: S.x + ax.x * tt, y: S.y + ax.y * tt };
  const u = Math.abs((x - q.x) / half); // 0 on the midline, ~1 at the shoulder line

  if (facing === 'side') {
    const f = ctx.frontSign ? ((x - q.x) * ctx.frontSign) / (0.3 * T) : 0;
    if (group === 'chest') return f > 0.25 ? ['Chest', 'pectorals'] : f < -0.25 ? (tt < 0.25 ? ['Traps', 'trapezius'] : ['Upper back', 'lats and rhomboids']) : ['Ribs', 'serratus anterior and lats'];
    if (group === 'core') return f > 0.25 ? ['Abs', 'rectus abdominis'] : f < -0.25 ? ['Lower back', 'erector spinae'] : ['Obliques', 'side of the waist'];
    return f > 0.2 ? ['Hip flexors', 'iliopsoas and rectus femoris'] : f < -0.2 ? ['Glutes', 'gluteus maximus'] : ['Side of the hip', 'gluteus medius'];
  }

  if (facing === 'back') {
    if (group === 'chest') {
      if (tt < 0.22) return u < 0.6 ? ['Upper traps', 'trapezius'] : [`${side} rear shoulder`, 'rear delt and infraspinatus'];
      if (u < 0.12) return ['Spine (upper back)', 'thoracic spine'];
      return u > 0.55 ? [`${side} lat`, 'latissimus dorsi'] : [`${side} mid back`, 'rhomboids and middle traps'];
    }
    if (group === 'core') {
      if (u < 0.12) return ['Spine (lower back)', 'lumbar spine'];
      return u < 0.55 ? [`${side} lower back`, 'erector spinae'] : [`${side} lower lat`, 'lats and quadratus lumborum'];
    }
    if (u < 0.12) return ['Tailbone', 'sacrum and coccyx'];
    return u > 0.85 ? [`${side} upper glute`, 'gluteus medius'] : [`${side} glute`, 'gluteus maximus'];
  }

  if (group === 'chest') {
    if (tt < 0.1 && u < 0.6) return ['Collarbones', 'clavicles'];
    if (u < 0.1) return ['Sternum', 'breastbone'];
    if (u > 0.85) return tt < 0.3 ? [`${side} armpit`, 'axilla'] : [`${side} side ribs`, 'serratus anterior'];
    return tt < 0.24 ? [`${side} upper chest`, 'clavicular head of the pec'] : [`${side} pec`, 'pectoralis major'];
  }
  if (group === 'core') {
    if (u < 0.4) return tt < 0.66 ? ['Upper abs', 'rectus abdominis'] : ['Lower abs', 'rectus abdominis'];
    return [`${side} obliques`, 'external obliques'];
  }
  if (u < 0.35) return tt > 1.04 ? ['Groin', 'pubic area'] : ['Lower belly', 'lower abs and pelvis'];
  return u > 0.9 ? [`${side} hip bone`, 'iliac crest'] : [`${side} hip flexor`, 'iliopsoas'];
}

function faceName(ctx, x, y) {
  const { lm, px, facing } = ctx;
  const p = { x, y };
  if (facing === 'back') {
    const earY = (px(P.leftEar).y + px(P.rightEar).y) / 2;
    return y > earY ? ['Base of the skull', 'upper neck muscles'] : ['Back of the head', 'occipital scalp'];
  }
  const seen = (i) => vis(lm[i]) >= 0.5;
  const le = px(2), re = px(5);
  const E = seen(2) && seen(5) ? Math.max(dist(le, re), 4) : 0.12 * ctx.T;
  for (const s of SIDES) if (seen(s.ear) && dist(px(s.ear), p) < 0.35 * E) return [`${s.word} ear`, 'ear'];
  for (const s of SIDES) if (seen(s.eye) && dist(px(s.eye), p) < 0.3 * E) return [`${s.word} eye`, 'eye and eyelid'];
  if (seen(P.nose) && dist(px(P.nose), p) < 0.28 * E) return ['Nose', 'nose'];
  const mouth = seen(9) && seen(10) ? lerp2(px(9), px(10), 0.5) : null;
  if (mouth && dist(mouth, p) < 0.35 * E) return ['Mouth', 'lips'];
  if (facing === 'side') {
    const front = ctx.frontSign ? (x - ctx.headC.x) * ctx.frontSign : 0;
    return front > 0 ? ['Face', 'cheek and jaw'] : ['Back of the head', 'scalp'];
  }
  const eyeY = seen(2) && seen(5) ? (le.y + re.y) / 2 : px(P.nose).y - 0.3 * E;
  if (y < eyeY - 0.95 * E) return ['Top of the head', 'scalp'];
  if (y < eyeY - 0.2 * E) return ['Forehead', 'frontalis'];
  if (mouth && y > mouth.y + 0.25 * E) return ['Chin & jaw', 'mandible'];
  const nx = seen(P.nose) ? px(P.nose).x : ctx.headC.x;
  // Facing the camera, the person's left is the image right.
  if (Math.abs(x - nx) > 0.55 * E) return [`${x > nx ? 'Left' : 'Right'} cheek`, 'cheek'];
  return ['Face', 'midface'];
}
