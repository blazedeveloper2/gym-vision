import { MP_BUNDLE, MP_WASM, POSE_MODELS, HAND_MODEL_URL, SEGMENTER_MODEL_URL } from './config.js';

// MediaPipe loads lazily so the home screen appears instantly and a network
// failure can be reported instead of breaking the page.
let visionPromise = null;
let filesetPromise = null;
export const loadVision = () => (visionPromise ??= import(MP_BUNDLE));
async function fileset() {
  const { FilesetResolver } = await loadVision();
  return (filesetPromise ??= FilesetResolver.forVisionTasks(MP_WASM));
}

/** GPU first; 'auto' falls back to the CPU if the GPU path fails. */
async function createWithFallback(create, delegate) {
  if (delegate === 'CPU') return { task: await create('CPU'), delegate: 'CPU' };
  try {
    return { task: await create('GPU'), delegate: 'GPU' };
  } catch (err) {
    if (delegate === 'GPU') throw err;
    console.warn('GPU delegate failed, using CPU', err);
    return { task: await create('CPU'), delegate: 'CPU' };
  }
}

/**
 * Pose landmarker lifecycle: model/processor switching, segmentation masks on
 * demand, monotonic timestamps and timing stats.
 *
 * When `canvas` is given, MediaPipe runs in that canvas's WebGL context, so
 * the GL stage can read the segmentation mask straight from the GPU.
 */
export class PoseEngine {
  constructor({ canvas = null } = {}) {
    this.canvas = canvas;
    this.task = null;
    this.key = '';
    this.delegate = '';
    this.masks = false;
    this.pending = null;
    this.busy = false;
    this.gpuFailed = false;
    this.lastTs = 0;
    this.inferMs = 0;
  }

  get ready() {
    return !!this.task && !this.busy;
  }

  /** Loads (or switches to) a model; resolves when it's usable. */
  async load({ model, delegate, masks }) {
    const want = delegate === 'auto' && this.gpuFailed ? 'CPU' : delegate;
    const key = `${model}|${want}`;
    if (this.task && this.key === key) return this.setMasks(masks);
    if (this.pending?.key === key) {
      await this.pending.promise;
      return this.setMasks(masks);
    }
    const url = (POSE_MODELS[model] || POSE_MODELS.lite).url;
    const promise = (async () => {
      const [{ PoseLandmarker }, fs] = await Promise.all([loadVision(), fileset()]);
      return createWithFallback(
        (d) =>
          PoseLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: url, delegate: d },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: masks,
            ...(this.canvas ? { canvas: this.canvas } : {}),
          }),
        want,
      );
    })();
    this.pending = { key, promise };
    try {
      const { task, delegate: used } = await promise;
      if (this.pending?.promise !== promise) {
        task.close(); // superseded by a newer request
        return;
      }
      this.task?.close();
      Object.assign(this, { task, key, delegate: used, masks });
    } finally {
      if (this.pending?.promise === promise) this.pending = null;
    }
  }

  async setMasks(on) {
    if (!this.task || this.masks === on) return;
    this.busy = true;
    try {
      await this.task.setOptions({ outputSegmentationMasks: on });
      this.masks = on;
    } finally {
      this.busy = false;
    }
  }

  nextTimestamp() {
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    return ts;
  }

  /**
   * Runs pose detection; `cb(result, ts)` runs synchronously while the
   * result's masks are still valid. Returns false if not ready.
   */
  detect(source, cb) {
    if (!this.ready) return false;
    const ts = this.nextTimestamp();
    const t0 = performance.now();
    let result = null;
    this.task.detectForVideo(source, ts, (r) => {
      result = r;
      this.inferMs += 0.2 * (performance.now() - t0 - this.inferMs);
      cb(r, ts);
    });
    return !!result;
  }

  close() {
    this.task?.close();
    this.task = null;
    this.key = '';
  }
}

/**
 * Person segmentation on its own (selfie segmenter), for close-ups where the
 * pose landmarker finds no one and so gives no mask. Like PoseEngine it runs
 * in the GL stage's context, so the GL stage samples its mask directly.
 */
export class BodySegmenter {
  constructor({ canvas = null } = {}) {
    this.canvas = canvas;
    this.task = null;
    this.loading = null;
    this.lastTs = 0;
  }

  get ready() {
    return !!this.task;
  }

