import { P, vis } from '../geometry.js';

export const COLORS = {
  left: '#ff9f43',
  right: '#38bdf8',
  center: '#e8eef5',
  accent: '#c6ff3d',
  good: '#34d399',
  warn: '#facc15',
  bad: '#ff5a6e',
  hand: '#f472b6',
  neutral: 'rgba(255,255,255,0.72)',
};

const TONE = { active: COLORS.accent, good: COLORS.good, warn: COLORS.warn, bad: COLORS.bad, neutral: COLORS.neutral };

// [from, to, group] — group picks the colour: l = person's left, r = right, c = torso.
const SEGMENTS = [
  [P.leftShoulder, P.rightShoulder, 'c'],
  [P.leftShoulder, P.leftHip, 'c'],
  [P.rightShoulder, P.rightHip, 'c'],
  [P.leftHip, P.rightHip, 'c'],
  [P.leftShoulder, P.leftElbow, 'l'],
  [P.leftElbow, P.leftWrist, 'l'],
  [P.leftWrist, P.leftPinky, 'l'],
  [P.leftWrist, P.leftIndex, 'l'],
  [P.leftWrist, P.leftThumb, 'l'],
  [P.leftPinky, P.leftIndex, 'l'],
  [P.rightShoulder, P.rightElbow, 'r'],
  [P.rightElbow, P.rightWrist, 'r'],
  [P.rightWrist, P.rightPinky, 'r'],
  [P.rightWrist, P.rightIndex, 'r'],
  [P.rightWrist, P.rightThumb, 'r'],
  [P.rightPinky, P.rightIndex, 'r'],
  [P.leftHip, P.leftKnee, 'l'],
  [P.leftKnee, P.leftAnkle, 'l'],
  [P.leftAnkle, P.leftHeel, 'l'],
  [P.leftHeel, P.leftFoot, 'l'],
  [P.leftAnkle, P.leftFoot, 'l'],
  [P.rightHip, P.rightKnee, 'r'],
  [P.rightKnee, P.rightAnkle, 'r'],
  [P.rightAnkle, P.rightHeel, 'r'],
  [P.rightHeel, P.rightFoot, 'r'],
  [P.rightAnkle, P.rightFoot, 'r'],
];
const GROUP_COLOR = { l: COLORS.left, r: COLORS.right, c: COLORS.center };
const HEAD = [P.nose, P.leftEar, P.rightEar];
const MIN_VIS = 0.5;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mirror = false;
    this.unit = 1; // canvas pixels per CSS pixel, so strokes look the same on any screen
  }

  /** Match the canvas to the video frame size; returns true if it changed. */
  resize(w, h) {
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.measure();
    return true;
  }

  /** Recompute the CSS→canvas scale (canvas uses object-fit: contain). */
  measure() {
    const { clientWidth: cw, clientHeight: ch, width: w, height: h } = this.canvas;
    if (!cw || !ch || !w || !h) return;
    this.unit = 1 / Math.min(cw / w, ch / h);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  pt(lm) {
    const x = this.mirror ? 1 - lm.x : lm.x;
    return { x: x * this.canvas.width, y: lm.y * this.canvas.height };
  }

  /** Frame-pixel point (unmirrored) → canvas point. */
  framePt(p) {
    return { x: this.mirror ? this.canvas.width - p.x : p.x, y: p.y };
  }

  /** Canvas point → frame-pixel point (for taps). */
  toFrame(p) {
    return { x: this.mirror ? this.canvas.width - p.x : p.x, y: p.y };
  }

  /**
   * Draws an exercise overlay spec: items of type seg | dash | arc |
   * angleLabel | label | dots, whose points are landmark indices or
   * normalized {x, y}.
   */
  drawSpec(lm, items) {
    if (!items) return;
    const get = (a) => (typeof a === 'number' ? lm[a] : a);
    for (const it of items) {
      const color = TONE[it.tone] || COLORS.neutral;
      switch (it.type) {
        case 'seg':
          this.segment(get(it.a), get(it.b), color, it.w || 7);
          break;
        case 'dash':
          this.dashed(get(it.a), get(it.b), color, it.w || 2);
          break;
        case 'arc':
          this.arc(get(it.a), get(it.b), get(it.c), color);
          if (it.label) this.angleLabel(get(it.a), get(it.b), get(it.c), it.label, color, { size: 15, offset: 30 });
          break;
        case 'angleLabel':
          this.angleLabel(get(it.a), get(it.b), get(it.c), it.text, color, { size: it.size || 13 });
          break;
        case 'label': {
          const p = this.pt(get(it.at));
          this.label(p.x, p.y, it.text, color, it.size || 13);
          break;
        }
        case 'dots':
          for (const id of it.ids) this.dot(get(id), 5, color);
          break;
        default:
          break;
      }
    }
  }

  /** Small name tags at frame-pixel points; tags that would overlap are skipped. */
  tags(items) {
    const { ctx } = this;
    const u = this.unit;
    const size = 11;
    ctx.save();
    ctx.font = `700 ${size * u}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const placed = [];
    for (const { at, text, color } of items) {
      const p = this.framePt(at);
      const w = ctx.measureText(text).width + 16 * u;
      const h = (size + 11) * u;
      const r = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
      placed.push(r);
      this.label(p.x, p.y, text, color, size);
    }
    ctx.restore();
  }

  /** Tap marker: a pulsing ring at a frame-pixel point; fades out with `age` (ms). */
  marker(at, color, age = 0) {
    const { ctx } = this;
    const u = this.unit;
    const p = this.framePt(at);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * u;
    ctx.globalAlpha = Math.max(0, 1 - age / 2500);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (10 + 4 * Math.sin(performance.now() / 160)) * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * u, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Measurement line between two frame-pixel points, with end caps and a label. */
  measureLine(p1, p2, text, color = COLORS.accent) {
    const { ctx } = this;
    const u = this.unit;
    const a = this.framePt(p1);
    const b = this.framePt(p2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const nx = -(b.y - a.y), ny = b.x - a.x;
    const nl = Math.hypot(nx, ny) || 1;
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(p.x + (nx / nl) * 5 * u, p.y + (ny / nl) * 5 * u);
      ctx.lineTo(p.x - (nx / nl) * 5 * u, p.y - (ny / nl) * 5 * u);
      ctx.stroke();
    }
    ctx.restore();
    if (text) this.label((a.x + b.x) / 2, (a.y + b.y) / 2 - 14 * u, text, color, 11);
  }

  skeleton(lm, { alpha = 1, width = 4 } = {}) {
    const { ctx } = this;
    const u = this.unit;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width * u;
    for (const [a, b, g] of SEGMENTS) {
      if (vis(lm[a]) < MIN_VIS || vis(lm[b]) < MIN_VIS) continue;
      this.line(lm[a], lm[b], GROUP_COLOR[g]);
    }
    for (let i = 0; i < lm.length; i++) {
      if (i > 0 && i < 11 && !HEAD.includes(i)) continue; // skip eyes and mouth
      if (vis(lm[i]) < MIN_VIS) continue;
      const side = i === 0 ? 'c' : i % 2 === 1 ? 'l' : 'r';
      this.dot(lm[i], (i >= 17 && i <= 22) || i >= 29 ? 3 : 4.5, GROUP_COLOR[side]);
    }
    ctx.restore();
  }

  line(a, b, color) {
    const { ctx } = this;
    const p = this.pt(a);
    const q = this.pt(b);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  segment(a, b, color, width = 7) {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = width * this.unit;
    this.line(a, b, color);
    ctx.restore();
  }

  dashed(a, b, color, width = 2) {
    const { ctx } = this;
    const u = this.unit;
    ctx.save();
    ctx.setLineDash([8 * u, 7 * u]);
    ctx.lineWidth = width * u;
    this.line(a, b, color);
    ctx.restore();
  }

  dot(lm, r, color) {
    const { ctx } = this;
    const u = this.unit;
    const p = this.pt(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * u, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0f14';
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** Filled wedge showing the angle at b between b→a and b→c. */
  arc(a, b, c, color, radius = 26) {
    const { ctx } = this;
    const u = this.unit;
    const pa = this.pt(a), pb = this.pt(b), pc = this.pt(c);
    const start = Math.atan2(pa.y - pb.y, pa.x - pb.x);
    let diff = Math.atan2(pc.y - pb.y, pc.x - pb.x) - start;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pb.x, pb.y);
    ctx.arc(pb.x, pb.y, radius * u, start, start + diff, diff < 0);
    ctx.closePath();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(pb.x, pb.y, radius * u, start, start + diff, diff < 0);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Angle label placed on the outside of the joint so it doesn't cover the
   * limbs. `away` (a landmark, e.g. the body centre) pushes labels on straight
   * limbs outward, so left and right labels don't stack on each other.
   */
  angleLabel(a, b, c, text, color, { size = 13, offset = 22, away = null } = {}) {
    const pa = this.pt(a), pb = this.pt(b), pc = this.pt(c);
    const n1 = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
    const n2 = Math.hypot(pc.x - pb.x, pc.y - pb.y) || 1;
    let bx = (pa.x - pb.x) / n1 + (pc.x - pb.x) / n2;
    let by = (pa.y - pb.y) / n1 + (pc.y - pb.y) / n2;
    const bn = Math.hypot(bx, by);
    // Nearly straight limb: the bisector is unstable, so put the label beside the joint.
    if (bn < 0.15) {
      bx = -(pc.y - pb.y) / n2;
      by = (pc.x - pb.x) / n2;
      if (away) {
        const pw = this.pt(away);
        if (bx * (pb.x - pw.x) + by * (pb.y - pw.y) < 0) {
          bx = -bx;
          by = -by;
        }
      }
    } else {
      bx /= -bn;
      by /= -bn;
    }
    const d = offset * this.unit;
    this.label(pb.x + bx * d, pb.y + by * d, text, color, size);
  }

  /** Text pill centred on a canvas-space point. */
  label(x, y, text, color, size = 13) {
    const { ctx } = this;
    const u = this.unit;
    ctx.save();
    ctx.font = `700 ${size * u}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12 * u;
    const h = (size + 9) * u;
    const r = h / 2;
    const left = Math.min(Math.max(x - w / 2, 2 * u), this.canvas.width - w - 2 * u);
    const top = Math.min(Math.max(y - h / 2, 2 * u), this.canvas.height - h - 2 * u);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(left, top, w, h, r) : ctx.rect(left, top, w, h);
    ctx.fillStyle = 'rgba(8, 11, 16, 0.82)';
    ctx.fill();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, left + w / 2, top + h / 2 + 0.5 * u);
    ctx.restore();
  }

  hands(result, connections) {
    if (!result?.landmarks?.length || !connections) return;
    const { ctx } = this;
    const u = this.unit;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5 * u;
    for (const hand of result.landmarks) {
      for (const { start, end } of connections) this.line(hand[start], hand[end], COLORS.hand);
      for (const lm of hand) {
        const p = this.pt(lm);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 * u, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
