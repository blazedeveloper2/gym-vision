import { APP_VERSION, POSE_MODELS, REPO_URL } from './config.js';
import { loadSettings, saveSettings } from './settings.js';
import { createPoseLandmarker, createHandLandmarker, handConnections } from './pose.js';
import { JOINTS, vis, angleFn, Ema } from './geometry.js';
import { Renderer, COLORS } from './draw.js';
import { PushupAnalyzer } from './exercises/pushup.js';
import { SquatAnalyzer } from './exercises/squat.js';
import { Voice } from './voice.js';

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  stage: $('stage'),
  video: $('video'),
  canvas: $('overlay'),
  banner: $('banner'),
  fps: $('fps'),
  start: $('start'),
  startError: $('startError'),
  loading: $('loading'),
  loadingText: $('loadingText'),
  toast: $('toast'),
  guide: $('guide'),
  fileBar: $('fileBar'),
  fileInput: $('fileInput'),
  seek: $('seek'),
  timeVal: $('timeVal'),
  btnPlay: $('btnPlay'),
  btnSpeed: $('btnSpeed'),
  btnFlip: $('btnFlip'),
  btnHands: $('btnHands'),
  angleGrid: $('angleGrid'),
  repCount: $('repCount'),
  repSub: $('repSub'),
  repLog: $('repLog'),
  depthFill: $('depthFill'),
  depthVal: $('depthVal'),
  stat1Label: $('stat1Label'),
  stat1Val: $('stat1Val'),
  stat2Label: $('stat2Label'),
  stat2Val: $('stat2Val'),
  tempoVal: $('tempoVal'),
  settings: $('settings'),
};

const settings = loadSettings();
const renderer = new Renderer(els.canvas);
const voice = new Voice();
const exercises = {
  pushup: new PushupAnalyzer({ depthTarget: settings.depthTarget }),
  squat: new SquatAnalyzer({ depthTarget: settings.squatDepth }),
};
/** The rep counter for the current mode, or null in tracker mode. */
const exercise = () => exercises[settings.mode] || null;
const jointEmas = JOINTS.map(() => new Ema(0.45));
const angleCells = [];

const state = {
  running: false,
  source: 'none', // 'camera' | 'file'
  stream: null,
  fileUrl: null,
  speed: 1,
  pose: null,
  poseKey: '',
  poseDelegate: '',
  posePromise: null,
  gpuFailed: false,
  hands: null,
  handsPromise: null,
  handConns: null,
  lastVideoTime: -1,
  lastTs: 0,
  frames: 0,
  fpsSince: performance.now(),
  noPersonSince: null,
  notReadySince: null,
  guideDismissed: false,
  wakeLock: null,
  installEvent: null,
  toastTimer: 0,
};

// ---------------------------------------------------------------- helpers

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function showToast(text, ms = 2600) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
}

function setBanner(text, tone = 'info') {
  if (!text) {
    els.banner.hidden = true;
    return;
  }
  setText(els.banner, text);
  if (els.banner.dataset.tone !== tone) els.banner.dataset.tone = tone;
  els.banner.hidden = false;
}

function setLoading(text) {
  els.loading.hidden = !text;
  if (text) els.loadingText.textContent = text;
}

