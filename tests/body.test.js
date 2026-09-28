import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton, film, W, H } from './body3d.js';
import { P } from '../js/geometry.js';
import { createSampler, edgeDistance, crossWidth, measureFrame, checkPose, StepCapture, combine } from '../js/body/measure.js';
import { computeParts, identify } from '../js/body/parts.js';

// ---------- a synthetic silhouette with known sizes (px), built from capsules
function capsuleMask(lm, caps) {
  const data = new Float32Array(W * H);
  const pt = (p) => (typeof p === 'number' ? { x: lm[p].x * W, y: lm[p].y * H } : p);
  const cs = caps.map(([a, b, r]) => [pt(a), pt(b), r]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let d = Infinity;
      for (const [a, b, r] of cs) {
        const bx = b.x - a.x, by = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * bx + (y + 0.5 - a.y) * by) / Math.max(bx * bx + by * by, 1e-6)));
        d = Math.min(d, Math.hypot(x + 0.5 - a.x - bx * t, y + 0.5 - a.y - by * t) - r);
      }
      data[y * W + x] = Math.max(0, Math.min(1, 0.5 - d / 2)); // soft 2 px edge, like a real mask
    }
  }
  return { data, w: W, h: H };
}

const aPose = () =>
  film(skeleton({ arms: [{ abd: 28, elbow: 8 }, { abd: 28, elbow: 8 }], legs: [{ abd: 6 }, { abd: 6 }] }));

const R = { arm: 15, forearm: 12, thigh: 26, calf: 17 };
function bodyMask(lm) {
  const px = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const mid = (a, b) => ({ x: (px(a).x + px(b).x) / 2, y: (px(a).y + px(b).y) / 2 });
  const S = mid(P.leftShoulder, P.rightShoulder);
  const Hc = mid(P.leftHip, P.rightHip);
  const head = mid(P.leftEar, P.rightEar);
  const along = (t) => ({ x: S.x + (Hc.x - S.x) * t, y: S.y + (Hc.y - S.y) * t });
  const caps = [
    [head, head, 28],
    [S, along(0.2), 16], // neck
    [along(0.12), along(0.45), 52], // chest
    [along(0.5), along(0.8), 44], // waist
    [P.leftHip, P.rightHip, 40],
    [P.leftShoulder, P.leftElbow, R.arm],
    [P.rightShoulder, P.rightElbow, R.arm],
    [P.leftElbow, P.leftWrist, R.forearm],
    [P.rightElbow, P.rightWrist, R.forearm],
    [P.leftHip, P.leftKnee, R.thigh],
    [P.rightHip, P.rightKnee, R.thigh],
    [P.leftKnee, P.leftAnkle, R.calf],
    [P.rightKnee, P.rightAnkle, R.calf],
    [P.leftAnkle, { x: px(P.leftAnkle).x, y: px(P.leftAnkle).y + 18 }, 10],
    [P.rightAnkle, { x: px(P.rightAnkle).x, y: px(P.rightAnkle).y + 18 }, 10],
  ];
  const expectHeight = px(P.leftAnkle).y + 28 - (head.y - 28);
  return { mask: capsuleMask(lm, caps), expectHeight };
}

test('edge finding is sub-pixel accurate on a disc', () => {
  const w = 200, h = 200;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(1, 0.5 - (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) - 40) / 2));
  const s = createSampler(data, w, h);
  assert.ok(Math.abs(edgeDistance(s, 100, 100, 1, 0, 80) - 40) < 0.3);
  const r = crossWidth(s, { x: 100, y: 100 }, { x: 0, y: 1 }, [80, 80]);
  assert.ok(Math.abs(r.width - 80) < 0.5, `width ${r.width}`);
  assert.equal(edgeDistance(s, 5, 5, 1, 0, 50), null, 'start outside the body');
});

test('front measurement: height and limb widths match the silhouette', () => {
  const { lm } = aPose();
  const { mask, expectHeight } = bodyMask(lm);
  assert.deepEqual(checkPose('front', lm, W, H), []);
  const m = measureFrame('front', mask, lm);
  assert.ok(Math.abs(m.heightPx - expectHeight) < 2, `height ${m.heightPx} vs ${expectHeight}`);
  for (const [id, r] of [['armL', R.arm], ['armR', R.arm], ['forearmL', R.forearm], ['thighL', R.thigh], ['thighR', R.thigh], ['calfL', R.calf]]) {
    assert.ok(m.widths[id], `${id} measured`);
    assert.ok(Math.abs(m.widths[id].width - 2 * r) < 1.5, `${id}: ${m.widths[id].width.toFixed(1)} vs ${2 * r}`);
  }
  assert.ok(m.widths.waist.width < m.widths.chest.width, 'waist narrower than chest');
});

