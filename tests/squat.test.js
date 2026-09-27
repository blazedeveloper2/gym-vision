import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquatAnalyzer } from '../js/exercises/squat.js';
import { squatPose, ramp, hold, run } from './synthetic.js';

const reps = (events) => events.filter((e) => e.type === 'rep').map((e) => e.rep);

/** One squat: stand, lower to progress `f` (1 ≈ just below parallel), pause, stand up. */
function squat(f, opts = {}) {
  const steps = [...hold(0, 0.6), ...ramp(0, f, 1.0), ...hold(f, 0.3), ...ramp(f, 0, 1.0)];
  return steps.map((x) => squatPose({ f: x, ...opts, lean: opts.lean && x > 0.5 ? opts.lean : null }));
}

test('counts side-on squats to parallel', () => {
  const an = new SquatAnalyzer();
  const out = reps(run(an, [...squat(1), ...squat(1), ...squat(1)], 'auto'));
  assert.equal(out.length, 3);
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('does not count a half squat when parallel is required', () => {
  const an = new SquatAnalyzer();
  const out = reps(run(an, [...squat(1), ...squat(0.6)], 'auto'));
  assert.equal(an.count, 1);
  assert.equal(an.partials, 1);
  assert.ok(out[1].issues.includes('depth'));
});

test('half-squat target counts shallower reps', () => {
  const an = new SquatAnalyzer({ depthTarget: 'half' });
  run(an, squat(0.7), 'auto'); // hips ~2/3 of the way to parallel
  assert.equal(an.count, 1);
});

test('below-parallel target rejects a rep that only just reaches parallel', () => {
  const an = new SquatAnalyzer({ depthTarget: 'deep' });
  run(an, squat(0.95), 'auto');
  assert.equal(an.count, 0);
  assert.equal(an.partials, 1);
});

test('flags excessive forward lean (side view)', () => {
  const an = new SquatAnalyzer();
  const out = reps(run(an, [...squat(1), ...squat(1, { lean: 65 })], 'auto'));
  assert.equal(an.count, 2);
  assert.deepEqual(out[0].issues, []);
  assert.ok(out[1].issues.includes('lean'));
});

test('front view: counts reps and flags knees caving in', () => {
  const an = new SquatAnalyzer();
  const out = reps(run(an, [...squat(1, { front: true }), ...squat(1, { front: true, valgus: true })], 'auto'));
  assert.equal(an.facing, 'front');
  assert.equal(an.count, 2);
  assert.deepEqual(out[0].issues, []);
  assert.ok(out[1].issues.includes('knees'));
});
