import { MP_BUNDLE, MP_WASM, POSE_MODELS, HAND_MODEL_URL } from './config.js';

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

/** Optional hand landmarker (finger tracking), in its own context. */
export class HandEngine {
  constructor() {
    this.task = null;
    this.loading = null;
    this.lastTs = 0;
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
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        delegate,
      );
      this.task = task;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  detect(source, ts) {
    if (!this.task) return null;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    return this.task.detectForVideo(source, ts);
  }

  async connections() {
    const { HandLandmarker } = await loadVision();
    return HandLandmarker.HAND_CONNECTIONS;
  }

  close() {
    this.task?.close();
    this.task = null;
  }
}
