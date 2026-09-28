import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PushupAnalyzer } from '../js/exercises/pushup.js';
import { pushupPose, ramp, hold, run } from './synthetic.js';

const TOP = 170;
const reps = (events) => events.filter((e) => e.type === 'rep').map((e) => e.rep);

/** One push-up: pause at the top, lower to `min`, pause, press back up. */
function pushup(min, { sag = 0 } = {}) {
  const angles = [...hold(TOP, 0.4), ...ramp(TOP, min, 0.8), ...hold(min, 0.2), ...ramp(min, TOP, 0.8)];
  return angles.map((elbow) => pushupPose({ elbow, sag: elbow < 120 ? sag : 0 }));
}

test('counts full-depth push-ups', () => {
  const an = new PushupAnalyzer();
  const out = reps(run(an, [...pushup(85), ...pushup(80), ...pushup(88)]));
  assert.equal(out.length, 3);
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
  assert.deepEqual(out.map((r) => r.n), [1, 2, 3]);
});

test('does not count a rep that stops short of the depth target', () => {
  const an = new PushupAnalyzer();
  const out = reps(run(an, [...pushup(85), ...pushup(120)]));
  assert.equal(an.count, 1);
  assert.equal(an.partials, 1);
  assert.equal(out[1].counted, false);
  assert.ok(out[1].issues.includes('depth'));
});

test('depth target setting changes what counts', () => {
  const an = new PushupAnalyzer({ depthTarget: 110 });
  run(an, pushup(105));
  assert.equal(an.count, 1);
});

test('flags sagging hips', () => {
  const an = new PushupAnalyzer();
  const out = reps(run(an, [...pushup(85), ...pushup(85, { sag: 70 })]));
  assert.equal(an.count, 2);
  assert.deepEqual(out[0].issues, []);
  assert.ok(out[1].issues.includes('sag'));
});

test('flags a rep that never locks out at the top', () => {
  const an = new PushupAnalyzer();
  const angles = [...hold(TOP, 0.4), ...ramp(TOP, 85, 0.8), ...ramp(85, 135, 0.5), ...ramp(135, 85, 0.5), ...ramp(85, TOP, 0.8)];
  const out = reps(run(an, angles.map((elbow) => pushupPose({ elbow }))));
  assert.equal(an.count, 2);
  assert.ok(out[0].issues.includes('incomplete'));
  assert.deepEqual(out[1].issues, []);
});

test('hand-release at the bottom is not an extra rep', () => {
  const an = new PushupAnalyzer();
  const chest = { x: 400, y: 560 }; // shoulders down near the floor
  const poses = [
    ...[...hold(TOP, 0.4), ...ramp(TOP, 60, 0.8)].map((elbow) => pushupPose({ elbow })),
    // Hands slide forward until the arms are straight, then come back.
    ...ramp(400, 110, 0.5).map((x) => pushupPose({ elbow: 0, shoulder: chest, wrist: { x, y: 600 } })),
    ...ramp(110, 400, 0.5).map((x) => pushupPose({ elbow: 0, shoulder: chest, wrist: { x, y: 600 } })),
    ...ramp(60, TOP, 0.8).map((elbow) => pushupPose({ elbow })),
  ];
  const out = reps(run(an, poses));
  assert.equal(out.length, 1);
  assert.equal(an.count, 1);
  assert.deepEqual(out[0].issues, []);
});

test('ignores a person who is standing, not in a plank', () => {
  const an = new PushupAnalyzer();
  // Rotate the push-up pose 90°: shoulders far above the feet.
  const standing = pushupPose({ elbow: TOP }).map((p) => ({ ...p, x: 0.5 + (p.y - 0.5) * 0.3, y: p.x }));
  const view = an.update({ lm: standing, world: null, w: 1280, h: 720, t: 0 }, '2d');
  assert.equal(view.status, 'setup');
});

test('bending the elbows without lowering the body is not a push-up', () => {
  const an = new PushupAnalyzer();
  // Shoulders stay up; the hands come up toward them instead.
  const S = { x: 400, y: 300 };
  const chord = (elbow) => 300 * Math.sin((elbow * Math.PI) / 360);
  const angles = [...hold(TOP, 0.4), ...ramp(TOP, 80, 0.8), ...ramp(80, TOP, 0.8)];
  const out = reps(run(an, angles.map((elbow) => pushupPose({ elbow, shoulder: S, wrist: { x: S.x, y: S.y + chord(elbow) } }))));
  assert.equal(an.count, 0);
  assert.ok(out[0].issues.includes('drop'));
});