  async load(delegate) {
    if (this.task) return;
    this.loading ??= (async () => {
      const [{ ImageSegmenter }, fs] = await Promise.all([loadVision(), fileset()]);
      const { task } = await createWithFallback(
        (d) =>
          ImageSegmenter.createFromOptions(fs, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: d },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
            ...(this.canvas ? { canvas: this.canvas } : {}),
          }),
        delegate,
      );
      this.task = task;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** `cb(mask)` runs synchronously while the mask is valid. Returns false if it didn't run. */
  segment(source, ts, cb) {
    if (!this.task) return false;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    let ran = false;
    this.task.segmentForVideo(source, ts, (r) => {
      ran = true;
      cb(r.confidenceMasks?.[0] || null);
    });
    return ran;
  }

  close() {
    this.task?.close();
    this.task = null;
  }
}

const HAND_CROP = 256; // px per hand in the zoomed crop
const POSE_HANDS = [
  { key: 'L', wr: 15, el: 13, idx: 19, pk: 17 },
  { key: 'R', wr: 16, el: 14, idx: 20, pk: 18 },
];
const pvis = (p) => (p && p.visibility != null ? p.visibility : 0);

/**
 * Optional hand landmarker (finger tracking), in its own context.
 *
 * Hands 2–3 m away are only a few dozen pixels wide in the full frame, too
 * small for good finger landmarks. So each hand is zoomed: the pose's wrist,
 * knuckles and elbow give where the hand is and how big, both hands are cut
 * out side by side into one 512×256 image, the landmarker runs on that, and
 * the landmarks are mapped back to the frame. Each result knows which hand
 * (left/right) it is from the crop it came from.
 */
export class HandEngine {
  constructor() {
    this.task = null;
    this.loading = null;
    this.lastTs = 0;
    this.crops = { L: null, R: null };
    this.smooth = { L: null, R: null };
    this.canvas = document.createElement('canvas');
    this.canvas.width = HAND_CROP * 2;
    this.canvas.height = HAND_CROP;
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: false });
  }

  async load(delegate) {
    if (this.task) return;
    this.loading ??= (async () => {
      const [{ HandLandmarker }, fs] = await Promise.all([loadVision(), fileset()]);
      const { task } = await createWithFallback(
        (d) =>
          HandLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: d },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        delegate,
      );
      this.task = task;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** Square crop (frame px) around one hand from pose landmarks, smoothed over frames. */
  cropFor(h, lm, w, hgt) {
    const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * hgt });
    if (pvis(lm[h.wr]) < 0.3) return (this.crops[h.key] = null);
    const wr = P(h.wr);
    const el = P(h.el);
    const knuckles = pvis(lm[h.idx]) >= 0.2 && pvis(lm[h.pk]) >= 0.2 ? { x: (P(h.idx).x + P(h.pk).x) / 2, y: (P(h.idx).y + P(h.pk).y) / 2 } : null;
    const forearm = Math.hypot(wr.x - el.x, wr.y - el.y);
    const toK = knuckles ? Math.hypot(knuckles.x - wr.x, knuckles.y - wr.y) : 0;
    const len = Math.max(2.2 * toK, 0.75 * forearm, 24); // wrist to fingertip
    const from = knuckles && toK > 2 ? knuckles : el;
    const dx = knuckles && toK > 2 ? from.x - wr.x : wr.x - el.x;
    const dy = knuckles && toK > 2 ? from.y - wr.y : wr.y - el.y;
    const dl = Math.hypot(dx, dy) || 1;
    const want = { x: wr.x + (dx / dl) * 0.45 * len, y: wr.y + (dy / dl) * 0.45 * len, size: 2.3 * len };
    const prev = this.crops[h.key];
    // Smooth, but follow fast moves so the hand never leaves its crop.
    const k = prev && Math.hypot(want.x - prev.x, want.y - prev.y) < 0.25 * prev.size ? 0.5 : 1;
    const c = prev ? { x: prev.x + k * (want.x - prev.x), y: prev.y + k * (want.y - prev.y), size: prev.size + 0.5 * (want.size - prev.size) } : want;
    return (this.crops[h.key] = c);
  }

  /**
   * Finger landmarks for this frame, normalized to the full frame like a
   * regular HandLandmarker result. With pose landmarks the hands are zoomed;
   * without, the whole frame is used.
   */
  detect(source, ts, poseLm = null) {
    if (!this.task) return null;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const w = source.videoWidth || source.width;
    const hgt = source.videoHeight || source.height;
    const crops = poseLm ? POSE_HANDS.map((h) => this.cropFor(h, poseLm, w, hgt)) : [null, null];
    if (!crops[0] && !crops[1]) {
      const res = this.task.detectForVideo(source, ts);
      return { landmarks: (res.landmarks || []).map((hand) => this.filter(null, hand)) };
    }

    const ctx = this.ctx2d;
    const S = HAND_CROP;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 2 * S, S);
    crops.forEach((c, k) => {
      if (c) ctx.drawImage(source, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size, k * S, 0, S, S);
    });
    const res = this.task.detectForVideo(this.canvas, ts);

    // Map back to the frame; keep the hand nearest each crop's centre.
    const best = [null, null];
    for (const hand of res.landmarks || []) {
      const cx = hand.reduce((a, p) => a + p.x, 0) / hand.length;
      const k = cx < 0.5 ? 0 : 1;
      const c = crops[k];
      if (!c) continue;
      const off = Math.abs(cx * 2 - k - 0.5);
      if (best[k] && best[k].off <= off) continue;
      const mapped = hand.map((p) => ({
        x: (c.x - c.size / 2 + (p.x * 2 - k) * c.size) / w,
        y: (c.y - c.size / 2 + p.y * c.size) / hgt,
        z: p.z,
      }));
      best[k] = { off, mapped };
    }
    const out = [];
    best.forEach((b, k) => {
      const key = POSE_HANDS[k].key;
      if (!b) {
        this.smooth[key] = null;
        return;
      }
      const hand = this.filter(key, b.mapped);
      hand.side = key;
      out.push(hand);
    });
    return { landmarks: out };
  }

  /** Light smoothing so fingers don't jitter; snaps on big moves. */
  filter(key, pts) {
    if (!key) return pts;
    const prev = this.smooth[key];
    if (!prev) return (this.smooth[key] = pts);
    const out = pts.map((p, i) => {
      const q = prev[i];
      const move = Math.hypot(p.x - q.x, p.y - q.y);
      const a = move > 0.01 ? 1 : 0.55;
      return { x: q.x + a * (p.x - q.x), y: q.y + a * (p.y - q.y), z: p.z };
    });
    this.smooth[key] = out;
    return out;
  }

  async connections() {
    const { HandLandmarker } = await loadVision();
    return HandLandmarker.HAND_CONNECTIONS;
  }

  close() {
    this.task?.close();
    this.task = null;
    this.crops = { L: null, R: null };
    this.smooth = { L: null, R: null };
  }
}
