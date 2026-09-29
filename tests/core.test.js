import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp, ramp } from './body3d.js';
import { DeadBugAnalyzer, CrunchAnalyzer, ReverseCrunchAnalyzer, SidePlankReachAnalyzer, RolloutAnalyzer, RockAnalyzer, ReverseHyperAnalyzer } from '../js/exercises/core.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const r = (d) => (d * Math.PI) / 180;
const side = (j, o = {}) => film(j, { view: 'side', offset: [640, 420], ...o });

// ---------- dead bugs: on your back, 90/90, opposite arm and leg reach long
const deadBug = (t, legSide = 0, { armSide = 1 - legSide, reach = 1 } = {}) => {
  const k = t * reach;
  const legs = [{ hip: 90, knee: 90 }, { hip: 90, knee: 90 }];
  const arms = [{ flex: 90 }, { flex: 90 }];
  legs[legSide] = { hip: lerp(90, 12, k), knee: lerp(90, 8, k) };
  arms[armSide] = { flex: lerp(90, 172, k) };
  return side(skeleton({ rot: { pitch: -90 }, legs, arms }), { farVis: 0.6 });
};

test('dead bugs: counts slow reps on each side', () => {
  const an = new DeadBugAnalyzer();
  const poses = [0, 1, 0, 1].flatMap((s) => cycle(3.2).map((t) => deadBug(t, s)));
  play(an, poses);
  assert.equal(an.count, 4);
  assert.equal(an.sideCount.L + an.sideCount.R, 4);
  assert.ok(an.sideCount.L >= 1 && an.sideCount.R >= 1);
});

test('dead bugs: short reaches are not counted; rushing is called out', () => {
  const short = new DeadBugAnalyzer();
  play(short, reps(2, (t) => deadBug(t, 0, { reach: 0.4 }), 3));
  assert.equal(short.count, 0);

  const rush = new DeadBugAnalyzer();
  const out = repsOf(play(rush, reps(2, (t) => deadBug(t, 0), 1)));
  assert.ok(out.length >= 1);
  assert.ok(out.every((x) => x.issues.includes('rush')), JSON.stringify(out.map((x) => x.issues)));
});

// ---------- overhead dumbbell crunch on a bench
const crunch = (t, { lift = 22, swing = 0 } = {}) => {
  const lean = lift * t;
  const a = r(lean);
  const s = r(swing * t);
  // Arms along the torso past the head (body "up" tilted by the curl), swung forward by `swing`.
  const dir = [0, -Math.cos(a + s), -Math.sin(a + s)];
  const arm = { dir, fore: dir };
  return side(skeleton({ rot: { pitch: -90 }, lean, arms: [arm, arm], legs: [{ hip: 45, knee: 90 }, { hip: 45, knee: 90 }] }));
};

