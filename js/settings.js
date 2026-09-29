import { KIT_DEFAULTS, fromBartleby } from './program.js';

const KEY = 'gymvision.settings.v1';

const usesInches = () => {
  try {
    return /^en-(US|LR|MM)$/i.test(navigator.language || '');
  } catch {
    return false;
  }
};

export const DEFAULTS = {
  model: 'lite', // 'lite' | 'full' | 'heavy' — speed vs precision
  delegate: 'auto', // 'auto' | 'GPU' | 'CPU'
  fps: 60, // requested camera frame rate
  angleSource: 'auto', // 'auto' | '2d' | '3d'
  depthTarget: 90, // push-up elbow angle for full depth
  squatDepth: 'parallel', // 'half' | 'parallel' | 'deep'
  voice: true,
  labels: true, // angle labels on the body
  dim: 0, // 0..0.8 — darkens the video so overlays stand out
  mirror: 'auto', // 'auto' | 'on' | 'off'
  facingMode: 'user',
  deviceId: '',
  layers: { skeleton: true, outline: true, parts: false, angles: false, fingers: false },
  units: usesInches() ? 'in' : 'cm',
  // Profile
  sex: '', // '' (not set) | 'male' | 'female' — picks anatomical names in Body Scan
  heightCm: null,
  weightKg: null,
  weightUnit: usesInches() ? 'lb' : 'kg',
  guidesSeen: {},
  // Your program: equipment and skill-ladder steps you set here (kitSet, levelSet)
  // win over the ones Bartleby saved; kit and levels are what's in effect.
  kitSet: {},
  levelSet: {},
  kit: { ...KIT_DEFAULTS },
  levels: {},
};

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    saved = {};
  }
  const b = fromBartleby();
  const kitSet = { ...(saved.kitSet || {}) };
  const levelSet = { ...(saved.levelSet || {}) };
  return {
    ...DEFAULTS,
    ...saved,
    layers: { ...DEFAULTS.layers, ...(saved.layers || {}) },
    guidesSeen: { ...(saved.guidesSeen || {}) },
    kitSet,
    levelSet,
    kit: { ...KIT_DEFAULTS, ...b.kit, ...kitSet },
    levels: { ...b.levels, ...levelSet },
  };
}

export function saveSettings(settings) {
  try {
    const { kit, levels, ...rest } = settings; // derived on load
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Private mode or blocked storage: settings just won't persist.
  }
}
