import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp, ramp } from './body3d.js';
import { SplitSquatAnalyzer, HingeAnalyzer, HipThrustAnalyzer, LegCurlAnalyzer, CalfRaiseAnalyzer } from '../js/exercises/legs.js';
import { SquatAnalyzer } from '../js/exercises/squat.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const FLOOR = 0.9; // world y of the floor

/** Shifts a skeleton so joint `name` sits on the floor (and optionally at z). */
function plant(j, name, z = null) {
  const dy = FLOOR - j[name][1];
  const dz = z == null ? 0 : z - j[name][2];
  for (const k of Object.keys(j)) j[k] = [j[k][0], j[k][1] + dy, j[k][2] + dz];
  return j;
}
const side = (j, farVis = 0.3) => film(j, { view: 'side', offset: [640, 330], farVis });

// ---------- Bulgarian split squats: left (near) foot on the floor, right foot up on a bench behind
const bss = (t, { depth = 1, hipsStay = false } = {}) => {
  const k = t * depth;
  const j = skeleton({
    lean: 10 + 10 * k,
    legs: [
      { hip: lerp(10, 70, k), knee: lerp(8, 85, k) },
      { hip: lerp(-30, -12, k), knee: lerp(85, 100, k) },
    ],
  });
  plant(j, 'leftAnkle', 0);
  if (hipsStay) {
    // Only the front knee bends; the body doesn't come down (lifting the heel instead).
    const s = skeleton({ lean: 10, legs: [{ hip: 10, knee: 8 }, { hip: -30, knee: 85 }] });
    plant(s, 'leftAnkle', 0);
    const dy = s.leftHip[1] - j.leftHip[1];
    for (const n of Object.keys(j)) if (n !== 'leftAnkle' && n !== 'leftHeel' && n !== 'leftFoot') j[n] = [j[n][0], j[n][1] + dy, j[n][2]];
  }
  return side(j, 0.6);
};

test('split squats: counts deep reps and which leg was in front', () => {
  const an = new SplitSquatAnalyzer();
  play(an, reps(3, (t) => bss(t)));
  assert.equal(an.count, 3);
  assert.equal(an.sideCount.L, 3);
});

test('split squats: shallow reps are not counted; both feet on the floor is not the setup', () => {
  const an = new SplitSquatAnalyzer();
  play(an, reps(2, (t) => bss(t, { depth: 0.45 })));
  assert.equal(an.count, 0);

  const lunge = side(plant(skeleton({ legs: [{ hip: 20 }, { hip: -20 }] }), 'leftAnkle'), 0.6);
  assert.equal(playViews(new SplitSquatAnalyzer(), hold(lunge, 0.3)).at(-1).status, 'setup');
});

// ---------- Romanian deadlifts: hips back, torso tips forward, the weight slides down the legs.
// The hands ride on the front of the thigh at `u` of the way from hip to knee (1 = at the knee).
const rdl = (t, { lean = 62, u = 1.1, squat = false, away = 0 } = {}) => {
  const l = squat ? lerp(5, 30, t) : lerp(3, lean, t);
  const hip = squat ? lerp(5, 95, t) : lerp(5, 22, t);
  const knee = squat ? lerp(5, 115, t) : lerp(5, 25, t);
  const j = plant(skeleton({ lean: l, legs: [{ hip, knee }, { hip, knee }] }), 'leftAnkle', 0);
  const k = lerp(0.35, squat ? 1.35 : u, t);
  const [hp, kn] = [j.leftHip, j.leftKnee];
  j.leftWrist = [hp[0], hp[1] + (kn[1] - hp[1]) * k, hp[2] + (kn[2] - hp[2]) * k - 0.06 - away * t];
  return side(j);
};