test('crunches: counts curls that lift the shoulder blades', () => {
  const an = new CrunchAnalyzer();
  play(an, reps(3, (t) => crunch(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('crunches: tiny curls and swinging the dumbbell are not counted', () => {
  const small = new CrunchAnalyzer();
  play(small, reps(2, (t) => crunch(t, { lift: 8 })));
  assert.equal(small.count, 0);

  const swing = new CrunchAnalyzer();
  const out = repsOf(play(swing, reps(2, (t) => crunch(t, { swing: 80 }))));
  assert.equal(swing.count, 0);
  assert.ok(out.every((x) => x.issues.includes('swing')), JSON.stringify(out.map((x) => x.issues)));
});

// ---------- reverse crunches: knees at 90°, hips curl up off the bench
const revCrunch = (t, { lift = 12, knees = 25, noLift = false } = {}) => {
  const up = noLift ? 0 : lift * t;
  const legs = [{ hip: 90 + knees * t, knee: 90 }, { hip: 90 + knees * t, knee: 90 }];
  return side(skeleton({ rot: { pitch: -90 - up }, legs, arms: [{ flex: 170 }, { flex: 170 }] }));
};

test('reverse crunches: counts curls that lift the hips', () => {
  const an = new ReverseCrunchAnalyzer();
  play(an, reps(3, (t) => revCrunch(t), 3));
  assert.equal(an.count, 3);
});

test('reverse crunches: swinging the legs without lifting the hips is not counted', () => {
  const an = new ReverseCrunchAnalyzer();
  const events = play(an, reps(2, (t) => revCrunch(t, { noLift: true, knees: 50 }), 3));
  assert.equal(an.count, 0);
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'swing') || repsOf(events).length === 0);
});

// ---------- side plank with reach-through, filmed from the front
// Lying on the left side (roll 70). Directions in the body frame, x = away from the midline.
const bodyDir = (world) => {
  // Undo roll 70 about the camera axis: body = R(−70)·world.
  const c = Math.cos(r(70)), s = Math.sin(r(70));
  return [c * world[0] + s * world[1], -s * world[0] + c * world[1], world[2]];
};
const sidePlank = (t, { reach = 1, sag = 0 } = {}) => {
  const down = bodyDir([0, 1, 0]);
  const upW = [0, -1, 0];
  const underW = [0, 0.9, -0.45];
  const w = [lerp(upW[0], underW[0], t * reach), lerp(upW[1], underW[1], t * reach), lerp(upW[2], underW[2], t * reach)];
  const b = bodyDir(w);
  const top = { dir: [-b[0], b[1], b[2]], fore: [-b[0], b[1], b[2]] }; // right arm: "out" is −x
  const bottom = { dir: down, elbow: 90, plane: 'forward' };
  const j = skeleton({ rot: { roll: 70 }, arms: [bottom, top] });
  for (const n of ['leftHip', 'rightHip']) j[n] = [j[n][0], j[n][1] + sag, j[n][2]];
  return film(j, { view: 'front', offset: [640, 360] });
};

test('side plank reach-through: counts threads under and back', () => {
  const an = new SidePlankReachAnalyzer();
  play(an, reps(3, (t) => sidePlank(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.sideCount.R, 3);
});

test('side plank reach-through: a short reach is not counted; sagging hips are called out', () => {
  const short = new SidePlankReachAnalyzer();
  play(short, reps(2, (t) => sidePlank(t, { reach: 0.45 }), 3));
  assert.equal(short.count, 0);

  const sag = new SidePlankReachAnalyzer();
  const events = play(sag, reps(1, (t) => sidePlank(t, { sag: 0.09 * t }), 3));
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'sag'));
});

// ---------- ab wheel rollouts, built joint by joint (side-on, facing image left = −z)
const FLOOR = 0.9;
function rig({ sh, el, wr, hip, knee, ank }) {
  const j = skeleton();
  const set = (name, p, dx) => (j[name] = [dx, p[1], p[0]]);
  for (const [s, dx] of [['left', 0.1], ['right', -0.1]]) {
    set(`${s}Shoulder`, sh, dx * 1.9);
    set(`${s}Elbow`, el, dx * 1.9);
    set(`${s}Wrist`, wr, dx * 1.9);
    set(`${s}Index`, [wr[0] - 0.05, wr[1] + 0.03], dx * 1.9);
    set(`${s}Pinky`, [wr[0] - 0.05, wr[1] + 0.03], dx * 1.9);
    set(`${s}Thumb`, [wr[0] - 0.03, wr[1] + 0.02], dx * 1.9);
    set(`${s}Hip`, hip, dx);
    set(`${s}Knee`, knee, dx);
    set(`${s}Ankle`, ank, dx);
    set(`${s}Heel`, [ank[0] + 0.04, ank[1] + 0.03], dx);
    set(`${s}Foot`, [ank[0] - 0.12, ank[1] + 0.05], dx);
  }
  // Head beyond the shoulders along the torso, face toward the floor-ish.
  const d = [sh[0] - hip[0], sh[1] - hip[1]];
  const l = Math.hypot(...d);
  const u = [d[0] / l, d[1] / l];
  const head = [sh[0] + u[0] * 0.24, sh[1] + u[1] * 0.24];
  const n = [u[1], -u[0]]; // one normal; flip toward the floor
  const face = n[1] > 0 ? n : [-n[0], -n[1]];
  j.leftEar = [0.07, head[1], head[0]];
  j.rightEar = [-0.07, head[1], head[0]];
  j.nose = [0, head[1] + face[1] * 0.08, head[0] + face[0] * 0.08];
  return j;
}
const at = (p, len, deg) => [p[0] - len * Math.sin(r(deg)), p[1] - len * Math.cos(r(deg))]; // deg from straight up, toward −z (forward)

// Kneeling: knee on the floor; thigh leans forward by `phi`; torso by `psi`; arms reach the wheel.
function kneelRollout(t, { out = 1, sag = 0, bend = 0 } = {}) {
  const k = t * out;
  const knee = [0, FLOOR];
  const ank = [0.4, FLOOR];
  const hip0 = at(knee, 0.43, lerp(0, 72, k));
  const sh = at(hip0, 0.5, lerp(55, 88, k));
  const hip = [hip0[0], hip0[1] + sag * Math.max(0, 2 * k - 1)]; // sags as it nears full extension
  const wheel = [sh[0] - lerp(0.1, 0.56, k), FLOOR - 0.08];
  const mid = [(sh[0] + wheel[0]) / 2, (sh[1] + wheel[1]) / 2];
  const el = [mid[0] + bend * 0.1, mid[1] - bend * 0.1];
  return side(rig({ sh, el, wr: wheel, hip, knee, ank }), { offset: [640, 200] });
}

test('ab wheel: counts kneeling rollouts to full extension', () => {
  const an = new RolloutAnalyzer({ stance: 'kneel', reach: 'full' });
  play(an, reps(3, (t) => kneelRollout(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('ab wheel: short rollouts count only for the wall version', () => {
  const full = new RolloutAnalyzer({ stance: 'kneel', reach: 'full' });
  play(full, reps(2, (t) => kneelRollout(t, { out: 0.7 }), 3));
  assert.equal(full.count, 0);

  const wall = new RolloutAnalyzer({ stance: 'kneel', reach: 'wall' });
  play(wall, reps(2, (t) => kneelRollout(t, { out: 0.7 }), 3));
  assert.equal(wall.count, 2);
});

test('ab wheel: a sagging lower back is not counted', () => {
  const an = new RolloutAnalyzer({ stance: 'kneel', reach: 'full' });
  const out = repsOf(play(an, reps(2, (t) => kneelRollout(t, { sag: 0.22 }), 3)));
  assert.equal(an.count, 0);
  assert.ok(out.every((x) => x.issues.includes('sag')), JSON.stringify(out.map((x) => x.issues)));
  assert.equal(an.voiceLine({ type: 'rep', rep: out[0] }), 'Tuck your hips');
});

// ---------- hollow body rocks: on your back, fixed shape, the whole body rocks
const hollowRock = (t, { rock = 9, bend = 0 } = {}) => {
  const tilt = rock * Math.cos(Math.PI * 2 * t) - rock / 2;
  const hip = 25 + bend * Math.sin(Math.PI * t);
  return side(skeleton({ rot: { pitch: -90 + tilt }, lean: 18, arms: [{ flex: 175 }, { flex: 175 }], legs: [{ hip }, { hip }] }));
};

test('hollow rocks: counts rocks that keep the shape', () => {
  const an = new RockAnalyzer({ shape: 'hollow' });
  const ts = Array.from({ length: 4 }, () => ramp(0, 1, 1.2)).flat();
  play(an, [...hold(hollowRock(0), 0.5), ...ts.map((t) => hollowRock(t))]);
  assert.ok(an.count >= 3, `counted ${an.count}`);
});

test('hollow rocks: bending at the hips to rock is not counted', () => {
  const an = new RockAnalyzer({ shape: 'hollow' });
  const ts = Array.from({ length: 3 }, () => ramp(0, 1, 1.2)).flat();
  const out = repsOf(play(an, [...hold(hollowRock(0, { bend: 30 }), 0.5), ...ts.map((t) => hollowRock(t, { bend: 30 }))]));
  assert.equal(an.count, 0);
  assert.ok(out.length >= 1 && out.every((x) => x.issues.includes('shape') || x.issues.includes('depth')), JSON.stringify(out.map((x) => x.issues)));
});

// ---------- reverse hypers: face down, legs hang off the bench end and rise to level
const revHyper = (t, { top = 1, knees = 0, arch = 0 } = {}) => {
  const hip = lerp(80, -arch, t * top);
  return side(skeleton({ rot: { pitch: 90 }, legs: [{ hip, knee: knees * t }, { hip, knee: knees * t }], arms: [{ flex: 90 }, { flex: 90 }] }));
};

test('reverse hypers: counts lifts to level', () => {
  const an = new ReverseHyperAnalyzer();
  play(an, reps(3, (t) => revHyper(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('reverse hypers: bent knees are not counted; lifting past level is called out', () => {
  const knees = new ReverseHyperAnalyzer();
  const out = repsOf(play(knees, reps(2, (t) => revHyper(t, { knees: 70 }), 3)));
  assert.equal(knees.count, 0);
  assert.ok(out.every((x) => x.issues.includes('knees') || x.issues.includes('depth')), JSON.stringify(out.map((x) => x.issues)));

  const arch = new ReverseHyperAnalyzer();
  const events = play(arch, reps(1, (t) => revHyper(t, { arch: 25 }), 3));
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'arch'));
});

test('core: standing up is not any of the floor positions', () => {
  const standing = side(skeleton());
  for (const an of [new DeadBugAnalyzer(), new CrunchAnalyzer(), new ReverseCrunchAnalyzer(), new ReverseHyperAnalyzer()]) {
    assert.equal(playViews(an, hold(standing, 0.3)).at(-1).status, 'setup', an.constructor.name);
  }
});