test('captures reduce to centimetres and circumferences', () => {
  const { lm } = aPose();
  const { mask, expectHeight } = bodyMask(lm);
  const cap = new StepCapture('front', 180);
  const frame = measureFrame('front', mask, lm);
  for (let i = 0; i < 10; i++) cap.add(frame);
  const results = combine({ front: cap });
  const arm = results.find((r) => r.id === 'armL');
  const cmPerPx = 180 / expectHeight;
  const expected = Math.PI * 2 * R.arm * cmPerPx;
  assert.ok(Math.abs(arm.value - expected) / expected < 0.03, `arm ${arm.value.toFixed(1)} vs ${expected.toFixed(1)} cm`);
  assert.ok(arm.plusMinus > 0 && arm.plusMinus < 2);
  const waist = results.find((r) => r.id === 'waist');
  assert.match(waist.note, /side/);
});

test('pose checks catch common capture problems', () => {
  const armsDown = film(skeleton({ arms: [{ abd: 3 }, { abd: 3 }] })).lm;
  assert.ok(checkPose('front', armsDown, W, H).some((p) => /away from your body/.test(p)));
  const side = film(skeleton(), { view: 'side', farVis: 0.9 }).lm;
  assert.ok(checkPose('front', side, W, H).includes('Face the camera'));
  assert.deepEqual(checkPose('side', side, W, H), []);
});

// ---------- body-part identifier
const at = (lm, i, dx = 0, dy = 0) => [lm[i].x * W + dx, lm[i].y * H + dy];
const mid2 = (lm, a, b, t = 0.5) => [
  (lm[a].x + (lm[b].x - lm[a].x) * t) * W,
  (lm[a].y + (lm[b].y - lm[a].y) * t) * H,
];
const name = (ctx, [x, y]) => identify(ctx, x, y)?.name;

test('identifies face parts facing the camera', () => {
  const { lm } = film(skeleton());
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.facing, 'front');
  assert.equal(name(ctx, at(lm, 2)), 'Left eye');
  assert.equal(name(ctx, at(lm, 5)), 'Right eye');
  assert.equal(name(ctx, at(lm, P.nose)), 'Nose');
  assert.equal(name(ctx, mid2(lm, 9, 10)), 'Mouth');
  assert.equal(name(ctx, at(lm, 2, 0, -18)), 'Forehead');
});

test('identifies muscles facing the camera, from behind and side-on', () => {
  const front = film(skeleton()).lm;
  const fctx = computeParts(front, W, H);
  assert.equal(name(fctx, mid2(front, P.leftHip, P.leftKnee, 0.45)), 'Left quads');
  assert.equal(name(fctx, mid2(front, P.leftShoulder, P.leftElbow, 0.55)), 'Left biceps');
  assert.equal(name(fctx, at(front, P.leftKnee)), 'Left kneecap');
  // Left pec is on the image right when facing the camera.
  const S = mid2(front, P.leftShoulder, P.rightShoulder);
  const Hc = mid2(front, P.leftHip, P.rightHip);
  assert.equal(name(fctx, [S[0] + 25, S[1] + (Hc[1] - S[1]) * 0.3]), 'Left pec');
  assert.equal(name(fctx, [S[0], S[1] + (Hc[1] - S[1]) * 0.6]), 'Middle abs');
  assert.equal(name(fctx, [S[0] + 3, S[1] + (Hc[1] - S[1]) * 0.53]), 'Upper abs');

  const back = film(skeleton(), { view: 'back' }).lm;
  const bctx = computeParts(back, W, H);
  assert.equal(bctx.facing, 'back');
  assert.equal(name(bctx, mid2(back, P.leftShoulder, P.leftElbow, 0.55)), 'Left triceps');
  assert.equal(name(bctx, at(back, P.leftKnee)), 'Back of left knee');
  assert.match(name(bctx, mid2(back, P.leftHip, P.leftKnee, 0.5)), /hamstring/);

  // Side-on the far leg is mostly hidden (low visibility), like real footage.
  const side = film(skeleton(), { view: 'side' }).lm;
  const sctx = computeParts(side, W, H);
  assert.equal(sctx.facing, 'side');
  const thigh = mid2(side, P.leftHip, P.leftKnee, 0.5);
  // Side-on, the person faces image-left: that half of the thigh is the quads.
  assert.equal(name(sctx, [thigh[0] - 18, thigh[1]]), 'Left quads');
  assert.equal(name(sctx, [thigh[0] + 18, thigh[1]]), 'Left hamstrings');
});