function showStartError(message) {
  els.startError.textContent = message;
  els.startError.hidden = !message;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** '2d' | '3d', or 'auto' to let the squat analyzer pick based on camera angle. */
function angleSource() {
  if (settings.angleSource !== 'auto') return settings.angleSource;
  return { tracker: '3d', pushup: '2d', squat: 'auto' }[settings.mode];
}

function persist() {
  saveSettings(settings);
}

// ---------------------------------------------------------------- models

async function ensurePose() {
  const delegate = settings.delegate === 'auto' && state.gpuFailed ? 'CPU' : settings.delegate;
  const key = `${settings.model}|${delegate}`;
  if (state.pose && state.poseKey === key) return;
  if (state.posePromise && state.poseKey === key) return state.posePromise;

  const model = POSE_MODELS[settings.model] || POSE_MODELS.full;
  state.poseKey = key;
  setLoading(`Loading the ${model.label} tracking model (${model.size}). This is only slow the first time.`);
  state.pose?.close();
  state.pose = null;
  const promise = createPoseLandmarker({ model: settings.model, delegate })
    .then(({ task, delegate: used }) => {
      if (state.poseKey !== key) {
        task.close(); // superseded by a newer request
        return;
      }
      state.pose = task;
      state.poseDelegate = used;
      state.lastVideoTime = -1;
      updateEngineInfo();
    })
    .catch((err) => {
      if (state.poseKey === key) state.poseKey = '';
      throw err;
    })
    .finally(() => {
      if (state.posePromise !== promise) return;
      state.posePromise = null;
      setLoading(null);
    });
  state.posePromise = promise;
  return promise;
}

async function ensureHands() {
  if (state.hands || state.handsPromise) return state.handsPromise;
  const delegate = settings.delegate === 'auto' && state.gpuFailed ? 'CPU' : settings.delegate;
  showToast('Loading finger tracking model…');
  state.handsPromise = Promise.all([createHandLandmarker({ delegate }), handConnections()])
    .then(([{ task }, conns]) => {
      state.hands = task;
      state.handConns = conns;
      showToast('Finger tracking on');
    })
    .catch((err) => {
      console.error(err);
      settings.hands = false;
      persist();
      syncHandsUi();
      showToast('Couldn’t load finger tracking. Check your connection.');
    })
    .finally(() => (state.handsPromise = null));
  return state.handsPromise;
}

function updateEngineInfo() {
  const model = POSE_MODELS[settings.model] || POSE_MODELS.full;
  const info = state.pose ? `Running: ${model.label} model on ${state.poseDelegate}` : '';
  $('engineInfo').textContent = info;
}

// ---------------------------------------------------------------- camera & video sources

function stopStream() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

function cameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera access for this site in your browser settings, then try again. You can also analyze a recorded video instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. You can analyze a recorded video instead.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    default:
      return err?.message || 'Couldn’t start the camera.';
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      window.isSecureContext
        ? 'This browser can’t access the camera. Try Safari on iPhone or Chrome on Android.'
        : 'The camera only works over a secure (https) connection.',
    );
  }
  stopStream();
  const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  const video = settings.deviceId
    ? { ...base, deviceId: { exact: settings.deviceId } }
    : { ...base, facingMode: settings.facingMode };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    // Saved camera may no longer exist; retry with the default for this facing.
    if (!settings.deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) throw err;
    settings.deviceId = '';
    persist();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...base, facingMode: settings.facingMode },
      audio: false,
    });
  }

  state.stream = stream;
  state.source = 'camera';
  if (state.fileUrl) {
    URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = null;
  }
  els.video.removeAttribute('src');
  els.video.srcObject = stream;
  els.video.loop = false;
  els.video.playbackRate = 1;
  await els.video.play().catch(() => {});

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (state.source === 'camera' && document.visibilityState === 'visible') restartCamera();
  });

  els.app.classList.remove('file-mode');
  els.fileBar.hidden = true;
  els.btnFlip.hidden = false;
  state.lastVideoTime = -1;
  Object.values(exercises).forEach((ex) => ex.interrupt());
  applyMirror();
  refreshCameraList();
}

async function restartCamera() {
  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    showToast(cameraError(err), 5000);
  }
}

async function openVideo(src, name = 'video') {
  stopStream();
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.fileUrl = src.startsWith('blob:') ? src : null;
  state.source = 'file';
  const v = els.video;
  v.srcObject = null;
  v.crossOrigin = src.startsWith('blob:') ? null : 'anonymous';
  v.src = src;
  v.loop = false;
  v.playbackRate = state.speed;
  state.lastVideoTime = -1;
  Object.values(exercises).forEach((ex) => ex.reset());
  renderExerciseHud(null);
  els.app.classList.add('file-mode');
  els.fileBar.hidden = false;
  els.btnFlip.hidden = true;
  applyMirror();
  const loaded = new Promise((resolve, reject) => {
    v.onloadeddata = resolve;
    v.onerror = () => reject(new Error(`This browser can’t play “${name}”. Try an MP4 (H.264) file.`));
  });
  // iOS only loads video data once playback starts, so start it right away.
  v.play().catch(() => {});
  try {
    await loaded;
  } finally {
    v.onloadeddata = null;
    v.onerror = null;
  }
  syncPlayButton();
}

