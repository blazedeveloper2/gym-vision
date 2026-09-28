// Central place for names, versions and remote asset URLs.
export const APP_NAME = 'Gym Vision';
export const APP_VERSION = '0.4.0';
export const REPO_URL = 'https://github.com/blazedeveloper2/gym-vision';

export const MP_VERSION = '1.0.1';
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MP_BUNDLE = `${MP_BASE}/vision_bundle.mjs`;
export const MP_WASM = `${MP_BASE}/wasm`;

const POSE_MODEL = (name) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`;

export const POSE_MODELS = {
  lite: { label: 'Fast', size: '5.8 MB', note: 'Highest frame rate — best for live tracking', url: POSE_MODEL('lite') },
  full: { label: 'Balanced', size: '9.4 MB', note: 'More precise joints and body outline', url: POSE_MODEL('full') },
  heavy: { label: 'Accurate', size: '30.7 MB', note: 'Most precise, noticeably slower', url: POSE_MODEL('heavy') },
};

// Close-up fallback: MediaPipe's pose detector needs a face to find you, so
// when only a leg or an arm is in view, MoveNet (no face needed) finds the
// joints and the selfie segmenter draws the outline.
export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow';
export const TFJS_SCRIPTS = [`${TFJS}/tfjs-core@4.22.0/dist/tf-core.min.js`, `${TFJS}/tfjs-converter@4.22.0/dist/tf-converter.min.js`, `${TFJS}/tfjs-backend-webgl@4.22.0/dist/tf-backend-webgl.min.js`];
export const MOVENET_URL = new URL('../models/movenet-lightning/model.json', import.meta.url).href;

export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