test('finger identification uses hand landmarks and matches the right hand', () => {
  const { lm } = film(skeleton());
  // A flat hand below the left wrist: fingers pointing down.
  const wr = { x: lm[P.leftWrist].x, y: lm[P.leftWrist].y };
  const hand = Array.from({ length: 21 }, (_, i) => {
    if (i === 0) return { ...wr, z: 0 };
    const finger = Math.floor((i - 1) / 4);
    const joint = (i - 1) % 4;
    return { x: wr.x + (finger - 2) * 0.008, y: wr.y + 0.02 + joint * 0.012, z: 0 };
  });
  const ctx = computeParts(lm, W, H, { landmarks: [hand] });
  const tip = [hand[8].x * W, hand[8].y * H];
  assert.equal(name(ctx, tip), 'Left index finger');
  assert.match(identify(ctx, ...tip).detail, /tip/);
});

test('points off the body are not identified', () => {
  const { lm } = film(skeleton());
  const ctx = computeParts(lm, W, H);
  assert.equal(identify(ctx, 20, 20), null);
});

// ---------- detailed anatomy
const torsoPt = (lm, tt, dx = 0) => {
  const S = mid2(lm, P.leftShoulder, P.rightShoulder);
  const Hc = mid2(lm, P.leftHip, P.rightHip);
  return [S[0] + (Hc[0] - S[0]) * tt + dx, S[1] + (Hc[1] - S[1]) * tt];
};

test('uses sex-specific anatomical names when sex is set', () => {
  const { lm } = film(skeleton());
  const male = computeParts(lm, W, H, null, null, { sex: 'male' });
  const female = computeParts(lm, W, H, null, null, { sex: 'female' });
  const neutral = computeParts(lm, W, H);
  const crotch = torsoPt(lm, 1.17);
  assert.equal(name(male, crotch), 'Penis');
  assert.equal(name(female, crotch), 'Vulva');
  assert.equal(name(neutral, crotch), 'Genitals');
  assert.equal(name(male, torsoPt(lm, 1.26)), 'Scrotum');
  assert.equal(name(female, torsoPt(lm, 1.04)), 'Mons pubis');
  // Left breast / pec on the image right.
  assert.equal(name(female, torsoPt(lm, 0.27, 25)), 'Left breast');
  assert.equal(name(male, torsoPt(lm, 0.27, 25)), 'Left pec');
  assert.equal(name(male, torsoPt(lm, -0.27)), 'Adam’s apple');
  assert.equal(name(female, torsoPt(lm, -0.27)), 'Throat');
});

test('names back-view anatomy: glutes, lats, spine, anus', () => {
  const back = film(skeleton(), { view: 'back' }).lm;
  const ctx = computeParts(back, W, H, null, null, { sex: 'male' });
  const hipL = at(back, P.leftHip);
  assert.equal(name(ctx, [hipL[0], hipL[1] + 20]), 'Left glute');
  assert.equal(name(ctx, torsoPt(back, 0.3)), 'Upper spine');
  assert.equal(name(ctx, torsoPt(back, 1.21)), 'Anus');
  assert.match(name(ctx, torsoPt(back, 0.5, 35 * -1)), /lat/); // person's left is image left from behind
});

test('quads split into their heads from the front', () => {
  const front = film(skeleton()).lm;
  const ctx = computeParts(front, W, H);
  const k = at(front, P.leftKnee);
  const hip = at(front, P.leftHip);
  // Just above the knee on the inner side (image left of the left leg) is the VMO.
  assert.equal(name(ctx, [k[0] - 12, k[1] - 0.2 * (k[1] - hip[1])]), 'Left teardrop (VMO)');
  assert.equal(name(ctx, [hip[0] + 14, (hip[1] + k[1]) / 2]), 'Left outer quad');
});

test('every point inside the body gets a name (no unknown gaps)', () => {
  const { lm } = film(skeleton({ arms: [{ abd: 28 }, { abd: 28 }], legs: [{ abd: 6 }, { abd: 6 }] }));
  const ctx = computeParts(lm, W, H, null, null, { sex: 'female' });
  let named = 0;
  let total = 0;
  for (let y = 0; y < H; y += 6) {
    for (let x = 0; x < W; x += 6) {
      if (!identify(ctx, x, y)) continue; // within reach of a region = on the body
      total++;
      if (identify(ctx, x, y, { inside: true })?.name) named++;
    }
  }
  assert.ok(total > 500);
  assert.equal(named, total);
  // Inside the outline, even a point outside every capsule is named.
  assert.ok(identify(ctx, 20, 20, { inside: true })?.name);
  assert.equal(identify(ctx, 20, 20, { inside: false }), null);
});

