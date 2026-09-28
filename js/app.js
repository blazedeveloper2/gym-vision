import { APP_VERSION, POSE_MODELS, REPO_URL } from './config.js';
import { loadSettings, saveSettings } from './settings.js';
import { PoseEngine, HandEngine, BodySegmenter } from './engine.js';
import { Tracker } from './tracker.js';
import { FrameSource, cameraErrorMessage } from './camera.js';
import { GLStage } from './render/gl.js';
import { Renderer } from './render/overlay.js';
import { Voice } from './voice.js';
import { exerciseById } from './exercises/index.js';
import { ScanTool } from './ui/scan.js';
import { ExerciseTool } from './ui/exercise.js';
import { MeasureTool } from './ui/measure-ui.js';
import { buildHome, buildPicker } from './ui/home.js';
import { bindSettings } from './ui/settings-ui.js';
import { icon } from './ui/icons.js';
import { $, h, setText, toast, banner, loading } from './ui/dom.js';

const fmtTime = (sec) => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '0:00');

class App {
  constructor() {
    this.settings = loadSettings();
    this.video = $('video');
    this.overlay = new Renderer($('overlay'));
    this.voice = new Voice();
    this.voice.enabled = this.settings.voice;
    this.source = new FrameSource(this.video);
    try {
      this.stage = new GLStage($('gl'));
    } catch (err) {
      console.warn('WebGL2 stage unavailable, using plain video', err);
      this.stage = null;
      $('stage').classList.add('nogl');
    }
    this.engine = new PoseEngine({ canvas: this.stage ? $('gl') : null });
    this.hands = new HandEngine();
    this.handConnections = null;
    this.tracker = new Tracker({ engine: this.engine, segmenter: new BodySegmenter() });
    this.scan = new ScanTool(this);
    this.measure = new MeasureTool(this);
    this.tool = null;
    this.speed = 1;
    this.detections = 0;
    this.perf = { frames: 0, since: performance.now() };
    this.wakeLock = null;
    this.installEvent = null;
    this.pendingKind = null;
  }

  get toolKind() {
    return this.tool?.kind || null;
  }

  persist() {
    saveSettings(this.settings);
  }

  /** Angle source for a tool; `auto` is what that tool prefers. */
  angleSource(auto = 'auto') {
    return this.settings.angleSource === 'auto' ? auto : this.settings.angleSource;
  }

  // ------------------------------------------------------------ setup

