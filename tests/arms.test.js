import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp } from './body3d.js';
import { PreacherCurlAnalyzer, InclineCurlAnalyzer, OverheadExtensionAnalyzer, WristCurlAnalyzer } from '../js/exercises/arms.js';
import { CurlAnalyzer } from '../js/exercises/curl.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const r = (d) => (d * Math.PI) / 180;
// A direction in the body's side plane: `below` degrees below horizontal, pointing forward (−z).
const fwd = (below) => [0, Math.sin(r(below)), -Math.cos(r(below))];
const side = (j) => film(j, { view: 'side' });

// ---------- preacher curls: upper arm on a 45° pad
const preacherPose = (t, { armFrom = 45, armTo = 45, top = 1 } = {}) => {
  const a = lerp(armFrom, armTo, t);
  const fore = lerp(a - 20, -90, t * top); // from nearly straight (160°) to upright
  const arm = { dir: fwd(a), fore: fwd(fore) };
  return side(skeleton({ lean: 15, arms: [arm, arm] }));
};

test('preacher curls: counts full curls', () => {
  const an = new PreacherCurlAnalyzer();
  play(an, reps(3, (t) => preacherPose(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('preacher curls: half curls and lifting the arm off the pad are not counted', () => {
  const half = new PreacherCurlAnalyzer();
  play(half, reps(2, (t) => preacherPose(t, { top: 0.6 }), 3));
  assert.equal(half.count, 0);

  const lift = new PreacherCurlAnalyzer();
  const out = repsOf(play(lift, reps(2, (t) => preacherPose(t, { armTo: 5 }), 3)));
  assert.equal(lift.count, 0);
  assert.ok(out.every((x) => x.issues.includes('lift')));
  assert.match(lift.repText(out[0])[0], /pad/);
});

test('preacher curls: dropping the weight at the bottom is flagged; arm hanging = not on the pad', () => {
  const an = new PreacherCurlAnalyzer();
  // Up in 1.2 s, down in 0.3 s.
  const t = [...hold(0, 0.4), ...Array.from({ length: 36 }, (_, i) => (i + 1) / 36), ...Array.from({ length: 9 }, (_, i) => 1 - (i + 1) / 9), ...hold(0, 0.4)];
  const out = repsOf(play(an, t.map((k) => preacherPose(k))));
  assert.equal(an.count, 1);
  assert.ok(out[0].issues.includes('fast'));

  const standing = side(skeleton());
  assert.equal(playViews(new PreacherCurlAnalyzer(), hold(standing, 0.3)).at(-1).status, 'setup');
});

// ---------- incline curls: torso reclined 35°, arms hanging straight down
const inclinePose = (t, { swing = 0, top = 1 } = {}) => {
  const s = swing * t;
  const upper = [0, Math.cos(r(s)), -Math.sin(r(s))];
  const bend = lerp(15, 120, t * top);
  const fore = [0, Math.cos(r(s + bend)), -Math.sin(r(s + bend))];
  const arm = { dir: upper, fore };
  return side(skeleton({ lean: -35, arms: [arm, arm], legs: [{ hip: 90, knee: 90 }, { hip: 90, knee: 90 }] }));
};

test('incline curls: counts curls with the elbows hanging back', () => {
  const an = new InclineCurlAnalyzer();
  play(an, reps(3, (t) => inclinePose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('incline curls: swinging the elbows forward is not counted', () => {
  const an = new InclineCurlAnalyzer();
  const out = repsOf(play(an, reps(2, (t) => inclinePose(t, { swing: 50 }))));
  assert.equal(an.count, 0);
  assert.ok(out.every((x) => x.issues.includes('forward')));
  assert.equal(an.voiceLine({ type: 'rep', rep: out[0] }), 'Elbows back');
});

test('incline curls: sitting upright is not the incline position', () => {
  const upright = side(skeleton({ legs: [{ hip: 90, knee: 90 }, { hip: 90, knee: 90 }] }));
  assert.equal(playViews(new InclineCurlAnalyzer(), hold(upright, 0.3)).at(-1).status, 'setup');
});

// ---------- overhead triceps extensions
const ohPose = (t, { drift = 0, top = 1 } = {}) => {
  const a = 10 + drift * t; // upper arm tipped forward from vertical
  const upper = [0, -Math.cos(r(a)), -Math.sin(r(a))];
  const bend = lerp(15, 110, t * top); // forearm drops behind the head
  const fore = [0, -Math.cos(r(a - bend)), -Math.sin(r(a - bend))];
  const arm = { dir: upper, fore };
  return side(skeleton({ arms: [arm, arm], legs: [{ hip: 90, knee: 90 }, { hip: 90, knee: 90 }] }));
};

test('overhead extensions: counts deep reps', () => {
  const an = new OverheadExtensionAnalyzer();
  play(an, reps(3, (t) => ohPose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('overhead extensions: shallow reps and dropping the elbows are not counted', () => {
  const shallow = new OverheadExtensionAnalyzer();
  play(shallow, reps(2, (t) => ohPose(t, { top: 0.5 })));
  assert.equal(shallow.count, 0);

  const press = new OverheadExtensionAnalyzer();
  const out = repsOf(play(press, reps(2, (t) => ohPose(t, { drift: 55 }))));
  assert.equal(press.count, 0);
  assert.ok(out.every((x) => x.issues.includes('drop')));
});

test('overhead extensions: elbows drifting forward is called out live', () => {
  const an = new OverheadExtensionAnalyzer();
  const events = play(an, reps(1, (t) => ohPose(t, { drift: 38 })));
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'drift'));
  assert.equal(an.voiceLine({ type: 'cue', key: 'drift' }), 'Elbows up');
});

// ---------- wrist curls: forearm flat, pointing forward; hand angle above the forearm
const wristPose = (t, { lift = 0, top = 1 } = {}) => {
  const a = lerp(-40, 45, t * top); // hand angle above the forearm line
  const foreUp = lift * t; // forearm tipping up off the bench
  const fore = fwd(-foreUp);
  const hand = fwd(-foreUp - a);
  const arm = { dir: fwd(60), fore, hand };
  return side(skeleton({ lean: 35, arms: [arm, arm], legs: [{ hip: 90, knee: 90 }, { hip: 90, knee: 90 }] }));
};

test('wrist curls: counts full-range wrist curls', () => {
  const an = new WristCurlAnalyzer();
  play(an, reps(4, (t) => wristPose(t), 1.6));
  assert.equal(an.count, 4);
});

test('wrist curls: short reps and lifting the forearm are not counted', () => {
  const short = new WristCurlAnalyzer();
  play(short, reps(2, (t) => wristPose(t, { top: 0.55 }), 1.6));
  assert.equal(short.count, 0);

  const heave = new WristCurlAnalyzer();
  const out = repsOf(play(heave, reps(2, (t) => wristPose(t, { lift: 25 }), 1.6)));
  assert.equal(heave.count, 0);
  assert.ok(out.every((x) => x.issues.includes('forearm')));
});

// ---------- hammer / standing curls: elbows drifting behind the body (side view)
test('curls: elbows drifting back behind the body is flagged side-on', () => {
  const an = new CurlAnalyzer();
  const pose = (t) => {
    const arm = { abd: 5, flex: -35 * t, elbow: lerp(10, 125, t), plane: 'forward' };
    return side(skeleton({ arms: [arm, arm] }));
  };
  const out = repsOf(play(an, reps(1, pose)));
  assert.equal(an.count, 1);
  assert.ok(out[0].issues.includes('back'), JSON.stringify(out[0].issues));
  assert.ok(!out[0].issues.includes('swing'));
});
