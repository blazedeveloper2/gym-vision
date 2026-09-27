// Regression tests on pose landmarks recorded from real workout videos
// (see tests/fixtures/README.md for sources and licences).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PushupAnalyzer } from '../js/exercises/pushup.js';
import { SquatAnalyzer } from '../js/exercises/squat.js';
import { JacksAnalyzer } from '../js/exercises/jacks.js';
import { PressAnalyzer } from '../js/exercises/press.js';
import { LateralRaiseAnalyzer } from '../js/exercises/lateral.js';

const dir = new URL('./fixtures/', import.meta.url);

function load(name) {
  const file = new URL(name, dir);
  if (!existsSync(file)) return null;
  const { fps, w, h, frames } = JSON.parse(gunzipSync(readFileSync(file)).toString());
  return frames.map((f, i) => {
    const t = (i * 1000) / fps;
    if (!f) return { lm: null, world: null, w, h, t };
    const lm = [];
    const world = [];
    for (let k = 0; k < 33; k++) {
      lm.push({ x: f.l[k * 4], y: f.l[k * 4 + 1], z: f.l[k * 4 + 2], visibility: f.l[k * 4 + 3] });
      world.push({ x: f.g[k * 3], y: f.g[k * 3 + 1], z: f.g[k * 3 + 2] });
    }
    return { lm, world, w, h, t };
  });
}

function run(analyzer, frames) {
  const reps = [];
  for (const f of frames) for (const e of analyzer.update(f, 'auto').events) if (e.type === 'rep') reps.push(e.rep);
  return reps;
}

const CASES = [
  // Army hand-release push-ups: 6 real reps; lifting the hands at the bottom must not add reps.
  { clip: 'pushup_army_hrp', make: () => new PushupAnalyzer(), count: 6 },
  // Barbell back squat filmed from behind: 2 reps.
  { clip: 'squat_demo_rear', make: () => new SquatAnalyzer(), count: 2 },
  // Racked kettlebell squats, side-on: 6 deep reps.
  { clip: 'squat_kettlebell_side', make: () => new SquatAnalyzer(), count: 6 },
];

for (const model of ['lite', 'full']) {
  for (const c of CASES) {
    const frames = load(`${c.clip}.${model}.json.gz`);
    test(`${c.clip} (${model} model): ${c.count} reps`, { skip: !frames && 'fixture not recorded' }, () => {
      const an = c.make();
      run(an, frames);
      assert.equal(an.count, c.count);
    });
  }

  // Exercises that don't match the video shouldn't find reps in it.
  const others = [
    ['pushup_army_hrp', () => new SquatAnalyzer()],
    ['squat_kettlebell_side', () => new PushupAnalyzer()],
    ['squat_kettlebell_side', () => new JacksAnalyzer()],
    ['squat_demo_rear', () => new LateralRaiseAnalyzer()],
    ['pushup_army_hrp', () => new PressAnalyzer()],
  ];
  for (const [clip, make] of others) {
    const frames = load(`${clip}.${model}.json.gz`);
    const name = make().constructor.name;
    test(`${name} finds no reps in ${clip} (${model} model)`, { skip: !frames && 'fixture not recorded' }, () => {
      const an = make();
      run(an, frames);
      assert.equal(an.count, 0);
    });
  }
}