test('RDLs: counts hinges down past the knees', () => {
  const an = new HingeAnalyzer();
  play(an, reps(3, (t) => rdl(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('RDLs: letting the weight drift away from the legs is called out', () => {
  const an = new HingeAnalyzer();
  const out = repsOf(play(an, reps(1, (t) => rdl(t, { away: 0.25 }), 3)));
  assert.equal(an.count, 1);
  assert.ok(out[0].issues.includes('drift'), JSON.stringify(out[0].issues));
});

test('RDLs: short reps are not counted; squatting the weight down is not counted', () => {
  const short = new HingeAnalyzer();
  play(short, reps(2, (t) => rdl(t, { lean: 30, u: 0.6 }), 3));
  assert.equal(short.count, 0);

  const squat = new HingeAnalyzer();
  const out = repsOf(play(squat, reps(2, (t) => rdl(t, { squat: true }), 3)));
  assert.equal(squat.count, 0);
  assert.ok(out.length >= 1);
  assert.ok(out.every((r) => r.issues.includes('squat') || r.issues.includes('depth')), JSON.stringify(out.map((r) => r.issues)));
});

// ---------- hip thrusts: upper back on the bench, knees bent
const thrust = (t, { top = 1, arch = 0 } = {}) => {
  const k = t * top;
  const tilt = lerp(28, -arch, k); // torso: shoulders above the hips at the bottom
  const hipFlex = lerp(62, -arch, k);
  const j = skeleton({ rot: { pitch: -90 + tilt }, legs: [{ hip: hipFlex + tilt * 0, knee: 90 }, { hip: hipFlex, knee: 90 }] });
  return side(plant(j, 'leftAnkle', 0));
};

test('hip thrusts: counts reps to a flat top', () => {
  const an = new HipThrustAnalyzer();
  const poses = Array.from({ length: 3 }, () => [...hold(0, 0.5), ...ramp(0, 1, 0.8), ...hold(1, 0.5), ...ramp(1, 0, 0.8)]).flat().map((t) => thrust(t));
  play(an, poses);
  assert.equal(an.count, 3);
});

test('hip thrusts: half reps at the bottom are not counted', () => {
  const an = new HipThrustAnalyzer();
  play(an, reps(2, (t) => thrust(t, { top: 0.6 })));
  assert.equal(an.count, 0);
});

// ---------- prone leg curls: face down, heels toward the glutes
const legCurl = (t, { top = 1, hips = 0 } = {}) => {
  const j = skeleton({ rot: { pitch: 90 }, legs: [{ knee: lerp(15, 95, t * top) }, { knee: lerp(15, 95, t * top) }] });
  for (const n of ['leftHip', 'rightHip']) j[n] = [j[n][0], j[n][1] - hips * t, j[n][2]];
  return film(j, { view: 'side', offset: [640, 420] });
};

test('leg curls: counts curls to the shins upright', () => {
  const an = new LegCurlAnalyzer();
  play(an, reps(3, (t) => legCurl(t), 3));
  assert.equal(an.count, 3);
});

test('leg curls: short curls and lifting the hips are not counted', () => {
  const short = new LegCurlAnalyzer();
  play(short, reps(2, (t) => legCurl(t, { top: 0.5 }), 3));
  assert.equal(short.count, 0);

  const hips = new LegCurlAnalyzer();
  const out = repsOf(play(hips, reps(2, (t) => legCurl(t, { hips: 0.14 }), 3)));
  assert.equal(hips.count, 0);
  assert.ok(out.every((r) => r.issues.includes('hips')), JSON.stringify(out.map((r) => r.issues)));
});

// ---------- calf raises: rise onto the toes, toes stay on the floor
const calf = (t, { top = 1, knees = 0, noRise = false } = {}) => {
  const a = lerp(-12, 32, t * top);
  const j = skeleton({ legs: [{ ankle: a, knee: knees * t, hip: knees * t * 0.5 }, { ankle: a, knee: knees * t, hip: knees * t * 0.5 }] });
  if (noRise) return side(plant(j, 'leftAnkle', 0));
  return side(plant(j, 'leftFoot', 0));
};
const calfReps = (n, o) => Array.from({ length: n }, () => [...hold(0, 0.8), ...ramp(0, 1, 0.8), ...hold(1, 0.3), ...ramp(1, 0, 1.4)]).flat().map((t) => calf(t, o));

test('calf raises: counts full raises from the stretch', () => {
  const an = new CalfRaiseAnalyzer();
  play(an, calfReps(3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('calf raises: half raises, bent knees and no body rise are not counted', () => {
  const half = new CalfRaiseAnalyzer();
  play(half, calfReps(2, { top: 0.4 }));
  assert.equal(half.count, 0);

  const knees = new CalfRaiseAnalyzer();
  const out = repsOf(play(knees, calfReps(2, { knees: 45 })));
  assert.equal(knees.count, 0);
  assert.ok(out.every((r) => r.issues.includes('knees')), JSON.stringify(out.map((r) => r.issues)));

  const rock = new CalfRaiseAnalyzer();
  play(rock, calfReps(2, { noRise: true }));
  assert.equal(rock.count, 0);
});

test('calf raises: bouncing straight out of the bottom is called out', () => {
  const an = new CalfRaiseAnalyzer();
  const bounce = Array.from({ length: 3 }, () => [...ramp(0, 1, 0.8), ...hold(1, 0.2), ...ramp(1, 0, 1.4)]).flat();
  const out = repsOf(play(an, [...hold(0, 1), ...bounce].map((t) => calf(t))));
  assert.ok(out.length >= 2);
  assert.ok(out.slice(1).every((r) => r.issues.includes('pause')), JSON.stringify(out.map((r) => r.issues)));
  assert.equal(an.voiceLine({ type: 'rep', rep: out[1] }), `${out[1].n}. Pause at the bottom`);
});

// ---------- squat variants: front rack elbows, goblet dumbbell at the chest
const squat3d = (t, arms) => {
  const hip = lerp(0, 95, t);
  const knee = lerp(0, 115, t);
  const j = skeleton({ lean: lerp(0, 25, t), arms: [arms(t), arms(t)], legs: [{ hip, knee }, { hip, knee }] });
  return side(plant(j, 'leftAnkle', 0));
};
const rack = (drop) => (t) => ({ abd: 5, flex: 90 - drop * t, elbow: 150, plane: 'up' });
const goblet = (reach) => (t) => ({ abd: 5, flex: 25 + reach * t, elbow: 140 - reach * 1.4 * t, plane: 'up' });

test('front squats: dropping the elbows is called out', () => {
  const good = new SquatAnalyzer({ hold: 'front' });
  const ok = repsOf(play(good, reps(2, (t) => squat3d(t, rack(0)), 3)));
  assert.equal(good.count, 2);
  assert.ok(ok.every((r) => !r.issues.includes('elbows')), JSON.stringify(ok.map((r) => r.issues)));

  const drop = new SquatAnalyzer({ hold: 'front' });
  const out = repsOf(play(drop, reps(1, (t) => squat3d(t, rack(60)), 3)));
  assert.ok(out[0].issues.includes('elbows'), JSON.stringify(out[0].issues));
});

test('goblet squats: the dumbbell drifting off the chest is called out', () => {
  const good = new SquatAnalyzer({ hold: 'goblet' });
  const ok = repsOf(play(good, reps(2, (t) => squat3d(t, goblet(0)), 3)));
  assert.equal(good.count, 2);
  assert.ok(ok.every((r) => !r.issues.includes('drift')), JSON.stringify(ok.map((r) => r.issues)));

  const drift = new SquatAnalyzer({ hold: 'goblet' });
  const out = repsOf(play(drift, reps(1, (t) => squat3d(t, goblet(60)), 3)));
  assert.ok(out[0].issues.includes('drift'), JSON.stringify(out[0].issues));
});
