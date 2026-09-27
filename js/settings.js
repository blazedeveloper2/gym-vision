const KEY = 'gth.settings.v1';

export const DEFAULTS = {
  mode: 'tracker', // 'tracker' | 'pushup' | 'squat'
  model: 'full', // 'lite' | 'full' | 'heavy'
  delegate: 'auto', // 'auto' | 'GPU' | 'CPU'
  angleSource: 'auto', // 'auto' | '2d' | '3d'
  depthTarget: 90, // elbow angle (deg) that counts as a full-depth push-up
  squatDepth: 'parallel', // 'half' | 'parallel' | 'deep'
  voice: true,
  labels: true, // angle labels drawn on the body
  dimVideo: false,
  hands: false, // extra finger tracking (tracker mode)
  mirror: 'auto', // 'auto' | 'on' | 'off'
  facingMode: 'user', // used when no specific camera is chosen
  deviceId: '',
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings just won't persist.
  }
}
