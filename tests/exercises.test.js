import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, repsOf, lerp } from './body3d.js';
import { LungeAnalyzer } from '../js/exercises/lunge.js';
import { CurlAnalyzer } from '../js/exercises/curl.js';
import { PressAnalyzer } from '../js/exercises/press.js';
import { LateralRaiseAnalyzer } from '../js/exercises/lateral.js';
import { JacksAnalyzer } from '../js/exercises/jacks.js';
import { PlankAnalyzer } from '../js/exercises/plank.js';
import { EXERCISES } from '../js/exercises/index.js';

const reps = (n, fn) => Array.from({ length: n }, () => cycle().map(fn)).flat();

// ---------- bicep curls
const curlPose = (t, { view = 'side', max = 125, swing = 0, arm = 'both' } = {}) => {
  const bend = lerp(10, max, t);
  const moving = { abd: 5, flex: swing * t, elbow: bend, plane: 'forward' };
  const still = { abd: 5, elbow: 10, plane: 'forward' };
  const arms = arm === 'both' ? [moving, moving] : arm === 'left' ? [moving, still] : [still, moving];
  return film(skeleton({ arms }), { view });
};

test('curls: counts full curls side-on and facing the camera', () => {
  for (const view of ['side', 'front']) {
    const an = new CurlAnalyzer();
    const out = repsOf(play(an, reps(3, (t) => curlPose(t, { view }))));
    assert.equal(an.count, 3, `${view} view`);
    assert.equal(an.clean, 3, `${view} view`);
    assert.equal(out.length, 3);
  }
});

test('curls: half curls are not counted', () => {
  const an = new CurlAnalyzer();
  play(an, reps(2, (t) => curlPose(t, { max: 75 })));
  assert.equal(an.count, 0);
  assert.equal(an.partials, 2);
});

test('curls: flags the elbow swinging forward', () => {
  const an = new CurlAnalyzer();
  const out = repsOf(play(an, reps(1, (t) => curlPose(t, { swing: 55 }))));
  assert.equal(an.count, 1);
  assert.ok(out[0].issues.includes('swing'));
});

test('curls: alternating arms count one rep each', () => {
  const an = new CurlAnalyzer();
  play(an, [...reps(1, (t) => curlPose(t, { view: 'front', arm: 'left' })), ...reps(1, (t) => curlPose(t, { view: 'front', arm: 'right' }))]);
  assert.equal(an.count, 2);
});

// ---------- shoulder press
const pressPose = (t, { top = 1, lagRight = 0 } = {}) => {
  const arm = (k) => ({ abd: lerp(80, lerp(80, 172, top), k), elbow: lerp(95, lerp(95, 3, top), k), plane: 'up' });
  return film(skeleton({ arms: [arm(t), arm(Math.max(0, t - lagRight))] }));
};