function applyMirror() {
  let mirror = false;
  if (settings.mirror === 'on') mirror = true;
  else if (settings.mirror === 'auto' && state.source === 'camera') {
    const track = state.stream?.getVideoTracks()[0];
    const facing = track?.getSettings?.().facingMode;
    if (facing) mirror = facing === 'user';
    else mirror = !/back|rear|environment/i.test(track?.label || '');
  }
  renderer.mirror = mirror;
  els.stage.classList.toggle('mirrored', mirror);
}

async function refreshCameraList() {
  const sel = $('setCamera');
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    // ignore
  }
  sel.innerHTML = '';
  const add = (value, label) => sel.append(new Option(label, value));
  add('facing:user', 'Front camera');
  add('facing:environment', 'Back camera');
  devices.forEach((d, i) => d.deviceId && add(`id:${d.deviceId}`, d.label || `Camera ${i + 1}`));
  const wanted = settings.deviceId ? `id:${settings.deviceId}` : `facing:${settings.facingMode}`;
  sel.value = [...sel.options].some((o) => o.value === wanted) ? wanted : `facing:${settings.facingMode}`;
}

// ---------------------------------------------------------------- session

async function begin(kind, file) {
  voice.unlock();
  showStartError('');
  const posePromise = ensurePose();
  posePromise.catch(() => {}); // awaited below; avoid an unhandled rejection meanwhile

  const fail = (err, message) => {
    console.error(err);
    setLoading(null);
    if (state.running) {
      showToast(message, 6000);
    } else {
      stopStream();
      showStartError(message);
    }
  };

  try {
    if (kind === 'camera') await startCamera();
    else await openVideo(URL.createObjectURL(file), file.name);
  } catch (err) {
    fail(err, kind === 'camera' ? cameraError(err) : err?.message || String(err));
    return;
  }
  try {
    await posePromise;
  } catch (err) {
    fail(err, 'Couldn’t load the tracking model. Check your internet connection and try again.');
    return;
  }

  if (settings.hands && settings.mode === 'tracker') ensureHands();
  startRunning();
  keepAwake();
}

function startRunning() {
  if (!state.running) {
    state.running = true;
    els.app.classList.add('running');
    els.start.hidden = true;
    requestAnimationFrame(loop);
  }
  renderer.measure();
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => (state.wakeLock = null));
    }
  } catch {
    // Not supported or not allowed; the screen may dim during long sets.
  }
}

// ---------------------------------------------------------------- main loop

function nextTimestamp() {
  let ts = performance.now();
  if (ts <= state.lastTs) ts = state.lastTs + 1;
  state.lastTs = ts;
  return ts;
}

function loop() {
  requestAnimationFrame(loop);
  const v = els.video;
  if (!state.pose || v.readyState < 2 || !v.videoWidth) return;
  if (v.currentTime === state.lastVideoTime) return; // no new frame yet
  state.lastVideoTime = v.currentTime;

  renderer.resize(v.videoWidth, v.videoHeight);
  const ts = nextTimestamp();
  let result;
  try {
    result = state.pose.detectForVideo(v, ts);
  } catch (err) {
    onDetectError(err);
    return;
  }

  let hands = null;
  if (settings.mode === 'tracker' && settings.hands && state.hands) {
    try {
      hands = state.hands.detectForVideo(v, ts);
    } catch (err) {
      console.error('hand tracking failed', err);
      state.hands.close();
      state.hands = null;
      setHands(false);
      showToast('Finger tracking isn’t working on this device, so it was turned off.', 5000);
    }
  }

  const frame = {
    lm: result.landmarks?.[0] || null,
    world: result.worldLandmarks?.[0] || null,
    w: v.videoWidth,
    h: v.videoHeight,
    // Video files use media time so tempo stays right at slow-motion speeds.
    t: state.source === 'file' ? v.currentTime * 1000 : ts,
  };

  renderer.clear();
  if (exercise()) runExercise(frame);
  else runTracker(frame, hands);

  countFps();
}

function onDetectError(err) {
  console.error('pose detection failed', err);
  if (state.poseDelegate === 'GPU' && settings.delegate !== 'GPU' && !state.gpuFailed) {
    state.gpuFailed = true;
    state.pose?.close();
    state.pose = null;
    state.poseKey = '';
    showToast('GPU tracking failed on this device — switching to CPU.');
    ensurePose().catch((e) => showToast(`Couldn’t restart tracking: ${e.message}`, 6000));
  } else {
    setBanner('Tracking stopped because of an error. Reload the page to try again.', 'bad');
    state.pose = null;
  }
}

