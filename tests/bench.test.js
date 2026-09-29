import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp } from './body3d.js';
import { BenchPressAnalyzer, FlyAnalyzer, PulloverAnalyzer } from '../js/exercises/bench.js';

const reps = (n, fn, secs = 2) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

// Lying face up (pitch −90 flat, −60 for a 30° incline), filmed side-on.
// Arm directions are in the body's frame: [out, toward the feet, behind the back].
const UP = [0, 0, -1]; // straight up from the chest
const lying = (arms, { pitch = -90 } = {}) =>
  film(skeleton({ rot: { pitch }, legs: [{ hip: 0, knee: 70 }, { hip: 0, knee: 70 }], arms }), { view: 'side', offset: [640, 420] });

// Press: dumbbells at the chest = upper arm 45° out and toward the hips, 22° below the bench line; forearm vertical.
const pressArm = (t, { tuck = 45, drop = 22, top = 1 } = {}) => {
  const k = Math.min(t, 1);
  const r = (d) => (d * Math.PI) / 180;
  const low = [Math.sin(r(tuck)) * Math.cos(r(drop)), Math.cos(r(tuck)) * Math.cos(r(drop)), Math.sin(r(drop))];
  const upper = mix(UP, low, k * top);
  return { dir: upper, fore: UP };
};
const pressPose = (t, o = {}) => lying([pressArm(t, o), pressArm(t, o)], o);

test('bench press: counts full reps on a flat bench', () => {
  const an = new BenchPressAnalyzer();
  play(an, reps(3, (t) => pressPose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('bench press: stopping with the upper arms level with the bench is not counted', () => {
  const an = new BenchPressAnalyzer();
  const out = repsOf(play(an, reps(2, (t) => pressPose(t, { drop: -5 }))));
  assert.equal(an.count, 0);
  assert.ok(out.length >= 1);
  assert.match(an.repText(out[0])[0], /chest/);
});

test('bench press: reps that never lock out at the top are not counted', () => {
  const an = new BenchPressAnalyzer();
  // Top of each rep is only halfway back up.
  const half = (t) => pressPose(0.45 + 0.55 * t);
  const poses = [...hold(pressPose(0), 0.5), ...reps(3, half)];
  play(an, poses);
  assert.ok(an.count <= 1, `counted ${an.count}`);
});

test('bench press: flags flared elbows and hips lifting', () => {
  const flare = new BenchPressAnalyzer();
  const out1 = repsOf(play(flare, reps(1, (t) => pressPose(t, { tuck: 88 }))));
  assert.ok(out1[0].issues.includes('flare'), JSON.stringify(out1[0].issues));

  const hips = new BenchPressAnalyzer();
  // Hips off the bench: the torso tips so the hips sit higher than the shoulders.
  const bridge = (t) => pressPose(t, { pitch: t > 0.6 ? -112 : -90 });
  const out2 = repsOf(play(hips, [...hold(pressPose(0), 1), ...reps(1, bridge)]));
  assert.ok(out2[0].issues.includes('hips'), JSON.stringify(out2[0].issues));
});

test('bench press: the first press after lying down with the dumbbells at the chest is not a rep', () => {
  const an = new BenchPressAnalyzer();
  const poses = [...hold(pressPose(1), 1), ...Array.from({ length: 30 }, (_, i) => pressPose(1 - i / 29)), ...hold(pressPose(0), 0.5)];
  play(an, poses);
  assert.equal(an.count, 0);
});

test('bench press: needs the right bench angle and to be lying down', () => {
  const inclinePose = (t) => pressPose(t, { pitch: -60 });
  const flatAn = new BenchPressAnalyzer({ bench: 'flat' });
  const views = playViews(flatAn, hold(inclinePose(0), 0.5));
  assert.equal(views.at(-1).status, 'setup');

  const incAn = new BenchPressAnalyzer({ bench: 'incline' });
  play(incAn, reps(2, inclinePose));
  assert.equal(incAn.count, 2);
  assert.equal(playViews(new BenchPressAnalyzer({ bench: 'incline' }), hold(pressPose(0), 0.5)).at(-1).status, 'setup');

  const standing = film(skeleton(), { view: 'side' });
  assert.equal(playViews(new BenchPressAnalyzer(), hold(standing, 0.3)).at(-1).status, 'setup');
});

// Fly: arms sweep from over the chest out to the sides with a soft, fixed bend.
const flyArm = (t, { bend = 20, depth = 1 } = {}) => {
  const k = Math.min(t, 1) * depth;
  const r = (d) => (d * Math.PI) / 180;
  const upper = [Math.sin(r(90 * k)), 0.05, -Math.cos(r(90 * k)) + 0.05 * k];
  // Forearm bends back toward "up" (the ceiling) by `bend`.
  const fore = mix(upper, UP, bend / 90);
  return { dir: upper, fore };
};
const flyPose = (t, o = {}) => lying([flyArm(t, o), flyArm(t, o)]);

test('flyes: counts wide, controlled flyes', () => {
  const an = new FlyAnalyzer();
  play(an, reps(3, (t) => flyPose(t), 3));
  assert.equal(an.count, 3);
});

test('flyes: bending the elbows into a press is not counted', () => {
  const an = new FlyAnalyzer();
  const out = repsOf(play(an, reps(2, (t) => pressPose(t), 3)));
  assert.equal(an.count, 0);
  assert.ok(out.every((r) => r.issues.includes('press')));
  assert.match(an.voiceLine({ type: 'rep', rep: out[0] }), /elbow/i);
});

test('flyes: short flyes are not counted; dropping into the stretch is flagged', () => {
  const short = new FlyAnalyzer();
  play(short, reps(2, (t) => flyPose(t, { depth: 0.5 }), 3));
  assert.equal(short.count, 0);

  const fast = new FlyAnalyzer();
  const out = repsOf(play(fast, reps(1, (t) => flyPose(t), 0.9)));
  assert.equal(fast.count, 1);
  assert.ok(out[0].issues.includes('fast'));
});

// Pullover: from over the chest to behind the head, elbows softly bent.
const pullArm = (t, { elbow = 15, reach = 1 } = {}) => {
  const k = Math.min(t, 1) * reach;
  const r = (d) => (d * Math.PI) / 180;
  const a = r(90 * k * 0.7); // up → back past the head (up to ~63° from vertical over the chest)
  const upper = [0.1, -Math.sin(a), -Math.cos(a)];
  return { dir: upper, fore: mix(upper, [0, 0, -1], elbow / 90) };
};
const pullPose = (t, o = {}) => lying([pullArm(t, o), pullArm(t, o)]);

test('pullovers: counts full-range pullovers', () => {
  const an = new PulloverAnalyzer();
  play(an, reps(3, (t) => pullPose(t), 3));
  assert.equal(an.count, 3);
});

test('pullovers: bending the elbows as you go is not counted', () => {
  const an = new PulloverAnalyzer();
  const out = repsOf(play(an, reps(2, (t) => pullPose(t, { elbow: 15 + 85 * t }), 3)));
  assert.equal(an.count, 0);
  assert.ok(out.every((r) => r.issues.includes('elbows')));
});
