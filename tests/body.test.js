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
  assert.equal(name(fctx, [S[0], S[1] + (Hc[1] - S[1]) * 0.6]), 'Upper abs');

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
