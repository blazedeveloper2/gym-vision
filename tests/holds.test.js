import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, hold, play, playViews } from './body3d.js';
import { HandstandHold, PlancheHold, LeverHold, HollowHold, ArchHold } from '../js/exercises/holds.js';

const side = (j, o = {}) => film(j, { view: 'side', offset: [640, 360], ...o });
const sets = (events) => events.filter((e) => e.type === 'set').map((e) => e.set);
const cues = (events) => events.filter((e) => e.type === 'cue').map((e) => e.key);
const standing = side(skeleton());

// ---------- handstands: upside down (pitch 180), arms in line with the body
const handstand = ({ lean = 0, hip = 0, elbow = 0, oneArm = false } = {}) => {
  const arm = { abd: 178, elbow, plane: 'forward' };
  const free = { abd: 90 };
  return side(skeleton({ rot: { pitch: 180 }, lean, arms: [arm, oneArm ? free : arm], legs: [{ hip }, { hip }] }), { offset: [640, 330], farVis: 0.5 });
};

test('handstand: times the hold while upside down, not while standing', () => {
  const an = new HandstandHold({ variant: 'wall' });
  const events = play(an, [...hold(standing, 1), ...hold(handstand(), 12), ...hold(standing, 1.5)]);
  const s = sets(events);
  assert.equal(s.length, 1);
  assert.ok(s[0].ms > 11500 && s[0].ms < 12500, `held ${s[0].ms}`);
  assert.ok(s[0].form > 0.95);
  assert.equal(an.voiceLine(events.find((e) => e.type === 'start')), 'Hold');
});

test('handstand: bent arms, a banana back and a pike are called out', () => {
  for (const [pose, key] of [[handstand({ elbow: 40 }), 'bent'], [handstand({ lean: -22, hip: -22 }), 'banana'], [handstand({ lean: 28, hip: 28 }), 'pike']]) {
    const an = new HandstandHold({ variant: 'free' });
    const events = play(an, [...hold(pose, 5), ...hold(standing, 1.5)]);
    assert.ok(cues(events).includes(key), `${key}: ${cues(events)}`);
    assert.ok(sets(events)[0].form < 0.5, key);
  }
});

test('handstand: a fault that lasts is repeated, not said once and forgotten', () => {
  const an = new HandstandHold({ variant: 'free' });
  const events = play(an, hold(handstand({ elbow: 40 }), 14));
  assert.ok(cues(events).filter((k) => k === 'bent').length >= 2);
});

test('kick-ups: every kick-up is an attempt, scored by the time caught', () => {
  const an = new HandstandHold({ variant: 'free' }, null);
  an.setOptions({ attempts: true, minSetMs: 300 });
  const events = play(an, [...hold(standing, 1), ...hold(handstand(), 1.2), ...hold(standing, 1.2), ...hold(handstand(), 3), ...hold(standing, 1.2), ...hold(handstand(), 0.6), ...hold(standing, 1.2)]);
  const s = sets(events);
  assert.equal(s.length, 3);
  assert.ok(an.best > 2800 && an.best < 3200);
  assert.match(an.voiceLine({ type: 'set', set: s[1] }), /^3 seconds$/);
});

test('one-arm handstand: the timer only runs with one hand off the floor', () => {
  const two = new HandstandHold({ variant: 'oneArm' });
  assert.equal(playViews(two, hold(handstand(), 1)).at(-1).status, 'setup');
  const one = new HandstandHold({ variant: 'oneArm' });
  assert.equal(playViews(one, hold(handstand({ oneArm: true }), 1)).at(-1).status, 'active');
});

// ---------- joint-by-joint poses (side-on, facing image left = −z); points are [z, y]
function rig(p) {
  const j = skeleton();
  for (const [s, dx] of [['left', 1], ['right', -1]]) {
    const put = (name, q, w) => (j[`${s}${name}`] = [dx * w, q[1], q[0]]);
    put('Shoulder', p.sh, 0.19);
    put('Elbow', p.el, 0.2);
    put('Wrist', p.wr, 0.2);
    put('Index', [p.wr[0] - 0.06, p.wr[1] + 0.02], 0.2);
    put('Pinky', [p.wr[0] - 0.05, p.wr[1] + 0.02], 0.22);
    put('Thumb', [p.wr[0] - 0.03, p.wr[1] + 0.01], 0.18);
    put('Hip', p.hip, 0.1);
    put('Knee', p.knee, 0.1);
    put('Ankle', p.ank, 0.1);
    put('Heel', [p.ank[0] + 0.04, p.ank[1] + 0.03], 0.1);
    put('Foot', p.toe ?? [p.ank[0] + 0.12, p.ank[1] + 0.05], 0.1);
  }
  const hd = p.head ?? [p.sh[0] - 0.2, p.sh[1] - 0.05];
  j.leftEar = [0.07, hd[1], hd[0]];
  j.rightEar = [-0.07, hd[1], hd[0]];
  j.nose = [0, hd[1] + (p.face?.[1] ?? 0.06), hd[0] + (p.face?.[0] ?? -0.06)];
  return j;
}

