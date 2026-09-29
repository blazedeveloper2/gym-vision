import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, cycle, hold, play, playViews, repsOf, lerp } from './body3d.js';
import { RowAnalyzer, RearFlyAnalyzer, SnowAngelAnalyzer } from '../js/exercises/back.js';

const reps = (n, fn, secs = 2.4) => Array.from({ length: n }, () => cycle(secs).map(fn)).flat();
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const side = (j) => film(j, { view: 'side', offset: [640, 360] });
const DOWN = [0, 1, 0];

// ---------- single-arm row: torso flat (lean 85), rowing arm nearest the camera
const rowTop = unit([0, -0.25, 0.97]); // elbow up past the back, toward the hip
const rowArm = (t, { straight = false, top = 1 } = {}) => {
  const upper = unit(mix(DOWN, rowTop, t * top));
  return { dir: upper, fore: straight ? upper : DOWN };
};
const singleRow = (t, o = {}) => side(skeleton({ lean: 85, arms: [rowArm(t, o), { dir: DOWN, fore: DOWN }] }));

test('single-arm rows: counts rows to the hip', () => {
  const an = new RowAnalyzer({ support: 'bench' });
  play(an, reps(3, (t) => singleRow(t)));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('single-arm rows: short rows and straight-arm swings are not counted', () => {
  const short = new RowAnalyzer({ support: 'bench' });
  play(short, reps(2, (t) => singleRow(t, { top: 0.5 })));
  assert.equal(short.count, 0);

  const swing = new RowAnalyzer({ support: 'bench' });
  const out = repsOf(play(swing, reps(2, (t) => singleRow(t, { straight: true }))));
  assert.equal(swing.count, 0);
  assert.ok(out.every((x) => x.issues.includes('straight')), JSON.stringify(out.map((x) => x.issues)));
});

test('single-arm rows: standing up is not the row position', () => {
  const standing = side(skeleton());
  assert.equal(playViews(new RowAnalyzer({ support: 'bench' }), hold(standing, 0.3)).at(-1).status, 'setup');
});

// ---------- chest-supported rows: chest on a 40° bench
const csRowTop = (lean) => {
  const back = [0, Math.cos((lean * Math.PI) / 180), Math.sin((lean * Math.PI) / 180)]; // toward the hips along the back
  const out = [0, -Math.sin((lean * Math.PI) / 180), Math.cos((lean * Math.PI) / 180)]; // away from the chest
  return unit(mix(back, out, 0.3));
};
const csRow = (t, { lean = 50, liftTo = null, top = 1 } = {}) => {
  const l = liftTo == null ? lean : lerp(lean, liftTo, t);
  const upper = unit(mix(DOWN, csRowTop(l), t * top));
  // Forearm hangs, or points at the chest once the torso is more upright.
  const arm = { dir: upper, fore: liftTo == null ? DOWN : unit(mix(DOWN, [0, 0.3, -0.95], t)) };
  return side(skeleton({ lean: l, arms: [arm, arm], legs: [{ hip: -10 }, { hip: -10 }] }));
};

test('chest-supported rows: counts rows with the chest on the pad', () => {
  const an = new RowAnalyzer({ support: 'chest' });
  play(an, reps(3, (t) => csRow(t)));
  assert.equal(an.count, 3);
});

test('chest-supported rows: lifting the chest off the pad to jerk it up is not counted', () => {
  const an = new RowAnalyzer({ support: 'chest' });
  const out = repsOf(play(an, [...hold(csRow(0), 0.5), ...reps(2, (t) => csRow(t, { liftTo: 28 }))]));
  assert.equal(an.count, 0);
  assert.ok(out.every((x) => x.issues.includes('chest')), JSON.stringify(out.map((x) => x.issues)));
  assert.match(an.repText(out[0])[0], /chest/);
});

// ---------- reverse flyes: chest on a 30° bench, arms sweep out to the sides
const flyTop = [1, 0.12, 0];
const rearFly = (t, { bend = 15, top = 1, row = false } = {}) => {
  if (row) {
    const upper = unit(mix(DOWN, csRowTop(60), t));
    return side(skeleton({ lean: 60, arms: [{ dir: upper, fore: DOWN }, { dir: upper, fore: DOWN }], legs: [{ hip: -10 }, { hip: -10 }] }));
  }
  const upper = unit(mix(DOWN, flyTop, t * top));
  const arm = { dir: upper, fore: unit(mix(upper, DOWN, bend / 90)) };
  return side(skeleton({ lean: 60, arms: [arm, arm], legs: [{ hip: -10 }, { hip: -10 }] }));
};

test('reverse flyes: counts raises to shoulder height', () => {
  const an = new RearFlyAnalyzer();
  play(an, reps(3, (t) => rearFly(t)));
  assert.equal(an.count, 3);
});

test('reverse flyes: low raises and rowing are not counted', () => {
  const low = new RearFlyAnalyzer();
  play(low, reps(2, (t) => rearFly(t, { top: 0.55 })));
  assert.equal(low.count, 0);

  const row = new RearFlyAnalyzer();
  const out = repsOf(play(row, reps(2, (t) => rearFly(t, { row: true }))));
  assert.equal(row.count, 0);
  assert.ok(out.every((x) => x.issues.includes('row') || x.issues.includes('depth')), JSON.stringify(out.map((x) => x.issues)));
});

// ---------- reverse snow angels: face down on a flat bench
// Body frame for these: [out, toward the feet, toward the back (up when face down)].
const angelArm = (t, { lift = 0.3, top = 1 } = {}) => {
  const a = Math.PI * Math.min(1, t * top); // 0 at the hips → π overhead
  return { dir: unit([Math.sin(a), Math.cos(a), lift]), fore: unit([Math.sin(a), Math.cos(a), lift]) };
};
const angel = (t, o = {}) => side(skeleton({ rot: { pitch: 90 }, arms: [angelArm(t, o), angelArm(t, o)] }));

test('reverse snow angels: counts full sweeps', () => {
  const an = new SnowAngelAnalyzer();
  play(an, reps(3, (t) => angel(t), 3));
  assert.equal(an.count, 3);
  assert.equal(an.clean, 3);
});

test('reverse snow angels: half sweeps are not counted; dropped arms are called out', () => {
  const half = new SnowAngelAnalyzer();
  play(half, reps(2, (t) => angel(t, { top: 0.5 }), 3));
  assert.equal(half.count, 0);

  const drop = new SnowAngelAnalyzer();
  const events = play(drop, reps(1, (t) => angel(t, { lift: -0.7 }), 3));
  assert.ok(events.some((e) => e.type === 'cue' && e.key === 'drop'));
});
