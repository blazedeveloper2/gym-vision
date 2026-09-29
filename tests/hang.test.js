import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp, ramp } from './body3d.js';
import { PullUpAnalyzer, ScapPullAnalyzer, ArchHangAnalyzer, HangingLegRaiseAnalyzer } from '../js/exercises/hang.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const BAR = -1.2; // world height of the bar (up is −y)

/** Moves the body so the hands are on the bar. */
function onBar(j) {
  const dy = BAR - (j.leftWrist[1] + j.rightWrist[1]) / 2;
  const dz = -(j.leftWrist[2] + j.rightWrist[2]) / 2;
  for (const k of Object.keys(j)) j[k] = [j[k][0], j[k][1] + dy, j[k][2] + dz];
  return j;
}

/**
 * Two-link arm reaching from the shoulder to a hand `out` metres further out
 * and `up` metres above it, the elbow bending outward ('out', wide grip) or
 * forward ('forward', chin-ups). Returns { dir, fore } in the body frame.
 */
function reach(out, up, bend = 'out') {
  const len = Math.hypot(out, up);
  const d = Math.min(len, 0.5699);
  const [ux, uy] = [out / len, -up / len];
  const a = (0.09 + d * d - 0.0729) / (2 * d);
  const h = Math.sqrt(Math.max(0, 0.09 - a * a));
  let [px, py] = [-uy, ux];
  if (px < 0) [px, py] = [-px, -py];
  const e = [ux * a + px * h, uy * a + py * h];
  const w = [ux * d, uy * d];
  const upper = [e[0] / 0.3, e[1] / 0.3];
  const fore = [(w[0] - e[0]) / 0.27, (w[1] - e[1]) / 0.27];
  return bend === 'out'
    ? { dir: [upper[0], upper[1], 0], fore: [fore[0], fore[1], 0] }
    : { dir: [0, upper[1], -upper[0]], fore: [0, fore[1], -fore[0]] };
}

// s = how far the shoulders hang below the bar (m): 0.56 dead hang → 0.1 chin over.
const pullPose = (s, { view = 'front', grip = 'wide', legs = null } = {}) => {
  const arm = grip === 'wide' ? reach(0.1, s, 'out') : reach(0.01, s, 'forward');
  const j = onBar(skeleton({ arms: [arm, arm], legs: legs ?? [{}, {}] }));
  return film(j, { view, offset: [640, 420] });
};
const S_HANG = 0.56;
const S_TOP = 0.1;
const pull = (t, o = {}) => pullPose(lerp(S_HANG, S_TOP, t), o);

test('pull-ups: counts full reps from a dead hang (front and back)', () => {
  for (const view of ['front', 'back']) {
    const an = new PullUpAnalyzer();
    play(an, reps(3, (t) => pull(t, { view })));
    assert.equal(an.count, 3, view);
  }
});

test('chin-ups: counts full reps side-on', () => {
  const an = new PullUpAnalyzer();
  play(an, reps(3, (t) => pull(t, { view: 'side', grip: 'narrow' })));
  assert.equal(an.count, 3);
});

test('pull-ups: stopping short of the bar is not counted', () => {
  const an = new PullUpAnalyzer();
  const out = repsOf(play(an, reps(2, (t) => pullPose(lerp(S_HANG, 0.3, t)))));
  assert.equal(an.count, 0);
  assert.match(an.repText(out[0])[0], /chin/);
});

test('pull-ups: half reps that never return to a dead hang are not counted', () => {
  const an = new PullUpAnalyzer();
  // One real start, then bouncing between the top and halfway down.
  const ts = [...hold(0, 0.5), ...ramp(0, 1, 1), ...[1, 2, 3].flatMap(() => [...ramp(1, 0.45, 0.8), ...ramp(0.45, 1, 0.8)]), ...ramp(1, 0, 1)];
  play(an, ts.map((t) => pull(t)));
  assert.ok(an.count <= 1, `counted ${an.count}`);
});

test('pull-ups: jumping up to the bar and lowering down is not a rep', () => {
  const an = new PullUpAnalyzer();
  const ts = [...hold(1, 0.6), ...ramp(1, 0, 1.5), ...hold(0, 0.5)];
  play(an, ts.map((t) => pull(t)));
  assert.equal(an.count, 0);
});

test('pull-ups: kipping (kicking the legs up) is not counted', () => {
  const an = new PullUpAnalyzer();
  const kip = (t) => {
    const k = Math.sin(Math.PI * Math.min(1, t * 1.6));
    return pull(t, { legs: [{ hip: 75 * k, knee: 80 * k }, { hip: 75 * k, knee: 80 * k }] });
  };
  const out = repsOf(play(an, reps(2, kip)));
  assert.equal(an.count, 0);
  assert.ok(out.every((r) => r.issues.includes('kip')), JSON.stringify(out.map((r) => r.issues)));
  assert.equal(an.voiceLine({ type: 'rep', rep: out[0] }), 'No kipping');
});