// ---------- planche ladder (floor at y = 0.9)
const F = 0.9;
const plancheRig = (step, { feetDown = false, bent = 0, hipsLow = 0 } = {}) => {
  const wr = [0, F - 0.04];
  const straightArm = step !== 'frog';
  const sh = straightArm ? [-0.12, F - 0.6 + bent * 0.3] : [-0.08, F - 0.42];
  const el = straightArm ? [(sh[0] + wr[0]) / 2 + bent, (sh[1] + wr[1]) / 2] : [0.1, F - 0.25];
  const hip = [sh[0] + 0.48, sh[1] + 0.02 + hipsLow];
  const lift = feetDown ? 0 : 0.12;
  // Feet down: crouched behind the hands, toes on the floor (how every hold starts and ends).
  if (feetDown) return side(rig({ sh, el, wr, hip: [sh[0] + 0.4, sh[1] + 0.2], knee: [0.1, F - 0.3], ank: [0.4, F - 0.08], face: [-0.03, 0.07] }), { offset: [560, 200] });
  const legs = {
    frog: { knee: [0.12, F - 0.3], ank: [0.42, F - 0.08 - lift] },
    saFrog: { knee: [0.05, F - 0.35], ank: [0.4, F - 0.08 - lift] },
    tuck: { knee: [hip[0] - 0.25, hip[1] + 0.3], ank: [hip[0] + 0.05, hip[1] + 0.35] },
    advTuck: { knee: [hip[0] + 0.02, hip[1] + 0.43], ank: [hip[0] + 0.4, hip[1] + 0.38] },
    straddle: { knee: [hip[0] + 0.43, hip[1] + 0.02], ank: [hip[0] + 0.85, hip[1] + 0.04] },
    halfLay: { knee: [hip[0] + 0.43, hip[1] + 0.02], ank: [hip[0] + 0.45, hip[1] + 0.44] },
    full: { knee: [hip[0] + 0.43, hip[1] + 0.02], ank: [hip[0] + 0.85, hip[1] + 0.04] },
  }[step];
  return side(rig({ sh, el, wr, hip, ...legs, face: [-0.03, 0.07] }), { offset: [560, 200] });
};

test('planche ladder: each step times a hold only with the feet off the floor', () => {
  for (const step of ['frog', 'saFrog', 'tuck', 'advTuck', 'straddle', 'halfLay', 'full']) {
    const down = new PlancheHold({ step });
    assert.equal(playViews(down, hold(plancheRig(step, { feetDown: true }), 1)).at(-1).status, 'setup', step);

    const an = new PlancheHold({ step });
    const events = play(an, [...hold(plancheRig(step, { feetDown: true }), 1), ...hold(plancheRig(step), 6), ...hold(plancheRig(step, { feetDown: true }), 1.5)]);
    const s = sets(events);
    assert.equal(s.length, 1, step);
    assert.ok(s[0].form > 0.9, `${step} form ${s[0].form} ${s[0].issues}`);
  }
});

test('planche: bent arms on a straight-arm step and low hips are called out', () => {
  const bent = new PlancheHold({ step: 'tuck' });
  const e1 = play(bent, [...hold(plancheRig('tuck', { feetDown: true }), 1), ...hold(plancheRig('tuck', { bent: 0.12 }), 4)]);
  assert.ok(cues(e1).includes('bent'), String(cues(e1)));

  const low = new PlancheHold({ step: 'full' });
  const e2 = play(low, [...hold(plancheRig('full', { feetDown: true }), 1), ...hold(plancheRig('full', { hipsLow: 0.08 }), 4)]);
  assert.ok(cues(e2).includes('hipsLow'), String(cues(e2)));

  const frog = new PlancheHold({ step: 'frog' });
  const e3 = play(frog, [...hold(plancheRig('frog', { feetDown: true }), 1), ...hold(plancheRig('frog'), 4)]);
  assert.ok(!cues(e3).includes('bent'), 'the frog stand is done on bent arms');
});