test('close up with the hips out of frame, the upper body still works', () => {
  const { lm } = film(skeleton(), { offset: [640, 620] }); // hips and legs below the frame
  for (const i of [P.leftHip, P.rightHip, P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle]) lm[i].visibility = 0.02;
  const ctx = computeParts(lm, W, H, null, null, { sex: 'male' });
  assert.equal(ctx.mode, 'upper');
  assert.equal(ctx.facing, 'front');
  assert.equal(name(ctx, mid2(lm, P.leftShoulder, P.leftElbow, 0.55)), 'Left biceps');
  const S = mid2(lm, P.leftShoulder, P.rightShoulder);
  assert.equal(name(ctx, [S[0] + 25, S[1] + 40]), 'Left pec');
  assert.equal(name(ctx, at(lm, P.nose)), 'Nose');
});

test('face only still names the face', () => {
  const { lm } = film(skeleton(), { offset: [640, 700] });
  for (let i = 11; i < 33; i++) lm[i].visibility = 0.02;
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.mode, 'head');
  assert.equal(name(ctx, at(lm, 2)), 'Left eye');
  assert.equal(name(ctx, at(lm, P.nose)), 'Nose');
});

test('tracked fingers: each bone, knuckles and palm, with the hand shape for the outline', () => {
  const { lm } = film(skeleton());
  const wr = { x: lm[P.leftWrist].x, y: lm[P.leftWrist].y };
  const hand = Array.from({ length: 21 }, (_, i) => {
    if (i === 0) return { ...wr, z: 0 };
    const finger = Math.floor((i - 1) / 4);
    const joint = (i - 1) % 4;
    return { x: wr.x + (finger - 2) * 0.008, y: wr.y + 0.02 + joint * 0.012, z: 0 };
  });
  const ctx = computeParts(lm, W, H, { landmarks: [hand] });
  const midOf = (a, b) => [((hand[a].x + hand[b].x) / 2) * W, ((hand[a].y + hand[b].y) / 2) * H];
  assert.match(identify(ctx, ...midOf(10, 11)).detail, /middle phalanx/);
  assert.equal(name(ctx, midOf(3, 4)), 'Left thumb');
  assert.equal(ctx.shapes.length, 1);
  assert.ok(ctx.shapes[0].end - ctx.shapes[0].start >= 15);
});

test('arms touching the torso are not counted as chest or waist', () => {
  const { lm } = film(skeleton({ arms: [{ abd: 7, elbow: 5 }, { abd: 7, elbow: 5 }], legs: [{ abd: 6 }, { abd: 6 }] }));
  const { mask } = bodyMask(lm);
  const m = measureFrame('front', mask, lm);
  // The chest capsule is 104 px wide; with the arms included it would be ~150.
  assert.ok(m.widths.chest.width < 112, `chest ${m.widths.chest.width.toFixed(1)}`);
  assert.ok(m.widths.chest.touched, 'flags arms against the body');
});

test('a cut-off head or feet is caught instead of measured', () => {
  const low = film(skeleton({ arms: [{ abd: 28 }, { abd: 28 }] }), { offset: [640, 250] }).lm;
  assert.match(checkPose('front', low, W, H)[0], /head is cut off/);
  const high = film(skeleton({ arms: [{ abd: 28 }, { abd: 28 }] }), { offset: [640, 470] }).lm;
  assert.match(checkPose('front', high, W, H)[0], /feet are cut off/);
  const { mask } = bodyMask(high);
  assert.equal(measureFrame('front', mask, high).heightPx, null);
});

// ---------- close up on the legs (no shoulders or face in view)
const legsOnly = (offsetY, hidden = []) => {
  const { lm } = film(skeleton(), { offset: [640, offsetY] });
  for (let i = 0; i < 23; i++) lm[i].visibility = 0.02;
  for (const i of hidden) lm[i].visibility = 0.02;
  return lm;
};
const rotate180 = (lm) => lm.map((p) => ({ ...p, x: 1 - p.x, y: 1 - p.y }));