function countFps() {
  state.frames++;
  const now = performance.now();
  if (now - state.fpsSince >= 1000) {
    const fps = Math.round((state.frames * 1000) / (now - state.fpsSince));
    setText(els.fps, `${fps} fps · ${state.poseDelegate}`);
    state.frames = 0;
    state.fpsSince = now;
  }
}

// ---------------------------------------------------------------- tracker mode

function runTracker(frame, hands) {
  const { lm } = frame;
  if (lm) {
    renderer.skeleton(lm);
    state.noPersonSince = null;
  } else {
    state.noPersonSince ??= frame.t;
  }
  if (hands) renderer.hands(hands, state.handConns);

  const angle = lm ? angleFn(frame, angleSource()) : null;
  const center = lm && {
    x: (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4,
    y: (lm[11].y + lm[12].y + lm[23].y + lm[24].y) / 4,
  };
  JOINTS.forEach((j, i) => {
    const ok = lm && vis(lm[j.a]) > 0.5 && vis(lm[j.b]) > 0.5 && vis(lm[j.c]) > 0.5;
    if (!ok) {
      jointEmas[i].reset();
      setText(angleCells[i], '–');
      return;
    }
    const value = jointEmas[i].next(angle(j.a, j.b, j.c));
    const text = `${Math.round(value)}°`;
    setText(angleCells[i], text);
    if (settings.labels) {
      renderer.angleLabel(lm[j.a], lm[j.b], lm[j.c], text, j.side === 'L' ? COLORS.left : COLORS.right, { away: center });
    }
  });

  const lost = state.noPersonSince != null && frame.t - state.noPersonSince > 800;
  setBanner(lost ? 'No one in view — step back so your whole body is visible' : '', 'info');
  els.guide.hidden = true;
}

function buildAngleGrid() {
  const rows = [...new Set(JOINTS.map((j) => j.label))];
  for (const label of rows) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    els.angleGrid.append(name);
    for (const side of ['L', 'R']) {
      const i = JOINTS.findIndex((j) => j.label === label && j.side === side);
      const cell = document.createElement('span');
      cell.className = `v ${side}`;
      cell.textContent = '–';
      els.angleGrid.append(cell);
      angleCells[i] = cell;
    }
  }
}

// ---------------------------------------------------------------- exercise modes

function runExercise(frame) {
  const ex = exercise();
  const view = ex.update(frame, angleSource());
  const { lm } = frame;

  if (lm) {
    renderer.skeleton(lm, { alpha: view.status === 'active' ? 0.35 : 0.8 });
    if (view.status === 'active' && view.joints) {
      if (settings.mode === 'pushup') drawPushupOverlay(lm, view);
      else drawSquatOverlay(lm, view);
    }
  }

  for (const ev of view.events) {
    if (ev.type === 'rep') {
      if (ev.rep.counted) bumpCount();
      voice.say(ex.voiceLine(ev));
    } else if (ev.type === 'cue') {
      voice.say(ex.voiceLine(ev), { key: ev.key, gapMs: 2500 });
    }
  }

  setBanner(view.message, view.tone);
  renderExerciseHud(view);

  const notReady = view.status !== 'active';
  if (notReady) state.notReadySince ??= frame.t;
  else state.notReadySince = null;
  const showGuide =
    !state.guideDismissed && ex.count === 0 && notReady && frame.t - state.notReadySince > 1200;
  els.guide.hidden = !showGuide;
}

function drawPushupOverlay(lm, view) {
  const { sh, el, wr, hip, foot } = view.joints;
  const armColor = view.depthReached ? COLORS.good : COLORS.accent;
  const hipColor = view.hipFault === 'ok' ? COLORS.center : COLORS.warn;

  renderer.dashed(lm[sh], lm[foot], 'rgba(255,255,255,0.55)');
  renderer.segment(lm[sh], lm[hip], hipColor, 5);
  renderer.segment(lm[hip], lm[foot], hipColor, 5);
  renderer.segment(lm[sh], lm[el], armColor, 7);
  renderer.segment(lm[el], lm[wr], armColor, 7);
  renderer.arc(lm[sh], lm[el], lm[wr], armColor);
  for (const i of [sh, el, wr, hip, foot]) renderer.dot(lm[i], 5, i === hip ? hipColor : armColor);

  if (settings.labels) {
    renderer.angleLabel(lm[sh], lm[el], lm[wr], `${Math.round(view.elbow)}°`, armColor, { size: 15, offset: 30 });
    renderer.angleLabel(lm[sh], lm[hip], lm[foot], `${Math.round(view.bodyAngle)}°`, hipColor, { size: 12 });
  }
}

