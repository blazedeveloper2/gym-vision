/**
 * Frame source: the camera or a video file, plus a frame loop that processes
 * each new video frame exactly once.
 *
 * requestVideoFrameCallback fires once per decoded frame, so analysis runs at
 * the camera's real rate (60 fps where supported) without polling. A rAF
 * watchdog takes over if it stalls (older browsers, source switches).
 */
export class FrameSource {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.kind = 'none'; // 'camera' | 'file'
    this.fileUrl = null;
    this.running = false;
    this.gen = 0;
    this.lastCallback = 0;
    this.lastTime = -1;
  }

  get track() {
    return this.stream?.getVideoTracks()[0] || null;
  }

  /** 'user' | 'environment' | '' — which way the active camera faces. */
  get facing() {
    const t = this.track;
    const f = t?.getSettings?.().facingMode;
    if (f) return f;
    if (!t) return '';
    return /back|rear|environment/i.test(t.label) ? 'environment' : 'user';
  }

  get actualFps() {
    return this.track?.getSettings?.().frameRate || 0;
  }

  async startCamera({ deviceId = '', facingMode = 'user', fps = 60, width = 1280, height = 720 } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext
          ? 'This browser can’t access the camera. Try Safari on iPhone or Chrome on Android.'
          : 'The camera only works over a secure (https) connection.',
      );
    }
    this.stopStream();
    const base = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps, max: 60 } };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode },
      });
    } catch (err) {
      // A saved camera may be gone; fall back to the default for this direction.
      if (!deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode } });
      err.fellBack = true;
    }
    this.stream = stream;
    this.kind = 'camera';
    this.revokeFile();
    const v = this.video;
    v.removeAttribute('src');
    v.srcObject = stream;
    v.loop = false;
    v.playbackRate = 1;
    await v.play().catch(() => {});
    this.lastTime = -1;
    return stream;
  }

  async openFile(src, name = 'video', speed = 1) {
    this.stopStream();
    this.revokeFile();
    this.fileUrl = src.startsWith('blob:') ? src : null;
    this.kind = 'file';
    const v = this.video;
    v.srcObject = null;
    v.crossOrigin = src.startsWith('blob:') ? null : 'anonymous';
    v.src = src;
    v.loop = false;
    v.playbackRate = speed;
    this.lastTime = -1;
    const loaded = new Promise((resolve, reject) => {
      v.onloadeddata = resolve;
      v.onerror = () => reject(new Error(`This browser can’t play “${name}”. Try an MP4 (H.264) file.`));
    });
    v.play().catch(() => {}); // iOS only loads video data once playback starts
    try {
      await loaded;
    } finally {
      v.onloadeddata = null;
      v.onerror = null;
    }
    // Hold on the first frame; the caller starts playback once tracking is warm.
    v.pause();
    if (v.currentTime !== 0) {
      await new Promise((resolve) => {
        v.addEventListener('seeked', resolve, { once: true });
        v.currentTime = 0;
      });
    }
  }

  stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  revokeFile() {
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
  }

  /** Stops everything and releases the camera. */
  stop() {
    this.stopLoop();
    this.stopStream();
    this.revokeFile();
    const v = this.video;
    v.pause();
    v.srcObject = null;
    v.removeAttribute('src');
    v.load();
    this.kind = 'none';
  }

  /** Calls `onFrame(meta)` once per new video frame. */
  startLoop(onFrame) {
    this.stopLoop();
    this.running = true;
    this.onFrame = onFrame;
    const gen = ++this.gen;
    const v = this.video;
    const rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    // Each frame is delivered once, whichever path notices it first.
    const deliver = (meta) => {
      if (v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastTime) return;
      this.lastTime = v.currentTime;
      this.onFrame(meta);
    };
    let token = 0;
    const chain = () => {
      const mine = ++token; // re-arming retires any older chain
      const step = (now, meta) => {
        if (!this.running || gen !== this.gen || mine !== token) return;
        this.lastCallback = performance.now();
        v.requestVideoFrameCallback(step);
        deliver(meta);
      };
      v.requestVideoFrameCallback(step);
    };
    if (rvfc) chain();

    // Watchdog: rAF polling if frame callbacks stall; re-arms the callback chain.
    const tick = () => {
      if (!this.running || gen !== this.gen) return;
      requestAnimationFrame(tick);
      if (rvfc && performance.now() - this.lastCallback < 400) return;
      if (rvfc && !v.paused && performance.now() - this.lastCallback > 1000) {
        this.lastCallback = performance.now();
        chain();
      }
      deliver(null);
    };
    requestAnimationFrame(tick);
  }

  stopLoop() {
    this.running = false;
    this.gen++;
  }

  /** Forces the current (paused) frame to be analyzed again. */
  refresh() {
    this.lastTime = -1;
    if (this.video.paused && this.running && this.video.readyState >= 2) this.onFrame?.(null);
  }
}

export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. You can analyze a recorded video instead.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    default:
      return err?.message || 'Couldn’t start the camera.';
  }
}