test('legs close up: thighs, knees and shins are named without a torso', () => {
  const lm = legsOnly(40);
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.mode, 'legs');
  assert.equal(ctx.facing, 'front');
  assert.equal(name(ctx, mid2(lm, P.leftHip, P.leftKnee, 0.45)), 'Left quads');
  assert.equal(name(ctx, mid2(lm, P.rightHip, P.rightKnee, 0.45)), 'Right quads');
  assert.equal(name(ctx, at(lm, P.leftKnee)), 'Left kneecap');
  assert.equal(name(ctx, mid2(lm, P.leftKnee, P.leftAnkle, 0.4)), 'Left shin');
  // No torso parts float above the hips.
  assert.ok(!ctx.fine.some((p) => /abs|pec|chest|neck/i.test(p.name)));
});

test('legs close up from behind names hamstrings and calves', () => {
  const { lm } = film(skeleton(), { view: 'back', offset: [640, 40] });
  for (let i = 0; i < 23; i++) lm[i].visibility = 0.02;
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.facing, 'back');
  assert.match(name(ctx, mid2(lm, P.leftHip, P.leftKnee, 0.6)), /hamstring/);
  assert.match(name(ctx, mid2(lm, P.leftKnee, P.leftAnkle, 0.3)), /calf/);
});

test('looking down at your own legs (upside-down view) still names them right', () => {
  const lm = rotate180(legsOnly(40));
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.mode, 'legs');
  assert.equal(ctx.facing, 'front');
  assert.equal(name(ctx, mid2(lm, P.leftHip, P.leftKnee, 0.45)), 'Left quads');
  assert.equal(name(ctx, at(lm, P.rightKnee)), 'Right kneecap');
  assert.equal(name(ctx, mid2(lm, P.rightKnee, P.rightAnkle, 0.4)), 'Right shin');
});

test('hips out of frame: the visible part of the thigh is still the thigh', () => {
  const lm = legsOnly(-60, [P.leftHip, P.rightHip]);
  const ctx = computeParts(lm, W, H);
  assert.equal(ctx.mode, 'legs');
  const p = mid2(lm, P.leftHip, P.leftKnee, 0.75);
  assert.ok(p[1] > 0);
  assert.match(name(ctx, p), /Left (quads|outer quad|teardrop)/);
  assert.equal(name(ctx, mid2(lm, P.leftKnee, P.leftAnkle, 0.4)), 'Left shin');
});

test('ankles out of frame: the visible shin is not called the thigh', () => {
  const lm = legsOnly(520, [P.leftAnkle, P.rightAnkle, P.leftHeel, P.rightHeel, P.leftFoot, P.rightFoot]);
  const ctx = computeParts(lm, W, H);
  const p = mid2(lm, P.leftKnee, P.leftAnkle, 0.3);
  assert.ok(p[1] < H);
  assert.match(name(ctx, p), /Left (shin|peroneals|inner calf)/);
});

test('close-up joints: rotated detections map back and keypoints become pose landmarks', async () => {
  const { unrotate, cocoToPose } = await import('../js/limbs.js');
  // A point near the top-left, found in each rotated image, maps back to the same spot.
  const p = [0.2, 0.1];
  const rotated = { 0: p, 180: [0.8, 0.9], 90: [0.9, 0.2], 270: [0.1, 0.8] };
  for (const [rot, q] of Object.entries(rotated)) {
    const [x, y] = unrotate(q[0], q[1], Number(rot));
    assert.ok(Math.abs(x - p[0]) < 1e-9 && Math.abs(y - p[1]) < 1e-9, `rotation ${rot}: ${x}, ${y}`);
  }
  const kps = Array.from({ length: 17 }, (_, k) => [k / 20, 0.5, k === 13 ? 0.6 : 0.05]);
  const lm = cocoToPose(kps);
  assert.equal(lm.length, 33);
  assert.equal(lm[P.leftKnee].x, 13 / 20); // COCO 13 = left knee
  assert.equal(lm[P.leftKnee].visibility, 1);
  assert.equal(lm[P.leftHeel].visibility, 0);
  assert.ok(lm[P.nose].visibility < 0.35);
});

test('an upside-down view of the whole body keeps front, back and sides right', () => {
  const front = rotate180(film(skeleton()).lm);
  const fctx = computeParts(front, W, H);
  assert.equal(fctx.facing, 'front');
  assert.equal(name(fctx, mid2(front, P.leftHip, P.leftKnee, 0.45)), 'Left quads');
  const back = rotate180(film(skeleton(), { view: 'back' }).lm);
  assert.equal(computeParts(back, W, H).facing, 'back');
});