function drawSquatOverlay(lm, view) {
  const j = view.joints;
  const legColor = view.depthReached ? COLORS.good : COLORS.accent;
  const faultColor = COLORS.warn;

  if (j.front) {
    const kneesColor = view.fault === 'knees' ? faultColor : 'rgba(255,255,255,0.6)';
    renderer.dashed(lm[25], lm[26], kneesColor, 2.5);
    renderer.dashed(lm[27], lm[28], 'rgba(255,255,255,0.6)', 2.5);
    for (const [hip, knee, ank] of [[23, 25, 27], [24, 26, 28]]) {
      renderer.segment(lm[hip], lm[knee], legColor, 7);
      renderer.segment(lm[knee], lm[ank], legColor, 7);
      for (const i of [hip, knee, ank]) renderer.dot(lm[i], 5, i === knee && view.fault === 'knees' ? faultColor : legColor);
    }
    if (settings.labels) {
      const mid = { x: (lm[25].x + lm[26].x) / 2, y: (lm[25].y + lm[26].y) / 2 };
      renderer.label(renderer.pt(mid).x, renderer.pt(mid).y, `${Math.round(view.kneeAngle)}°`, legColor, 15);
    }
    return;
  }

  const { sh, hip, knee, ank } = j;
  const torsoColor = view.fault === 'lean' ? faultColor : COLORS.center;
  // Horizontal "parallel" line through the knee: hips below it = below parallel.
  const k = lm[knee];
  renderer.dashed({ x: k.x - 0.15, y: k.y }, { x: k.x + 0.15, y: k.y }, 'rgba(255,255,255,0.55)');
  renderer.segment(lm[sh], lm[hip], torsoColor, 5);
  renderer.segment(lm[hip], lm[knee], legColor, 7);
  renderer.segment(lm[knee], lm[ank], legColor, 7);
  renderer.arc(lm[hip], lm[knee], lm[ank], legColor);
  for (const i of [sh, hip, knee, ank]) renderer.dot(lm[i], 5, i === sh ? torsoColor : legColor);

  if (settings.labels) {
    renderer.angleLabel(lm[hip], lm[knee], lm[ank], `${Math.round(view.kneeAngle)}°`, legColor, { size: 15, offset: 30 });
    const s = renderer.pt(lm[sh]);
    const h = renderer.pt(lm[hip]);
    renderer.label((s.x + h.x) / 2, (s.y + h.y) / 2, `lean ${Math.round(view.lean)}°`, torsoColor, 12);
  }
}

function bumpCount() {
  els.repCount.classList.remove('bump');
  void els.repCount.offsetWidth; // restart the animation
  els.repCount.classList.add('bump');
}

let lastAttempts = -1;
function renderExerciseHud(view) {
  const ex = exercise();
  if (!ex) return;
  const s = ex.summary;
  setText(els.repCount, String(s.count));
  setText(els.repSub, `${s.clean} clean · ${s.partials} not counted`);

  const attempts = s.count + s.partials;
  if (attempts !== lastAttempts) {
    lastAttempts = attempts;
    els.repLog.replaceChildren(
      ...s.log.slice(-12).map((rep) => {
        const dot = document.createElement('i');
        dot.className = !rep.counted ? 'bad' : rep.issues.length ? 'warn' : '';
        dot.title = rep.counted ? `Rep ${rep.n}: ${rep.detail}` : `Not counted: ${rep.detail}`;
        return dot;
      }),
    );
    const last = s.log[s.log.length - 1];
    setText(els.tempoVal, last ? `↓${fmtSec(last.downMs)} ↑${fmtSec(last.upMs)}` : '–');
  }

  const active = view?.status === 'active';
  const pct = active ? Math.min(view.depth, 1.2) / 1.2 : 0;
  els.depthFill.style.height = `${(pct * 100).toFixed(1)}%`;
  els.depthFill.classList.toggle('reached', !!(active && view.depthReached));
  els.depthVal.classList.toggle('reached', !!(active && view.depthReached));
  setText(els.depthVal, active ? `${Math.round(Math.min(view.depth, 1) * 100)}%` : '–');

  const stats = active ? view.stats : ex.statLabels.map((label) => ({ label, value: '–' }));
  [[els.stat1Label, els.stat1Val], [els.stat2Label, els.stat2Val]].forEach(([labelEl, valEl], i) => {
    setText(labelEl, stats[i].label);
    setText(valEl, stats[i].value);
    valEl.classList.toggle('warn', !!stats[i].warn);
  });
}

