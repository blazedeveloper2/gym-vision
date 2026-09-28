import { TFJS_SCRIPTS, MOVENET_URL } from './config.js';

/**
 * Close-up joint finder (MoveNet Lightning on TensorFlow.js).
 *
 * MediaPipe's pose detector finds a person by their face, so a frame with
 * only a leg or an arm in it finds no one. MoveNet looks at the whole image
 * and needs no face, so it keeps finding hips, knees and ankles close up.
 * Its 17 keypoints are returned as a MediaPipe-style 33-landmark array so the
 * rest of the app works unchanged.
 *
 * It also finds the right way up: pointing the camera down at your own legs
 * shows them upside down, so other rotations are tried when detection is
 * weak (and now and then anyway) and the best one is kept.
 */

const SIZE = 192; // Lightning input
// MoveNet (COCO) keypoint → MediaPipe pose landmark index.
const COCO_TO_POSE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ROTATIONS = [0, 180, 90, 270];

/** A point found in an image rotated by `rot`° clockwise → the unrotated image (all 0–1). */
export function unrotate(x, y, rot) {
  if (rot === 180) return [1 - x, 1 - y];
  if (rot === 90) return [y, 1 - x];
  if (rot === 270) return [1 - y, x];
  return [x, y];
}

/** MoveNet score → MediaPipe-like visibility (0.3 ≈ 0.5, "seen"). */
export const scoreToVis = (s) => Math.min(1, Math.max(0, (s - 0.1) / 0.4));

/**
 * 17 keypoints [x, y, score] (normalized to the frame) → 33 pose landmarks.
 * Landmarks MoveNet doesn't have (hands, feet, mouth) get visibility 0.
 */
export function cocoToPose(kps) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  kps.forEach(([x, y, s], k) => (lm[COCO_TO_POSE[k]] = { x, y, z: 0, visibility: scoreToVis(s) }));
  return lm;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn’t load ${src}`));
    document.head.append(s);
  });
}

export class LimbEngine {
  constructor() {
    this.model = null;
    this.loading = null;
    this.rot = 0;
    this.probe = 0;
    this.frames = 0;
    this.prev = null;
    this.inferMs = 0;
  }

  get ready() {
    return !!this.model;
  }

  async load() {
    if (this.model) return;
    this.loading ??= (async () => {
      if (!window.tf?.loadGraphModel) for (const src of TFJS_SCRIPTS) await loadScript(src);
      const tf = window.tf;
      await tf.setBackend('webgl');
      await tf.ready();
      const model = await tf.loadGraphModel(MOVENET_URL);
      // The first run compiles the GPU shaders; do it now, not mid-session.
      const warm = model.execute(tf.zeros([1, SIZE, SIZE, 3], 'int32'));
      await warm.data();
      warm.dispose();
      this.model = model;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** One MoveNet run with the image rotated by `rot`°; returns keypoints in the frame (0–1) and a quality score. */
  run(source, rot) {
    const tf = window.tf;
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    const M = Math.max(w, h);
    const nw = Math.max(1, Math.round((w / M) * SIZE));
    const nh = Math.max(1, Math.round((h / M) * SIZE));
    const out = tf.tidy(() => {
      // Letterbox into a square (keeps proportions), then turn it.
      let img = tf.image.resizeBilinear(tf.browser.fromPixels(source), [nh, nw]);
      img = tf.pad(img, [[0, SIZE - nh], [0, SIZE - nw], [0, 0]]);
      if (rot === 180) img = tf.reverse(img, [0, 1]);
      else if (rot === 90) img = tf.reverse(tf.transpose(img, [1, 0, 2]), 1);
      else if (rot === 270) img = tf.reverse(tf.transpose(img, [1, 0, 2]), 0);
      return this.model.execute(tf.expandDims(tf.cast(img, 'int32'), 0));
    });
    const d = out.dataSync();
    out.dispose();
    const kps = [];
    for (let k = 0; k < 17; k++) {
      const [x, y] = unrotate(d[k * 3 + 1], d[k * 3], rot);
      kps.push([(x * M) / w, (y * M) / h, d[k * 3 + 2]]);
    }
    const top = kps.map((p) => p[2]).sort((a, b) => b - a);
    const q = (top[0] + top[1] + top[2] + top[3] + top[4] + top[5]) / 6;
    return { kps, q };
  }

  /** Pose landmarks for this frame, or null if no body parts are found. */
  detect(source) {
    if (!this.model) return null;
    const t0 = performance.now();
    let best = this.run(source, this.rot);
    this.frames++;
    if (best.q < 0.35 || this.frames % 20 === 0) {
      const alt = ROTATIONS[(ROTATIONS.indexOf(this.rot) + 1 + (this.probe++ % 3)) % 4];
      const r = this.run(source, alt);
      if (r.q > best.q + 0.05) {
        best = r;
        this.rot = alt;
        this.prev = null;
      }
    }
    this.inferMs += 0.2 * (performance.now() - t0 - this.inferMs);
    if (best.q < 0.25) {
      this.prev = null;
      return null;
    }
    return this.smooth(cocoToPose(best.kps));
  }

  /**
   * Does a MediaPipe pose agree with what MoveNet sees? Given only a leg,
   * MediaPipe sometimes "sees" a whole small person that isn't there; its
   * joints then land far from MoveNet's. True when there isn't enough to judge.
   */
  agrees(lm, source) {
    if (!this.model) return true;
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    const { kps } = this.run(source, this.rot);
    const d = [];
    for (let k = 5; k < 17; k++) {
      const p = lm[COCO_TO_POSE[k]];
      const [x, y, s] = kps[k];
      if (p.visibility >= 0.5 && s >= 0.3) d.push(Math.hypot((p.x - x) * w, (p.y - y) * h) / Math.max(w, h));
    }
    if (d.length < 3) return true;
    d.sort((a, b) => a - b);
    return d[d.length >> 1] < 0.12;
  }

  /** Light smoothing so joints don't jitter; snaps on big moves. */
  smooth(lm) {
    const prev = this.prev;
    if (prev) {
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i], q = prev[i];
        if (!p.visibility || !q.visibility) continue;
        const a = Math.hypot(p.x - q.x, p.y - q.y) > 0.03 ? 1 : 0.5;
        p.x = q.x + a * (p.x - q.x);
        p.y = q.y + a * (p.y - q.y);
      }
    }
    return (this.prev = lm);
  }

  reset() {
    this.prev = null;
  }
}