// ---------- scapular pulls: head and hips rise while the arms stay straight
const LIFTS = ['nose', 'leftEar', 'rightEar', 'leftEye', 'rightEye', 'mouthLeft', 'mouthRight', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFoot', 'rightFoot'];
const scapPose = (rise) => {
  const arm = reach(0.05, 0.565, 'out');
  const j = onBar(skeleton({ arms: [arm, arm] }));
  for (const k of LIFTS) j[k] = [j[k][0], j[k][1] - rise, j[k][2]];
  return film(j, { view: 'side', offset: [640, 420] });
};
const scapReps = (n, amount) => {
  const one = [...hold(0, 0.6), ...ramp(0, 1, 0.6), ...hold(1, 0.6), ...ramp(1, 0, 0.6)];
  return Array.from({ length: n }, () => one).flat().map((k) => scapPose(amount * k));
};

test('scapular pulls: counts shoulder-blade pulls with straight arms', () => {
  const an = new ScapPullAnalyzer();
  play(an, scapReps(3, 0.04));
  assert.equal(an.count, 3);
});

test('scapular pulls: tiny shrugs are not counted', () => {
  const an = new ScapPullAnalyzer();
  play(an, scapReps(2, 0.012));
  assert.equal(an.count, 0);
});

// ---------- arch hangs, side-on: torso tips back, chest up, arms nearly straight
const archPose = (t, { kick = 0, bend = 0 } = {}) => {
  const a = (15 * Math.PI) / 180;
  const arm = { dir: [0, -Math.cos(a), -Math.sin(a)], elbow: 12 + bend * t, plane: 'back' };
  const j = onBar(skeleton({ lean: -30 * t, arms: [arm, arm], legs: [{ hip: kick * t }, { hip: kick * t }] }));
  return film(j, { view: 'side', offset: [640, 420] });
};
const archReps = (n, o = {}) => {
  const one = [...hold(0, 0.5), ...ramp(0, 1, 0.8), ...hold(1, 1.2), ...ramp(1, 0, 0.8)];
  return Array.from({ length: n }, () => one).flat().map((t) => archPose(t, o));
};

test('arch hangs: counts arched holds with the chest up', () => {
  const an = new ArchHangAnalyzer();
  play(an, archReps(3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('arch hangs: rowing up with bent arms or kicking the legs is not counted', () => {
  const kick = new ArchHangAnalyzer();
  const out = repsOf(play(kick, archReps(2, { kick: 60 })));
  assert.equal(kick.count, 0);
  assert.ok(out.every((r) => r.issues.includes('kick')), JSON.stringify(out.map((r) => r.issues)));

  const bent = new ArchHangAnalyzer();
  const out2 = repsOf(play(bent, archReps(2, { bend: 80 })));
  assert.equal(bent.count, 0);
  assert.ok(out2.every((r) => r.issues.includes('bent')), JSON.stringify(out2.map((r) => r.issues)));
});

// ---------- hanging leg raises, side-on
const legRaise = (t, { hip = 100, knee = 0, swing = 0 } = {}) => {
  const arm = reach(0.05, 0.565, 'out');
  const j = onBar(skeleton({ rot: { pitch: swing * Math.sin(Math.PI * t) }, lean: -8 * t, arms: [arm, arm], legs: [{ hip: hip * t, knee: knee * t }, { hip: hip * t, knee: knee * t }] }));
  return film(j, { view: 'side', offset: [640, 420] });
};
const legReps = (n, fn) => Array.from({ length: n }, () => [...hold(0, 0.6), ...ramp(0, 1, 1), ...hold(1, 0.3), ...ramp(1, 0, 1)].map(fn)).flat();

test('hanging leg raises: counts straight-leg raises past level', () => {
  const an = new HangingLegRaiseAnalyzer();
  play(an, legReps(3, (t) => legRaise(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('hanging leg raises: low raises, knee raises and swinging are not counted', () => {
  const low = new HangingLegRaiseAnalyzer();
  play(low, legReps(2, (t) => legRaise(t, { hip: 60 })));
  assert.equal(low.count, 0);

  const knees = new HangingLegRaiseAnalyzer();
  const out = repsOf(play(knees, legReps(2, (t) => legRaise(t, { hip: 115, knee: 100 }))));
  assert.equal(knees.count, 0);
  assert.ok(out.every((r) => r.issues.includes('knees')), JSON.stringify(out.map((r) => r.issues)));

  const swing = new HangingLegRaiseAnalyzer();
  const out2 = repsOf(play(swing, legReps(2, (t) => legRaise(t, { swing: 45 }))));
  assert.equal(swing.count, 0);
  assert.ok(out2.every((r) => r.issues.includes('swing')), JSON.stringify(out2.map((r) => r.issues)));
});

test('hanging: standing on the floor is not hanging', () => {
  const standing = film(skeleton(), { view: 'side' });
  assert.equal(playViews(new PullUpAnalyzer(), hold(standing, 0.3)).at(-1).status, 'setup');
  assert.equal(playViews(new HangingLegRaiseAnalyzer(), hold(standing, 0.3)).at(-1).status, 'setup');
});
