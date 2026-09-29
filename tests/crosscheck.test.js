// Every exercise run over recorded clips of other exercises: nothing should
// count unless it's the same movement (see tests/fixtures/README.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { EXERCISES } from '../js/exercises/index.js';

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

// What each clip is allowed to count, beyond zero: the movement itself and its close relatives.
const ALLOWED = {
  pushup_army_hrp: { pushup: 6, 'diamond-pushup': 6, plank: Infinity, 'scap-pushup': 1 },
  squat_demo_rear: { squat: 2, 'front-squat': 2, 'goblet-squat': 2 },
  // The kettlebell is curled up into the rack once, which is a real curl.
  squat_kettlebell_side: { squat: 6, 'front-squat': 6, 'goblet-squat': 6, curl: 1, 'hammer-curl': 1 },
  // Can't tell the grip apart on camera: a chin-up counts the same reps.
  pullup_demo: { 'pull-up': 2, 'chin-up': 2 },
  shoulder_press_demo: { press: 1 },
  // Filmed from above at 3/4 rather than side-on; it may count, but never more than the 2 real reps.
  bench_press_demo: { 'bench-press': 2 },
  // Filmed from the front, so the incline press asks to turn side-on; nothing else may count.
  incline_press_demo: { 'incline-press': 2 },
  // A deadlift from the floor is a hinge with bent knees: an RDL may count it (with a knees warning).
  deadlift_demo: { rdl: 1, 'bb-rdl': 1 },
  // Lying on a bench with the arms up: no hanging, curling or overhead work in here.
  db_bench_side: {},
  db_bench_close: { 'bench-press': 1 },
};
const settings = { depthTarget: 90, squatDepth: 'parallel' };

for (const [clip, allowed] of Object.entries(ALLOWED)) {
  for (const model of ['lite', 'full']) {
    const frames = load(`${clip}.${model}.json.gz`);
    test(`${clip} (${model}): no exercise counts what isn't there`, { skip: !frames && 'fixture not recorded' }, () => {
      const wrong = [];
      for (const ex of EXERCISES) {
        const an = ex.create(settings);
        for (const f of frames) an.update(f, 'auto');
        const limit = allowed[ex.id] ?? 0;
        if (an.count > limit) wrong.push(`${ex.id}=${an.count}`);
      }
      assert.deepEqual(wrong, []);
    });
  }
}

test('squat variants count the same squats as squats', { skip: !load('squat_kettlebell_side.full.json.gz') && 'fixture not recorded' }, () => {
  for (const [clip, n] of [['squat_kettlebell_side', 6], ['squat_demo_rear', 2]]) {
    for (const model of ['lite', 'full']) {
      const frames = load(`${clip}.${model}.json.gz`);
      for (const id of ['front-squat', 'goblet-squat']) {
        const an = EXERCISES.find((e) => e.id === id).create(settings);
        for (const f of frames) an.update(f, 'auto');
        assert.equal(an.count, n, `${id} on ${clip}.${model}`);
      }
    }
  }
});
