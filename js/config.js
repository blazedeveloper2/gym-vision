// Central place for versions and remote asset URLs.
export const APP_VERSION = '0.1.0';

export const MP_VERSION = '1.0.1';
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MP_BUNDLE = `${MP_BASE}/vision_bundle.mjs`;
export const MP_WASM = `${MP_BASE}/wasm`;

const POSE_MODEL = (name) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`;

export const POSE_MODELS = {
  lite: { label: 'Lite', size: '5.8 MB', note: 'Fastest', url: POSE_MODEL('lite') },
  full: { label: 'Full', size: '9.4 MB', note: 'Balanced', url: POSE_MODEL('full') },
  heavy: { label: 'Heavy', size: '30.7 MB', note: 'Most accurate, slowest', url: POSE_MODEL('heavy') },
};

export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const REPO_URL = 'https://github.com/blazedeveloper2/gym-technique-helper';