// ---------- front lever ladder: hanging from a bar at y = −0.4, body level below it
const leverRig = (step, { hipsLow = 0, bent = 0 } = {}) => {
  const wr = [-0.35, -0.4];
  const sh = [0, 0 + bent * 0.3];
  const el = [(sh[0] + wr[0]) / 2 - bent * 0.6, (sh[1] + wr[1]) / 2 + bent * 0.8];
  const hip = [0.48, hipsLow];
  const legs = {
    tuck: { knee: [0.3, hipsLow - 0.25], ank: [0.62, hipsLow - 0.2] },
    advTuck: { knee: [0.5, hipsLow + 0.42], ank: [0.9, hipsLow + 0.4] },
    straddle: { knee: [0.9, hipsLow], ank: [1.32, hipsLow] },
    halfLay: { knee: [0.9, hipsLow], ank: [0.92, hipsLow + 0.42] },
    full: { knee: [0.9, hipsLow], ank: [1.32, hipsLow] },
  }[step];
  return side(rig({ sh, el, wr, hip, ...legs, head: [-0.2, 0.03], face: [0, -0.07] }), { offset: [520, 330] });
};
const deadHang = side(rig({ sh: [0, 0], el: [0, -0.2], wr: [0, -0.4], hip: [0, 0.5], knee: [0, 0.93], ank: [0, 1.35] }), { offset: [640, 200] });

test('front lever ladder: each step times a level hold, not a dead hang', () => {
  for (const step of ['tuck', 'advTuck', 'straddle', 'halfLay', 'full']) {
    const an = new LeverHold({ step });
    assert.equal(playViews(new LeverHold({ step }), hold(deadHang, 0.5)).at(-1).status, 'setup', step);
    const events = play(an, [...hold(deadHang, 1), ...hold(leverRig(step), 6), ...hold(deadHang, 1.5)]);
    const s = sets(events);
    assert.equal(s.length, 1, step);
    assert.ok(s[0].form > 0.9, `${step} form ${s[0].form} ${s[0].issues}`);
  }
});

test('front lever: hips sagging below the shoulders and bent arms are called out', () => {
  const an = new LeverHold({ step: 'full' });
  const e = play(an, hold(leverRig('full', { hipsLow: 0.14 }), 4));
  assert.ok(cues(e).includes('hipsLow'), String(cues(e)));
  const b = new LeverHold({ step: 'tuck' });
  const e2 = play(b, hold(leverRig('tuck', { bent: 0.15 }), 4));
  assert.ok(cues(e2).includes('bent'), String(cues(e2)));
});

// ---------- hollow holds: on your back (pitch −90), shoulders and legs up
const hollow = ({ lean = 14, hip = 25, knee = 0, arms = 10, legs = null } = {}) =>
  side(skeleton({ rot: { pitch: -90 }, lean, arms: [{ flex: arms }, { flex: arms }], legs: legs ?? [{ hip, knee }, { hip, knee }] }), { offset: [640, 420] });
const flat = side(skeleton({ rot: { pitch: -90 } }), { offset: [640, 420] });

test('hollow holds: each step times the right shape', () => {
  const cases = [
    ['tuck', hollow({ hip: 110, knee: 110 })],
    ['oneLeg', hollow({ legs: [{ hip: 20 }, { hip: 110, knee: 110 }] })],
    ['full', hollow()],
    ['overhead', hollow({ arms: 175 })],
  ];
  for (const [step, pose] of cases) {
    const an = new HollowHold({ step });
    const events = play(an, [...hold(flat, 1), ...hold(pose, 6), ...hold(flat, 1.5)]);
    const s = sets(events);
    assert.equal(s.length, 1, step);
    assert.ok(s[0].form > 0.9, `${step} form ${s[0].form} ${s[0].issues}`);
  }
});

test('hollow holds: lying flat pauses the timer; low legs and arms down are called out', () => {
  assert.equal(playViews(new HollowHold({ step: 'full' }), hold(flat, 1)).at(-1).status, 'setup');
  const low = new HollowHold({ step: 'full' });
  assert.ok(cues(play(low, hold(hollow({ hip: 4 }), 3))).includes('legsLow'));
  const arms = new HollowHold({ step: 'overhead' });
  assert.ok(cues(play(arms, hold(hollow({ arms: 60 }), 3))).includes('arms'));
});

// ---------- arch holds: face down (pitch 90), chest and legs lifted
const arch = ({ lean = -12, hip = -14, knee = 0, neck = 0, arms = 5 } = {}) =>
  side(skeleton({ rot: { pitch: 90 }, lean, neck, arms: [{ flex: arms }, { flex: arms }], legs: [{ hip, knee }, { hip, knee }] }), { offset: [640, 420] });

test('arch holds: times the hold, called out for bent knees and a cranked neck', () => {
  const an = new ArchHold({ step: 'hold' });
  const flatDown = side(skeleton({ rot: { pitch: 90 } }), { offset: [640, 420] });
  const s = sets(play(an, [...hold(flatDown, 1), ...hold(arch(), 5), ...hold(flatDown, 1.5)]));
  assert.equal(s.length, 1);
  assert.ok(s[0].form > 0.9, `form ${s[0].form} ${s[0].issues}`);

  assert.ok(cues(play(new ArchHold(), hold(arch({ knee: 60 }), 3))).includes('knees'));
  assert.ok(cues(play(new ArchHold(), hold(arch({ neck: -60 }), 3))).includes('neck'));
});
