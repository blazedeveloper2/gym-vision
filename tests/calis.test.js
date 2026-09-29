import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp, ramp } from './body3d.js';
import { pushupPose, run as run2d, ramp as ramp2d, hold as hold2d } from './synthetic.js';
import { PushVariantAnalyzer, PikePushupAnalyzer, HSPUAnalyzer, ScapPushupAnalyzer, WristRockAnalyzer, StraddlePressAnalyzer } from '../js/exercises/calis.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const F = 0.9; // floor height (world y)

/** Elbow between a shoulder and a hand for a two-link arm (0.3 + 0.27 m), bending toward `bend`. */
function elbowAt(s, w, bend) {
  const d = [w[0] - s[0], w[1] - s[1], w[2] - s[2]];
  const L = Math.min(Math.hypot(...d), 0.5699);
  const u = d.map((v) => v / Math.hypot(...d));
  const a = (0.09 + L * L - 0.0729) / (2 * L);
  const h = Math.sqrt(Math.max(0, 0.09 - a * a));
  // Component of `bend` perpendicular to the arm.
  const k = bend[0] * u[0] + bend[1] * u[1] + bend[2] * u[2];
  let n = bend.map((v, i) => v - k * u[i]);
  const nl = Math.hypot(...n) || 1;
  n = n.map((v) => v / nl);
  return s.map((v, i) => v + u[i] * a + n[i] * h);
}

/** Joints from world points; `p` gives left-side points as [x, y, z], mirrored for the right unless given. */
function rig(p) {
  const j = skeleton();
  const mirror = (q) => [-q[0], q[1], q[2]];
  for (const s of ['left', 'right']) {
    const g = (k) => (s === 'left' ? p[k] : p[`r${k}`] ?? (p[k] && mirror(p[k])));
    j[`${s}Shoulder`] = g('sh');
    j[`${s}Wrist`] = g('wr');
    j[`${s}Elbow`] = elbowAt(g('sh'), g('wr'), s === 'left' ? p.bend : p.rbend ?? mirror(p.bend));
    for (const n of ['Index', 'Pinky', 'Thumb']) j[`${s}${n}`] = [g('wr')[0], g('wr')[1] + 0.03, g('wr')[2] - 0.06];
    j[`${s}Hip`] = g('hip');
    j[`${s}Knee`] = g('knee');
    j[`${s}Ankle`] = g('ank');
    j[`${s}Heel`] = [g('ank')[0], g('ank')[1] + 0.03, g('ank')[2] + 0.05];
    j[`${s}Foot`] = g('toe') ?? [g('ank')[0], g('ank')[1] + 0.06, g('ank')[2] - 0.12];
  }
  j.nose = p.nose;
  j.leftEar = [0.07, p.ear[1], p.ear[2]];
  j.rightEar = [-0.07, p.ear[1], p.ear[2]];
  return j;
}

// ---------- front view: plank facing the camera (the camera is at −z, low)
// h = shoulder height above the hands (m): 0.57 locked out → ~0.3 chest near the floor.
function frontPlank(h, { handX = 0.2, shiftX = 0, oneArm = false, straightOther = false, feetApart = 0.16 } = {}) {
  const wy = F - 0.04;
  const sy = wy - h;
  const sh = [0.19 + shiftX, sy, 0];
  const rsh = [-0.19 + shiftX, sy, 0];
  const wr = [handX, wy, -0.03];
  const rwr = oneArm ? [-0.1, sy + 0.05, 0.45] : [-handX, wy, -0.03];
  return film(
    rig({
      sh, rsh, wr, rwr,
      bend: [0.15, 0, 1],
      rbend: straightOther ? [-1, 0, 0] : oneArm ? [0, 0, 1] : [-0.15, 0, 1],
      hip: [0.1, sy + 0.12, 0.5],
      knee: [0.09, sy + 0.25, 0.95],
      ank: [feetApart / 2, sy + 0.38, 1.4],
      rank: [-feetApart / 2, sy + 0.38, 1.4],
      nose: [shiftX, sy - 0.12, -0.2],
      ear: [0, sy - 0.14, -0.1],
    }),
    { view: 'front', offset: [640, 200] },
  );
}
const pushCycle = (n, fn, secs = 2.4) => reps(n, (t) => fn(lerp(0.57, 0.3, t)), secs);

test('diamond push-ups (front): counts reps with the hands together', () => {
  const an = new PushVariantAnalyzer({ variant: 'diamond' });
  play(an, pushCycle(3, (h) => frontPlank(h, { handX: 0.05 })));
  assert.equal(an.count, 3);
});

