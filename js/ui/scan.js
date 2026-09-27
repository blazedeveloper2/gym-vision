import { JOINTS, vis, angleFn, Ema } from '../geometry.js';
import { computeParts, identify, regionLabel, partCenter, PART_COLORS } from '../body/parts.js';
import { COLORS } from '../render/overlay.js';
import { $, setText, banner } from './dom.js';

/**
 * Body Scan: skeleton, glowing outline, body-part colouring and a detailed
 * identifier — tap or drag over the body to name what's under your finger.
 */
export class ScanTool {
  constructor(app) {
    this.app = app;
    this.kind = 'scan';
    this.title = 'Body Scan';
    this.hint = 'Stand 2–3 m back so your whole body is in view';
    this.partsBuf = null;
    this.parts = null;
    this.tap = null; // {x, y (frame px), down, since, info}
    this.noPersonSince = null;
    this.jointEmas = JOINTS.map(() => new Ema(0.45));
    this.cells = [];
    this.buildAngleGrid();
    document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => this.toggle(b.dataset.layer)));
    this.bindPointer();
  }

  get layers() {
    return this.app.settings.layers;
  }

  get needsMasks() {
    return this.layers.outline || this.layers.parts;
  }

  get wantsHands() {
    return this.layers.fingers;
  }

  enter() {
    this.syncChips();
    this.tap = null;
    $('callout').hidden = true;
    this.noPersonSince = null;
  }

  exit() {
    $('callout').hidden = true;
    this.tap = null;
  }

  toggle(layer) {
    this.layers[layer] = !this.layers[layer];
    this.app.persist();
    this.syncChips();
    this.app.onToolNeedsChanged();
  }

  syncChips() {
    document.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(!!this.layers[b.dataset.layer])));
    $('anglesCard').hidden = !this.layers.angles;
  }

  buildAngleGrid() {
    const grid = $('angleGrid');
    for (const label of [...new Set(JOINTS.map((j) => j.label))]) {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = label;
      grid.append(name);
      for (const side of ['L', 'R']) {
        const i = JOINTS.findIndex((j) => j.label === label && j.side === side);
        const cell = document.createElement('span');
        cell.className = `v ${side}`;
        cell.textContent = '–';
        grid.append(cell);
        this.cells[i] = cell;
      }
    }
  }

  bindPointer() {
    const stage = $('stage');
    const toFrame = (e) => {
      const canvas = $('overlay');
      const rect = canvas.getBoundingClientRect();
      const s = Math.min(rect.width / canvas.width, rect.height / canvas.height);
      if (!s) return null;
      const ox = (rect.width - canvas.width * s) / 2;
      const oy = (rect.height - canvas.height * s) / 2;
      const p = { x: (e.clientX - rect.left - ox) / s, y: (e.clientY - rect.top - oy) / s };
      if (p.x < 0 || p.y < 0 || p.x > canvas.width || p.y > canvas.height) return null;
      return this.app.overlay.toFrame(p);
    };
    const onDown = (e) => {
      if (this.app.toolKind !== 'scan') return;
      const p = toFrame(e);
      if (!p) return;
      stage.setPointerCapture?.(e.pointerId);
      this.tap = { ...p, down: true, since: performance.now(), info: null, spoken: null };
      this.resolveTap();
    };
    const onMove = (e) => {
      if (!this.tap?.down) return;
      const p = toFrame(e);
      if (!p) return;
      Object.assign(this.tap, p, { since: performance.now() });
      this.resolveTap();
    };
    const onUp = () => {
      if (!this.tap) return;
      this.tap.down = false;
      this.tap.since = performance.now();
      const info = this.tap.info;
      if (info && this.tap.spoken !== info.name) {
        this.tap.spoken = info.name;
        this.app.voice.say(info.name, { key: 'part', gapMs: 300 });
      }
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
  }

  resolveTap() {
    if (!this.tap || !this.parts) return;
    this.tap.info = identify(this.parts, this.tap.x, this.tap.y);
    const info = this.tap.info;
    const callout = $('callout');
    callout.hidden = false;
    setText($('calloutName'), info ? info.name : 'Not on your body');
    setText($('calloutDetail'), info ? info.detail || info.region : 'Tap inside your body outline');
    $('calloutDot').style.background = info ? PART_COLORS[info.group] || COLORS.accent : 'transparent';
  }

  /** Runs every analyzed frame; returns what the GL stage should draw. */
  update(frame, { hands }) {
    const { lm, w, h } = frame;
    this.parts = lm ? (this.partsBuf = computeParts(lm, w, h, this.layers.fingers ? hands : null, this.partsBuf)) : null;

    if (this.tap) {
      const age = performance.now() - this.tap.since;
      if (!this.tap.down && age > 2600) {
        this.tap = null;
        $('callout').hidden = true;
      } else {
        this.resolveTap(); // the body may move under a still finger
      }
    }

    if (lm) this.noPersonSince = null;
    else this.noPersonSince ??= frame.t;
    const lost = this.noPersonSince != null && frame.t - this.noPersonSince > 800;
    banner(lost && !this.tap ? 'No one in view — step back so your whole body is visible' : '', 'info');
    $('scanHint').hidden = !!this.tap;

    return {
      outline: this.layers.outline,
      parts: this.layers.parts && this.parts ? this.parts : null,
      highlight: this.tap?.info?.index ?? -1,
    };
  }

  draw(overlay, frame, hands) {
    const { lm } = frame;
    const L = this.layers;
    if (lm && L.skeleton) overlay.skeleton(lm, { alpha: L.parts ? 0.75 : 1 });
    if (hands && L.fingers) overlay.hands(hands, this.app.handConnections);

    if (lm && L.parts && this.parts) {
      // Bigger regions first, so they win when labels would overlap.
      const order = ['chest', 'core', 'hips', 'head', 'thigh', 'upperArm', 'lowerLeg', 'forearm', 'shoulder', 'neck'];
      const tags = this.parts.list
        .filter((p) => p.visible && order.includes(p.group))
        .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
        .map((p) => ({ at: partCenter(p), text: regionLabel(p, this.parts), color: PART_COLORS[p.group] }));
      overlay.tags(tags);
    }

    if (L.angles) {
      const angle = lm ? angleFn(frame, this.app.angleSource('3d')) : null;
      const center = lm && { x: (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4, y: (lm[11].y + lm[12].y + lm[23].y + lm[24].y) / 4 };
      JOINTS.forEach((j, i) => {
        const ok = lm && vis(lm[j.a]) > 0.5 && vis(lm[j.b]) > 0.5 && vis(lm[j.c]) > 0.5;
        if (!ok) {
          this.jointEmas[i].reset();
          setText(this.cells[i], '–');
          return;
        }
        const text = `${Math.round(this.jointEmas[i].next(angle(j.a, j.b, j.c)))}°`;
        setText(this.cells[i], text);
        if (this.app.settings.labels) overlay.angleLabel(lm[j.a], lm[j.b], lm[j.c], text, j.side === 'L' ? COLORS.left : COLORS.right, { away: center });
      });
    }

    if (this.tap) {
      const color = this.tap.info ? PART_COLORS[this.tap.info.group] || COLORS.accent : COLORS.bad;
      overlay.marker(this.tap, color, this.tap.down ? 0 : performance.now() - this.tap.since);
    }
  }
}