test('press: counts full presses to lockout', () => {
  const an = new PressAnalyzer();
  play(an, reps(3, (t) => pressPose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('press: half presses are not counted', () => {
  const an = new PressAnalyzer();
  play(an, reps(2, (t) => pressPose(t, { top: 0.5 })));
  assert.equal(an.count, 0);
  assert.equal(an.partials, 2);
});

test('press: flags uneven arms', () => {
  const an = new PressAnalyzer();
  const out = repsOf(play(an, reps(1, (t) => pressPose(t, { lagRight: 0.5 }))));
  assert.ok(out.length >= 1);
  assert.ok(out.some((r) => r.issues.includes('uneven')));
});

test('press: asks to bring the weights up when arms hang down', () => {
  const an = new PressAnalyzer();
  const { lm, world } = film(skeleton());
  const view = an.update({ lm, world, w: 1280, h: 720, t: 0 });
  assert.equal(view.status, 'setup');
});

// ---------- lateral raises
const lateralPose = (t, { top = 88, elbow = 15, uneven = 0 } = {}) =>
  film(skeleton({ arms: [{ abd: lerp(15, top, t), elbow, plane: 'up' }, { abd: lerp(15, top - uneven, t), elbow, plane: 'up' }] }));

test('lateral raises: counts raises to shoulder height', () => {
  const an = new LateralRaiseAnalyzer();
  play(an, reps(3, (t) => lateralPose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('lateral raises: flags going above shoulder height and bent elbows', () => {
  const high = new LateralRaiseAnalyzer();
  const out1 = repsOf(play(high, reps(1, (t) => lateralPose(t, { top: 125 }))));
  assert.ok(out1[0].issues.includes('high'));

  const bent = new LateralRaiseAnalyzer();
  const out2 = repsOf(play(bent, reps(1, (t) => lateralPose(t, { elbow: 75 }))));
  assert.ok(out2[0].issues.includes('bent'));
});

test('lateral raises: needs a front view', () => {
  const an = new LateralRaiseAnalyzer();
  const { lm, world } = film(skeleton(), { view: 'side' });
  assert.equal(an.update({ lm, world, w: 1280, h: 720, t: 0 }).status, 'partial');
});

// ---------- jumping jacks
const jackPose = (t, { arms = 165, feet = 18 } = {}) => {
  const arm = { abd: lerp(8, arms, t), elbow: 5, plane: 'up' };
  const leg = { abd: lerp(3, feet, t) };
  return film(skeleton({ arms: [arm, arm], legs: [leg, leg] }));
};

test('jumping jacks: counts full jacks', () => {
  const an = new JacksAnalyzer();
  play(an, reps(4, (t) => jackPose(t)));
  assert.equal(an.count, 4);
  assert.equal(an.clean, 4);
});

test('jumping jacks: small jacks are not counted and say why', () => {
  const an = new JacksAnalyzer();
  const out = repsOf(play(an, reps(1, (t) => jackPose(t, { arms: 95, feet: 8 }))));
  assert.equal(an.count, 0);
  assert.ok(out[0].issues.includes('arms'));
  assert.ok(out[0].issues.includes('legs'));
});

// ---------- lunges
const lungePose = (t, { depth = 90, lean = 5 } = {}) => {
  const k = lerp(0, depth, t);
  return film(
    skeleton({ lean: lerp(3, lean, t), legs: [{ hip: k, knee: k }, { hip: -lerp(0, 15, t), knee: k }] }),
    { view: 'side', farVis: 0.9 },
  );
};

test('lunges: counts lunges to ~90°', () => {
  const an = new LungeAnalyzer();
  play(an, reps(3, (t) => lungePose(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('lunges: shallow lunges are not counted; forward lean is flagged', () => {
  const shallow = new LungeAnalyzer();
  play(shallow, reps(1, (t) => lungePose(t, { depth: 45 })));
  assert.equal(shallow.count, 0);

  const leaning = new LungeAnalyzer();
  const out = repsOf(play(leaning, reps(1, (t) => lungePose(t, { lean: 45 }))));
  assert.equal(leaning.count, 1);
  assert.ok(out[0].issues.includes('lean'));
});

// ---------- plank
// `sag` drops the hips: torso and legs both angle up away from them.
const plankPose = (sag = 0) =>
  film(
    skeleton({
      lean: 90 - sag,
      arms: [{ abd: 0, elbow: 90, plane: 'forward' }, { abd: 0, elbow: 90, plane: 'forward' }],
      legs: [{ hip: -90 - sag }, { hip: -90 - sag }],
    }),
    { view: 'side', offset: [760, 420] },
  );

test('plank: times a hold and scores form', () => {
  const an = new PlankAnalyzer();
  const standing = film(skeleton(), { view: 'side' });
  const events = play(an, [...hold(plankPose(0), 11), ...hold(standing, 1.5)]);
  const set = events.find((e) => e.type === 'set')?.set;
  assert.ok(set, 'a set was recorded');
  assert.ok(set.ms > 10500 && set.ms < 11500, `hold time ${set.ms}`);
  assert.ok(set.form > 0.95);
  assert.deepEqual(events.filter((e) => e.type === 'milestone').map((e) => e.seconds), [10]);
});

test('plank: sagging hips lower the form score', () => {
  const an = new PlankAnalyzer();
  const standing = film(skeleton(), { view: 'side' });
  const events = play(an, [...hold(plankPose(0), 3), ...hold(plankPose(14), 3), ...hold(standing, 1.5)]);
  const set = events.find((e) => e.type === 'set').set;
  assert.ok(set.form < 0.6, `form ${set.form}`);
  assert.ok(set.issues.includes('sag'));
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'sag'));
});

// ---------- catalog
test('every exercise in the catalog builds, counts nothing at rest and has a HUD', () => {
  const settings = { depthTarget: 90, squatDepth: 'parallel' };
  const { lm, world } = film(skeleton());
  for (const ex of EXERCISES) {
    const an = ex.create(settings);
    const view = an.update({ lm, world, w: 1280, h: 720, t: 0 });
    assert.ok(view.hud && typeof view.hud.big === 'string', ex.id);
    assert.equal(an.count, 0, ex.id);
    assert.ok(ex.setup.length >= 2, ex.id);
  }
});