test('diamond push-ups (front): hands at normal width are not counted', () => {
  const an = new PushVariantAnalyzer({ variant: 'diamond' });
  const out = repsOf(play(an, pushCycle(2, (h) => frontPlank(h, { handX: 0.25 }))));
  assert.equal(an.count, 0);
  assert.ok(out.every((r) => r.issues.includes('wide')), JSON.stringify(out.map((r) => r.issues)));
  assert.equal(an.voiceLine({ type: 'rep', rep: out[0] }), 'Hands together');
});

test('push-ups (front): shallow reps are not counted', () => {
  const an = new PushVariantAnalyzer({ variant: 'diamond' });
  play(an, reps(2, (t) => frontPlank(lerp(0.57, 0.46, t), { handX: 0.05 })));
  assert.equal(an.count, 0);
});

test('archer push-ups: counts reps to each side with the other arm straight', () => {
  const an = new PushVariantAnalyzer({ variant: 'archer', frontBottom: 0.7 });
  // Hands about twice shoulder width; the body shifts over the left hand and lowers on it.
  // The shoulders slide sideways just enough for the long arm to stay straight.
  const archer = (t, dir = 1) => {
    const h = lerp(0.52, 0.3, t);
    return frontPlank(h, { handX: 0.42, shiftX: dir * (Math.sqrt(0.3249 - h * h) - 0.23), straightOther: true });
  };
  play(an, [...reps(2, (t) => archer(t, 1)), ...reps(1, (t) => archer(t, -1))]);
  assert.ok(an.count >= 2, `counted ${an.count}`);
});

test('archer push-ups: hands at shoulder width are not the archer setup', () => {
  const an = new PushVariantAnalyzer({ variant: 'archer' });
  assert.equal(playViews(an, hold(frontPlank(0.57), 0.5)).at(-1).status, 'setup');
});

test('one-arm push-ups: counts reps with the free hand off the floor, not with both hands', () => {
  const one = new PushVariantAnalyzer({ variant: 'oneArm' });
  play(one, pushCycle(3, (h) => frontPlank(h, { oneArm: true })));
  assert.equal(one.count, 3);

  const two = new PushVariantAnalyzer({ variant: 'oneArm' });
  assert.equal(playViews(two, hold(frontPlank(0.57), 0.5)).at(-1).status, 'setup');
});

test('one-arm push-ups, feet together: feet apart is not the setup', () => {
  const an = new PushVariantAnalyzer({ variant: 'oneArm', feetTogether: true });
  assert.equal(playViews(an, hold(frontPlank(0.57, { oneArm: true, feetApart: 0.6 }), 0.5)).at(-1).status, 'setup');
  const ok = new PushVariantAnalyzer({ variant: 'oneArm', feetTogether: true });
  play(ok, pushCycle(2, (h) => frontPlank(h, { oneArm: true, feetApart: 0.1 })));
  assert.equal(ok.count, 2);
});

test('decline push-ups (side): feet on the floor is not a decline', () => {
  const pushup = (min, ankle) => [...hold2d(170, 0.4), ...ramp2d(170, min, 0.8), ...hold2d(min, 0.2), ...ramp2d(min, 170, 0.8)].map((elbow) => pushupPose({ elbow, ankle }));
  const flat = new PushVariantAnalyzer({ feetUp: true });
  run2d(flat, pushup(85));
  assert.equal(flat.count, 0);
  const up = new PushVariantAnalyzer({ feetUp: true });
  run2d(up, [...pushup(85, { x: 1000, y: 360 }), ...pushup(85, { x: 1000, y: 360 })]);
  assert.equal(up.count, 2);
});

// ---------- side-on rigs, facing image left (−z)
const sideRig = (p) => film(rig(p), { view: 'side', offset: [640, 200] });

// Pike push-up: hands down, hips high, head lowering in front of the hands.
function pike(t, { depth = 1, headBack = 0, hipsDown = 0, elevated = false } = {}) {
  const k = t * depth;
  const wr = [0.19, F - 0.04, 0];
  const sy = lerp(F - 0.6, F - 0.35, k);
  const sh = [0.19, sy, lerp(0.05, -0.08, k)];
  const hip = elevated ? [0.1, sy - 0.5, sh[2] + 0.12] : [0.1, sy - 0.35 + hipsDown * k, sh[2] + 0.45 + hipsDown * k];
  const knee = elevated ? [0.1, sy - 0.5, hip[2] + 0.43] : [0.1, hip[1] + 0.25, hip[2] + 0.35];
  const ank = elevated ? [0.1, sy - 0.48, hip[2] + 0.85] : [0.1, F - 0.08, hip[2] + 0.75];
  return sideRig({
    sh, wr, hip, knee, ank, bend: [0, 0, 1],
    nose: [0, sy + 0.2, sh[2] - 0.05 + headBack * k],
    ear: [0, sy + 0.18, sh[2] + 0.04],
  });
}