// ---------------------------------------------------------------- UI wiring

function setMode(mode) {
  settings.mode = mode;
  persist();
  els.app.dataset.mode = mode;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  jointEmas.forEach((e) => e.reset());
  Object.values(exercises).forEach((ex) => ex.interrupt());
  state.notReadySince = null;
  state.lastVideoTime = -1; // re-analyze the current frame even if a video is paused
  lastAttempts = -1;
  setBanner('');
  els.guide.hidden = true;
  if (mode === 'tracker' && settings.hands && state.running) ensureHands();
  renderExerciseHud(null);
}

function syncHandsUi() {
  els.btnHands.setAttribute('aria-pressed', String(settings.hands));
  $('setHands').checked = settings.hands;
}

function setHands(on) {
  settings.hands = on;
  persist();
  syncHandsUi();
  if (on && state.running) ensureHands();
}

function syncPlayButton() {
  const paused = els.video.paused || els.video.ended;
  els.btnPlay.classList.toggle('paused', paused);
  els.btnPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}

function togglePlay() {
  const v = els.video;
  if (v.ended) {
    exercise()?.reset();
    renderExerciseHud(null);
    v.currentTime = 0;
  }
  if (v.paused || v.ended) v.play().catch(() => {});
  else v.pause();
}

function onVideoEnded() {
  syncPlayButton();
  const ex = exercise();
  if (!ex) return;
  const s = ex.summary;
  showToast(`Set finished: ${s.count} reps (${s.clean} clean, ${s.partials} not counted)`, 6000);
}

function initSettingsUi() {
  const model = document.querySelectorAll('#setModel input');
  const modelHint = () => {
    const m = POSE_MODELS[settings.model];
    $('modelHint').textContent = `${m.label}: ${m.note}. ${m.size} download, cached after the first time.`;
  };
  model.forEach((r) => {
    r.checked = r.value === settings.model;
    r.addEventListener('change', () => {
      settings.model = r.value;
      persist();
      modelHint();
      if (state.running) ensurePose().catch((e) => showToast(`Couldn’t load model: ${e.message}`, 5000));
    });
  });
  modelHint();

  const depth = $('setDepth');
  const depthOut = $('setDepthVal');
  depth.value = settings.depthTarget;
  depthOut.textContent = `${settings.depthTarget}°`;
  depth.addEventListener('input', () => {
    settings.depthTarget = Number(depth.value);
    depthOut.textContent = `${settings.depthTarget}°`;
    exercises.pushup.setOptions({ depthTarget: settings.depthTarget });
    persist();
  });

  const bindToggle = (id, key, after) => {
    const input = $(id);
    input.checked = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      persist();
      after?.(input.checked);
    });
  };
  bindToggle('setVoice', 'voice', (on) => {
    voice.enabled = on;
    if (on) voice.unlock();
    else voice.stop();
  });
  bindToggle('setLabels', 'labels');
  bindToggle('setDim', 'dimVideo', (on) => els.stage.classList.toggle('dim', on));
  bindToggle('setHands', 'hands', (on) => setHands(on));

  const bindSelect = (id, key, after) => {
    const sel = $(id);
    sel.value = settings[key];
    sel.addEventListener('change', () => {
      settings[key] = sel.value;
      persist();
      after?.(sel.value);
    });
  };
  bindSelect('setSquatDepth', 'squatDepth', (value) => exercises.squat.setOptions({ depthTarget: value }));
  bindSelect('setAngle', 'angleSource', () => jointEmas.forEach((e) => e.reset()));
  bindSelect('setMirror', 'mirror', applyMirror);
  bindSelect('setDelegate', 'delegate', () => {
    state.gpuFailed = false;
    if (state.running) ensurePose().catch((e) => showToast(`Couldn’t switch processor: ${e.message}`, 5000));
  });

  $('setCamera').addEventListener('change', (e) => {
    const [kind, value] = e.target.value.split(/:(.*)/s);
    if (kind === 'id') settings.deviceId = value;
    else {
      settings.deviceId = '';
      settings.facingMode = value;
    }
    persist();
    if (state.source === 'camera') restartCamera();
  });
  refreshCameraList();

  els.settings.addEventListener('click', (e) => {
    if (e.target === els.settings) els.settings.close(); // tap on backdrop
  });
}

