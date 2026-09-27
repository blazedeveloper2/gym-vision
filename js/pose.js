import { MP_BUNDLE, MP_WASM, POSE_MODELS, HAND_MODEL_URL } from './config.js';

// MediaPipe is imported lazily so the start screen renders instantly and a
// network failure can be reported instead of breaking the whole page.
let visionPromise = null;
let filesetPromise = null;

function vision() {
  visionPromise ??= import(MP_BUNDLE);
  return visionPromise;
}

async function fileset() {
  const { FilesetResolver } = await vision();
  filesetPromise ??= FilesetResolver.forVisionTasks(MP_WASM);
  return filesetPromise;
}

/**
 * Creates a task, preferring the GPU. Some mobile browsers expose WebGL but
 * fail inside MediaPipe's GPU path, so 'auto' falls back to the CPU.
 */
async function createWithFallback(create, delegate) {
  if (delegate === 'CPU') return { task: await create('CPU'), delegate: 'CPU' };
  try {
    return { task: await create('GPU'), delegate: 'GPU' };
  } catch (err) {
    if (delegate === 'GPU') throw err;
    console.warn('GPU delegate failed, falling back to CPU', err);
    return { task: await create('CPU'), delegate: 'CPU' };
  }
}

export async function createPoseLandmarker({ model, delegate }) {
  const [{ PoseLandmarker }, fs] = await Promise.all([vision(), fileset()]);
  const modelUrl = (POSE_MODELS[model] || POSE_MODELS.full).url;
  return createWithFallback(
    (d) =>
      PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: modelUrl, delegate: d },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    delegate,
  );
}

export async function createHandLandmarker({ delegate }) {
  const [{ HandLandmarker }, fs] = await Promise.all([vision(), fileset()]);
  return createWithFallback(
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
}

export async function handConnections() {
  const { HandLandmarker } = await vision();
  return HandLandmarker.HAND_CONNECTIONS;
}