test('pike push-ups: counts deep reps with the head going in front of the hands', () => {
  const an = new PikePushupAnalyzer();
  play(an, reps(3, (t) => pike(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('pike push-ups: shallow reps are not counted; head between the hands is called out', () => {
  const shallow = new PikePushupAnalyzer();
  play(shallow, reps(2, (t) => pike(t, { depth: 0.45 })));
  assert.equal(shallow.count, 0);

  const head = new PikePushupAnalyzer();
  const out = repsOf(play(head, reps(1, (t) => pike(t, { headBack: 0.3 }))));
  assert.ok(out[0].issues.includes('head'), JSON.stringify(out[0].issues));
});

test('elevated pike push-ups: feet on the floor is not the setup', () => {
  const an = new PikePushupAnalyzer({ elevated: true });
  assert.equal(playViews(an, hold(pike(0), 0.5)).at(-1).status, 'setup');
  const ok = new PikePushupAnalyzer({ elevated: true });
  play(ok, reps(2, (t) => pike(t, { elevated: true })));
  assert.equal(ok.count, 2);
});

// Handstand push-up: upside down; shoulders come down toward the hands.
function hspu(t, { depth = 1, kick = 0 } = {}) {
  const k = t * depth;
  const wr = [0.19, F - 0.04, 0];
  const sy = lerp(F - 0.6, F - 0.3, k);
  const sh = [0.19, sy, 0.02];
  const hip = [0.1, sy - 0.5, 0.05];
  const kk = kick * Math.sin(Math.PI * t);
  const knee = [0.1, hip[1] - 0.43 * Math.cos(kk), hip[2] - 0.43 * Math.sin(kk)];
  const ank = [0.1, knee[1] - 0.42, knee[2] + 0.02];
  return sideRig({ sh, wr, hip, knee, ank, bend: [0, 0, 1], nose: [0, sy + 0.22, -0.06], ear: [0, sy + 0.2, 0.04] });
}

test('wall handstand push-ups: counts full reps to the floor', () => {
  const an = new HSPUAnalyzer();
  play(an, reps(3, (t) => hspu(t)));
  assert.equal(an.count, 3);
});

test('wall handstand push-ups: half reps and kicking up are not counted', () => {
  const half = new HSPUAnalyzer();
  play(half, reps(2, (t) => hspu(t, { depth: 0.5 })));
  assert.equal(half.count, 0);

  const kick = new HSPUAnalyzer();
  const out = repsOf(play(kick, reps(2, (t) => hspu(t, { kick: 1.1 }))));
  assert.equal(kick.count, 0);
  assert.ok(out.every((r) => r.issues.includes('kick')), JSON.stringify(out.map((r) => r.issues)));
});

test('handstand push-up negatives: slow lowerings count, fast drops do not', () => {
  const slow = new HSPUAnalyzer({ negativeMs: 2200 });
  const down = (secs) => [...hold(0, 0.5), ...ramp(0, 1, secs), ...hold(1, 0.4)];
  const standing = film(skeleton(), { view: 'side' });
  play(slow, [...down(3.5).map((t) => hspu(t)), ...hold(standing, 1), ...down(3.5).map((t) => hspu(t)), ...hold(standing, 1)]);
  assert.equal(slow.count, 2);

  const fast = new HSPUAnalyzer({ negativeMs: 2200 });
  const out = repsOf(play(fast, [...down(0.8).map((t) => hspu(t)), ...hold(standing, 1)]));
  assert.equal(fast.count, 0);
  assert.ok(out[0].issues.includes('fast'));
});

// Scapular push-ups: plank with locked arms; the head/chest sinks between the shoulder blades.
function scapPlank(sink, { elbow = 172, hips = 0.6 } = {}) {
  const lm = pushupPose({ elbow });
  for (const i of [0, 7, 8, 2, 5, 9, 10]) lm[i] = { ...lm[i], y: lm[i].y + sink / 720 };
  for (const i of [23, 24]) lm[i] = { ...lm[i], y: lm[i].y + (hips * sink) / 720 };
  return lm;
}

test('scapular push-ups: counts shoulder-blade reps with locked arms', () => {
  const an = new ScapPushupAnalyzer();
  const one = [...hold2d(0, 0.5), ...ramp2d(0, 1, 0.6), ...hold2d(1, 0.3), ...ramp2d(1, 0, 0.6)];
  run2d(an, [1, 2, 3].flatMap(() => one).map((k) => scapPlank(28 * k)));
  assert.equal(an.count, 3);
});

test('scapular push-ups: bending the elbows is not counted', () => {
  const an = new ScapPushupAnalyzer();
  const one = [...hold2d(0, 0.5), ...ramp2d(0, 1, 0.6), ...hold2d(1, 0.3), ...ramp2d(1, 0, 0.6)];
  const out = repsOf2(run2d(an, [1, 2].flatMap(() => one).map((k) => scapPlank(28 * k, { elbow: 172 - 45 * k }))));
  assert.equal(an.count, 0);
  assert.ok(out.every((r) => r.issues.includes('bent')), JSON.stringify(out.map((r) => r.issues)));
});
const repsOf2 = (events) => events.filter((e) => e.type === 'rep').map((e) => e.rep);

// Wrist prep rocks: on all fours, shoulders rock forward past the hands.
function fours(shift, { elbowBend = 0 } = {}) {
  const wr = [0.19, F - 0.04, 0];
  const sh = [0.19, F - 0.6 + elbowBend * 0.1, -shift];
  const hip = [0.1, F - 0.6, 0.5 - shift * 0.5];
  return sideRig({ sh, wr, hip, knee: [0.1, F - 0.08, 0.52], ank: [0.1, F - 0.06, 0.95], toe: [0.1, F - 0.02, 1.05], bend: [0, 0, 1], nose: [0, F - 0.62, -0.28 - shift], ear: [0, F - 0.66, -0.2 - shift] });
}

test('wrist prep rocks: counts slow forward rocks', () => {
  const an = new WristRockAnalyzer();
  const one = [...hold(0, 0.5), ...ramp(0, 1, 1), ...hold(1, 0.2), ...ramp(1, 0, 1)];
  play(an, [1, 2, 3].flatMap(() => one).map((k) => fours(0.16 * k)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

// Straddle press: from a fold (hips over the feet, hands down) up to a handstand.
function press(t, { hop = false } = {}) {
  const wr = [0.19, F - 0.04, 0];
  const sh = [0.19, F - 0.6, lerp(0.15, 0.02, Math.min(1, t * 1.5))];
  // Hips rise over the hands first; the legs come up once they're there (or, hopping, straight away).
  const hipUp = Math.min(1, t * 2.2);
  const hip = [0.1, lerp(F - 0.95, F - 1.1, hipUp), lerp(0.55, 0.05, hipUp)];
  const legT = hop ? Math.min(1, t * 1.3) : Math.max(0, (t - 0.45) / 0.55);
  // Feet stay planted behind until they float, then swing up to straight overhead.
  const down = [0.25, F - 0.08, 0.75];
  const up = [0.25, hip[1] - 0.85, hip[2] + 0.02];
  const ank = down.map((v, i) => lerp(v, up[i], legT));
  const knee = [0.2, (hip[1] + ank[1]) / 2, (hip[2] + ank[2]) / 2];
  return sideRig({ sh, wr, hip, knee, ank, toe: [ank[0], ank[1] + 0.05, ank[2] - 0.1], bend: [0, 0, 1], nose: [0, sh[1] + 0.22, sh[2] - 0.06], ear: [0, sh[1] + 0.2, sh[2] + 0.04] });
}

test('straddle press: counts presses to handstand', () => {
  const an = new StraddlePressAnalyzer();
  const one = [...hold(0, 0.6), ...ramp(0, 1, 2), ...hold(1, 0.4), ...ramp(1, 0, 2)];
  play(an, [1, 2].flatMap(() => one).map((t) => press(t)));
  assert.equal(an.count, 2);
});

test('straddle press: hopping the feet up before the hips are over the hands is not counted', () => {
  const an = new StraddlePressAnalyzer();
  const one = [...hold(0, 0.6), ...ramp(0, 1, 2), ...hold(1, 0.4), ...ramp(1, 0, 2)];
  const out = repsOf(play(an, one.map((t) => press(t, { hop: true }))));
  assert.equal(an.count, 0);
  assert.ok(out[0].issues.includes('hop'), JSON.stringify(out[0].issues));
});