  init() {
    for (const id of ['versionTag', 'versionTag2']) $(id).textContent = `v${APP_VERSION}`;
    for (const id of ['repoLink', 'repoLink2']) $(id).href = REPO_URL;

    buildHome({ onOpen: (kind) => this.open(kind) });
    buildPicker({
      onPick: (kind) => {
        $('analyzeDialog').close();
        this.pickFile(kind);
      },
    });
    this.settingsUi = bindSettings(this, {
      model: () => this.tool && this.loadEngine().catch((e) => toast(`Couldn’t load model: ${e.message}`, 5000)),
      camera: () => this.source.kind === 'camera' && this.restartCamera(),
      mirror: () => this.applyMirror(),
      exercise: () => this.tool?.applySettings?.(),
      profile: () => this.scan.resolveTap(),
      voice: (on) => {
        this.voice.enabled = on;
        if (on) this.voice.unlock();
        else this.voice.stop();
      },
    });

    document.querySelectorAll('[data-action="settings"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.refreshCameraList();
        this.updateEngineInfo();
        this.settingsUi.refresh();
        $('settings').showModal();
      }),
    );
    document.querySelectorAll('[data-action="analyze"]').forEach((b) => b.addEventListener('click', () => $('analyzeDialog').showModal()));
    for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => e.target === d && d.close());

    $('btnBack').addEventListener('click', () => this.close());
    $('btnFlip').addEventListener('click', () => {
      this.settings.deviceId = '';
      this.settings.facingMode = this.settings.facingMode === 'user' ? 'environment' : 'user';
      this.persist();
      this.restartCamera();
    });
    $('btnUpload').addEventListener('click', () => this.pickFile(null));
    $('btnReset').addEventListener('click', () => this.tool?.reset?.());
    $('btnGuideHide').addEventListener('click', () => {
      if (this.tool?.entry) this.settings.guidesSeen[this.tool.entry.id] = true;
      this.persist();
      $('guide').hidden = true;
    });
    $('btnErrorHome').addEventListener('click', () => this.close());
    $('btnErrorVideo').addEventListener('click', () => this.pickFile(this.currentKind));
    $('fileInput').addEventListener('change', () => this.onFileChosen());
    $('setCamera').addEventListener('change', (e) => {
      const [kind, value] = e.target.value.split(/:(.*)/s);
      if (kind === 'id') this.settings.deviceId = value;
      else Object.assign(this.settings, { deviceId: '', facingMode: value });
      this.persist();
      if (this.source.kind === 'camera') this.restartCamera();
    });
    this.bindFileBar();

    window.addEventListener('popstate', () => {
      if (this.tool) this.close(true);
    });
    window.addEventListener('resize', () => this.overlay.measure());
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'Space' && this.source.kind === 'file') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'Escape' && this.tool) {
        this.close();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.tool) return;
      this.keepAwake();
      if (this.source.kind === 'camera' && (!this.source.track || this.source.track.readyState === 'ended')) this.restartCamera();
    });

    this.setupInstall();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
    }

    // Warm up: fetch MediaPipe and the default model while the home screen is shown.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(() => {
      if (!this.tool && navigator.onLine !== false && !navigator.connection?.saveData) {
        this.engine.load({ model: this.settings.model, delegate: this.settings.delegate, masks: false }).catch(() => {});
      }
    });

    this.handleDeepLink();
    window.gv = this; // handy for debugging from the console
  }

  setupInstall() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('installHint').hidden = !(ios && !standalone);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e;
      $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', async () => {
      if (!this.installEvent) return;
      this.installEvent.prompt();
      await this.installEvent.userChoice.catch(() => {});
      this.installEvent = null;
      $('btnInstall').hidden = true;
    });
  }

  /**
   * ?tool=scan|measure|<exercise> opens a tool; ?demo=<video url>&tool=…&at=<s>
   * analyzes a clip without taps (used for automated screenshots), with
   * optional &layers=skeleton,outline,parts and &tap=<x>,<y> (0..1).
   */
  handleDeepLink() {
    const q = new URLSearchParams(location.search);
    const raw = q.get('tool');
    const kind = raw && (raw === 'scan' || raw === 'measure' ? raw : exerciseById(raw) ? `exercise:${raw}` : null);
    const demo = q.get('demo');
    if (q.get('layers')) {
      const on = new Set(q.get('layers').split(','));
      for (const k of Object.keys(this.settings.layers)) this.settings.layers[k] = on.has(k);
    }
    if (demo) {
      // Automated runs stay silent (no spoken rep counts from a test browser).
      this.voice.enabled = q.get('voice') === '1';
      if (Number(q.get('height')) > 0) this.settings.heightCm = Number(q.get('height'));
      if (['male', 'female'].includes(q.get('sex'))) this.settings.sex = q.get('sex');
      const at = Number(q.get('at')) || 0;
      if (at > 0) {
        const stop = () => {
          if (this.video.currentTime < at) return;
          this.video.pause();
          this.video.removeEventListener('timeupdate', stop);
        };
        this.video.addEventListener('timeupdate', stop);
      }
      const tap = q.get('tap');
      if (tap) {
        const [tx, ty] = tap.split(',').map(Number);
        const iv = setInterval(() => {
          if (!this.video.videoWidth || !this.scan.parts) return;
          this.scan.tap = { x: tx * this.video.videoWidth, y: ty * this.video.videoHeight, down: true, since: performance.now(), info: null };
          clearInterval(iv);
        }, 200);
      }
      this.open(kind || 'scan', demo);
    } else if (kind) {
      this.open(kind);
    }
  }

  // ------------------------------------------------------------ sessions

  makeTool(kind) {
    if (kind === 'scan') return this.scan;
    if (kind === 'measure') return this.measure;
    const entry = kind?.startsWith('exercise:') && exerciseById(kind.slice(9));
    return entry ? new ExerciseTool(this, entry) : null;
  }

  /**
   * Opens a tool with the camera (src = null), a File, or a video URL.
   */
  async open(kind, src = null) {
    if (this.opening) return;
    this.opening = true;
    try {
      this.voice.unlock();
      const tool = this.makeTool(kind);
      if (!tool) return;
      if (tool.kind === 'measure' && !this.settings.heightCm && !(await this.askHeight())) return;

      this.tool?.exit?.();
      this.tool = tool;
      this.currentKind = kind;
      this.showSession(tool);
      tool.enter();

      const enginePromise = this.loadEngine();
      enginePromise.catch(() => {});
      loading(src ? 'Loading video…' : 'Starting camera…');
      try {
        if (src) await this.openFileSource(src);
        else await this.startCamera();
      } catch (err) {
        console.error(err);
        this.sessionError(src ? err.message || String(err) : cameraErrorMessage(err), !src);
        return;
      }
      if (!this.engine.task) {
        const m = POSE_MODELS[this.tool?.model || this.settings.model];
        loading(`Loading the ${m.label} tracking model (${m.size}). Only slow the first time.`);
      }
      try {
        await enginePromise;
      } catch (err) {
        console.error(err);
        this.sessionError('Couldn’t load the tracking model. Check your internet connection and try again.', false);
        return;
      }
      loading(null);
      if (tool.wantsHands) this.ensureHands();
      if (tool.wantsLimbs) this.tracker.loadCloseUp(this.settings.delegate === 'auto' && this.engine.gpuFailed ? 'CPU' : this.settings.delegate);
      this.source.startLoop(() => this.onFrame());
      if (this.source.kind === 'file') this.playAfterWarmup();
      this.keepAwake();
    } finally {
      this.opening = false;
    }
  }

  showSession(tool) {
    const app = $('app');
    app.dataset.view = 'session';
    app.dataset.tool = tool.kind;
    $('session').hidden = false;
    $('sessionError').hidden = true;
    setText($('sessionTitle'), tool.title);
    setText($('sessionHint'), tool.hint);
    banner('');
    if (!history.state?.session) history.pushState({ session: true }, '');
    requestAnimationFrame(() => this.overlay.measure());
  }

  close(fromPop = false) {
    this.tool?.exit?.();
    this.tool = null;
    this.source.stop();
    this.voice.stop();
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
    loading(null);
    banner('');
    const app = $('app');
    app.dataset.view = 'home';
    app.dataset.tool = '';
    app.classList.remove('file-mode');
    $('session').hidden = true;
    $('fileBar').hidden = true;
    $('guide').hidden = true;
    if (!fromPop && history.state?.session) history.back();
  }

  sessionError(message, offerVideo) {
    loading(null);
    this.source.stop();
    setText($('sessionErrorText'), message);
    $('btnErrorVideo').hidden = !offerVideo;
    $('sessionError').hidden = false;
  }

  /** Loads the model the current tool needs, with masks only if something uses them. */
  loadEngine() {
    const tool = this.tool;
    const model = tool?.model || this.settings.model;
    const masks = !!tool?.needsMasks && (!!this.stage || tool.kind === 'measure');
    return this.engine.load({ model, delegate: this.settings.delegate, masks }).then(() => this.updateEngineInfo());
  }

  /** A tool's layers changed: switch masks / hand tracking on or off. */
  onToolNeedsChanged() {
    const tool = this.tool;
    if (!tool) return;
    this.engine.setMasks(!!tool.needsMasks && !!this.stage).catch(() => {});
    if (tool.wantsHands) this.ensureHands();
    this.source.refresh();
  }

  async ensureHands() {
    if (this.hands.task) return;
    toast('Loading finger tracking…');
    try {
      await this.hands.load(this.settings.delegate === 'auto' && this.engine.gpuFailed ? 'CPU' : this.settings.delegate);
      this.handConnections = await this.hands.connections();
      toast('Finger tracking on');
    } catch (err) {
      console.error(err);
      this.settings.layers.fingers = false;
      this.persist();
      this.scan.syncChips();
      toast('Couldn’t load finger tracking. Check your connection.', 4000);
    }
  }

  // ------------------------------------------------------------ sources

  async startCamera() {
    const s = this.settings;
    await this.source.startCamera({ deviceId: s.deviceId, facingMode: s.facingMode, fps: s.fps });
    $('app').classList.remove('file-mode');
    $('fileBar').hidden = true;
    $('btnFlip').hidden = false;
    this.applyMirror();
    this.refreshCameraList();
  }

  async restartCamera() {
    try {
      await this.startCamera();
      this.tool?.interrupt?.();
    } catch (err) {
      console.error(err);
      toast(cameraErrorMessage(err), 5000);
    }
  }

  async openFileSource(src) {
    const isFile = src instanceof File;
    await this.source.openFile(isFile ? URL.createObjectURL(src) : src, isFile ? src.name : 'video', this.speed);
    $('app').classList.add('file-mode');
    $('fileBar').hidden = false;
    $('btnFlip').hidden = true;
    this.tool?.reset?.();
    this.applyMirror();
    this.syncPlayButton();
  }

  pickFile(kind) {
    this.pendingKind = kind;
    $('fileInput').click();
  }

  async onFileChosen() {
    const input = $('fileInput');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const kind = this.pendingKind;
    this.pendingKind = null;
    if (kind && (!this.tool || kind !== this.currentKind || !$('sessionError').hidden)) {
      if (this.tool) this.close(true);
      return this.open(kind, file);
    }
    if (!this.tool) return;
    loading('Loading video…');
    try {
      await this.openFileSource(file);
      if (!this.source.running) this.source.startLoop(() => this.onFrame());
      this.playAfterWarmup();
    } catch (err) {
      toast(err.message || String(err), 5000);
    } finally {
      loading(null);
    }
  }

  /** The first detection compiles GPU shaders; start playback once it's done. */
  async playAfterWarmup() {
    const before = this.detections;
    const deadline = performance.now() + 8000;
    this.source.refresh();
    while (this.detections === before && performance.now() < deadline) await new Promise((r) => requestAnimationFrame(r));
    this.video.play().catch(() => {});
  }

  applyMirror() {
    const m = this.settings.mirror;
    const mirror = m === 'on' || (m === 'auto' && this.source.kind === 'camera' && this.source.facing !== 'environment');
    this.overlay.mirror = mirror;
    $('stage').classList.toggle('mirrored', mirror);
    this.source.refresh();
  }

  async refreshCameraList() {
    const sel = $('setCamera');
    let devices = [];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    } catch {
      // ignore
    }
    const opts = [new Option('Front camera', 'facing:user'), new Option('Back camera', 'facing:environment'), ...devices.map((d, i) => new Option(d.label || `Camera ${i + 1}`, `id:${d.deviceId}`))];
    sel.replaceChildren(...opts);
    const want = this.settings.deviceId ? `id:${this.settings.deviceId}` : `facing:${this.settings.facingMode}`;
    sel.value = opts.some((o) => o.value === want) ? want : `facing:${this.settings.facingMode}`;
  }

  updateEngineInfo() {
    const e = this.engine;
    const model = e.key ? POSE_MODELS[e.key.split('|')[0]] : null;
    $('engineInfo').textContent = model ? `Running: ${model.label} model on ${e.delegate}${this.stage ? ' · GPU rendering' : ''}` : '';
  }

  // ------------------------------------------------------------ the frame loop

  onFrame() {
    const tool = this.tool;
    if (!tool || !this.engine.ready) return;
    try {
      this.tracker.track(this.video, { closeUp: !!tool.wantsLimbs }, (pose, mask, ts) => {
        this.detections++;
        this.present(tool, this.makeFrame({ ...pose, ts }), mask, ts);
      });
    } catch (err) {
      this.onDetectError(err);
    }
    this.countFps();
  }

  makeFrame({ lm, world, source, ts }) {
    const v = this.video;
    return {
      lm,
      world,
      source,
      w: v.videoWidth,
      h: v.videoHeight,
      // Files use media time so tempo is right at slow-motion speeds.
      t: this.source.kind === 'file' ? v.currentTime * 1000 : ts,
    };
  }

  /** Hands, tool update, GL stage and overlay for one analyzed frame. */
  present(tool, frame, mask, ts) {
    const v = this.video;
    let hands = null;
    if (tool.wantsHands && this.hands.task) {
      try {
        hands = this.hands.detect(v, ts, frame.lm);
      } catch (err) {
        console.error('hand tracking failed', err);
        this.hands.close();
        this.settings.layers.fingers = false;
        this.scan.syncChips();
        toast('Finger tracking isn’t working on this device, so it was turned off.', 5000);
      }
    }

    const plan = tool.update(frame, { mask, hands }) || {};
    this.overlay.resize(frame.w, frame.h);
    if (this.stage) {
      this.stage.render({
        video: v,
        mask,
        mirror: this.overlay.mirror,
        dim: this.settings.dim,
        outline: !!plan.outline,
        fill: !!plan.fill,
        parts: plan.parts || null,
        colorParts: plan.colorParts ?? true,
        highlight: plan.highlight ?? -1,
        px: this.overlay.unit,
      });
    } else {
      v.style.opacity = String(1 - this.settings.dim);
    }
    this.overlay.clear();
    tool.draw(this.overlay, frame, hands);
  }

  onDetectError(err) {
    console.error('pose detection failed', err);
    const e = this.engine;
    if (e.delegate === 'GPU' && this.settings.delegate !== 'GPU' && !e.gpuFailed) {
      e.gpuFailed = true;
      e.close();
      toast('GPU tracking failed on this device — switching to CPU.');
      this.loadEngine().catch((x) => toast(`Couldn’t restart tracking: ${x.message}`, 6000));
    } else {
      banner('Tracking stopped because of an error. Go back and try again.', 'bad');
      e.close();
    }
  }

  countFps() {
    this.perf.frames++;
    const now = performance.now();
    const dt = now - this.perf.since;
    if (dt >= 1000) {
      const fps = Math.round((this.perf.frames * 1000) / dt);
      setText($('fps'), `${fps} fps · ${Math.round(this.engine.inferMs)} ms`);
      this.perf.frames = 0;
      this.perf.since = now;
    }
  }

  async keepAwake() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
      }
    } catch {
      // Not supported or not allowed; the screen may dim during long sets.
    }
  }

  // ------------------------------------------------------------ video files

  bindFileBar() {
    const v = this.video;
    $('btnPlay').addEventListener('click', () => this.togglePlay());
    v.addEventListener('play', () => this.syncPlayButton());
    v.addEventListener('pause', () => this.syncPlayButton());
    v.addEventListener('ended', () => {
      this.syncPlayButton();
      const an = this.tool?.analyzer;
      if (an) toast(`Finished: ${an.summaryText()}`, 6000);
    });
    v.addEventListener('timeupdate', () => {
      if (this.source.kind !== 'file' || !v.duration) return;
      $('seek').value = String(Math.round((v.currentTime / v.duration) * 1000));
      setText($('timeVal'), fmtTime(v.currentTime));
    });
    $('seek').addEventListener('input', () => {
      if (!v.duration) return;
      v.currentTime = (Number($('seek').value) / 1000) * v.duration;
      this.tool?.interrupt?.();
    });
    $('btnSpeed').addEventListener('click', () => {
      const speeds = [1, 0.5, 0.25];
      this.speed = speeds[(speeds.indexOf(this.speed) + 1) % speeds.length];
      v.playbackRate = this.speed;
      $('btnSpeed').textContent = `${this.speed}×`;
    });
    $('btnBackToCam').addEventListener('click', async () => {
      loading('Starting camera…');
      try {
        await this.startCamera();
        this.tool?.reset?.();
        if (!this.source.running) this.source.startLoop(() => this.onFrame());
      } catch (err) {
        toast(cameraErrorMessage(err), 5000);
      } finally {
        loading(null);
      }
    });
  }

  togglePlay() {
    const v = this.video;
    if (v.ended) {
      this.tool?.reset?.();
      v.currentTime = 0;
    }
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
  }

  syncPlayButton() {
    const paused = this.video.paused || this.video.ended;
    $('btnPlay').innerHTML = icon(paused ? 'play' : 'pause');
    $('btnPlay').setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  // ------------------------------------------------------------ height prompt

  askHeight() {
    const s = this.settings;
    const box = $('heightInputs');
    const inches = s.units === 'in';
    const make = (ph, min, max, val) => h('input', { type: 'number', inputmode: 'decimal', placeholder: ph, min, max, step: '0.5', value: val ?? '', required: true });
    const cmInput = make('cm', 100, 250, s.heightCm?.toFixed(1));
    const ft = make('ft', 3, 8, s.heightCm ? Math.floor(s.heightCm / 30.48) : '');
    const inch = make('in', 0, 11.5, s.heightCm ? (((s.heightCm / 2.54) % 12).toFixed(1)) : '');
    box.replaceChildren(...(inches ? [ft, h('span', { class: 'unit' }, 'ft'), inch, h('span', { class: 'unit' }, 'in')] : [cmInput, h('span', { class: 'unit' }, 'cm')]));
    const dlg = $('heightDialog');
    return new Promise((resolve) => {
      const done = (ok) => {
        $('heightForm').onsubmit = null;
        $('btnHeightCancel').onclick = null;
        dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(ok);
      };
      $('heightForm').onsubmit = (e) => {
        e.preventDefault();
        const cm = inches ? (Number(ft.value) * 12 + Number(inch.value || 0)) * 2.54 : Number(cmInput.value);
        if (!(cm >= 100 && cm <= 250)) {
          toast('Enter a height between 100 and 250 cm (3′3″–8′2″).');
          return;
        }
        s.heightCm = cm;
        this.persist();
        done(true);
      };
      $('btnHeightCancel').onclick = () => done(false);
      dlg.onclose = () => done(!!s.heightCm);
      dlg.showModal();
    });
  }
}

new App().init();