function init() {
  $('versionTag').textContent = `v${APP_VERSION}`;
  $('versionTag2').textContent = `v${APP_VERSION}`;
  $('repoLink').href = REPO_URL;
  $('repoLink2').href = REPO_URL;

  buildAngleGrid();
  initSettingsUi();
  syncHandsUi();
  setMode(settings.mode);
  voice.enabled = settings.voice;
  els.stage.classList.toggle('dim', settings.dimVideo);

  $('btnStartCam').addEventListener('click', () => begin('camera'));
  $('btnStartFile').addEventListener('click', () => els.fileInput.click());
  $('btnUpload').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) begin('file', file);
  });

  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('btnSettings').addEventListener('click', () => {
    refreshCameraList();
    updateEngineInfo();
    els.settings.showModal();
  });
  els.btnFlip.addEventListener('click', () => {
    settings.deviceId = '';
    settings.facingMode = settings.facingMode === 'user' ? 'environment' : 'user';
    persist();
    restartCamera();
  });
  els.btnHands.addEventListener('click', () => setHands(!settings.hands));
  $('btnReset').addEventListener('click', () => {
    exercise()?.reset();
    renderExerciseHud(null);
  });
  $('btnGuideHide').addEventListener('click', () => {
    state.guideDismissed = true;
    els.guide.hidden = true;
  });

  // Video file controls
  const v = els.video;
  els.btnPlay.addEventListener('click', togglePlay);
  v.addEventListener('play', syncPlayButton);
  v.addEventListener('pause', syncPlayButton);
  v.addEventListener('ended', onVideoEnded);
  v.addEventListener('timeupdate', () => {
    if (state.source !== 'file' || !v.duration) return;
    els.seek.value = String(Math.round((v.currentTime / v.duration) * 1000));
    setText(els.timeVal, fmtTime(v.currentTime));
  });
  els.seek.addEventListener('input', () => {
    if (!v.duration) return;
    v.currentTime = (Number(els.seek.value) / 1000) * v.duration;
    exercise()?.interrupt();
  });
  els.btnSpeed.addEventListener('click', () => {
    const speeds = [1, 0.5, 0.25];
    state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
    v.playbackRate = state.speed;
    els.btnSpeed.textContent = `${state.speed}×`;
  });
  $('btnBackToCam').addEventListener('click', () => begin('camera'));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state.source === 'file' && !els.settings.open) {
      e.preventDefault();
      togglePlay();
    }
  });

  window.addEventListener('resize', () => renderer.measure());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.running) return;
    keepAwake();
    const track = state.stream?.getVideoTracks()[0];
    if (state.source === 'camera' && (!track || track.readyState === 'ended')) restartCamera();
  });

  // Install hints
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('installHint').hidden = !(ios && !standalone);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!state.installEvent) return;
    state.installEvent.prompt();
    await state.installEvent.userChoice.catch(() => {});
    state.installEvent = null;
    $('btnInstall').hidden = true;
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  }

  // Handy for debugging from the console: gth.analyzeUrl('https://…/clip.mp4')
  window.gth = {
    state,
    settings,
    exercises,
    analyzeUrl: async (url) => {
      await ensurePose();
      await openVideo(url, url);
      startRunning();
    },
  };

  // Developer shortcut: ?demo=<video url>&mode=squat&at=6 analyzes a clip
  // without any taps and pauses at `at` seconds (used for screenshots/tests).
  const params = new URLSearchParams(location.search);
  if (params.get('demo')) {
    if (['tracker', 'pushup', 'squat'].includes(params.get('mode'))) setMode(params.get('mode'));
    const at = Number(params.get('at'));
    if (at > 0) {
      v.addEventListener('timeupdate', function stop() {
        if (v.currentTime < at) return;
        v.pause();
        v.removeEventListener('timeupdate', stop);
      });
    }
    window.gth.analyzeUrl(params.get('demo')).catch((err) => showStartError(err.message));
  }
}

init();
