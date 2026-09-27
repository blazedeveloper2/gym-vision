import { P, vis, toPx, angleFn, Ema, FacingTracker, mid, leanDeg, clamp } from '../geometry.js';
import { RepCounter } from './base.js';

const ARMS = [
  { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist },
  { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist },
];

/**
 * Overhead / shoulder press. Progress is how high the wrists are above the
 * shoulders in arm lengths: ~0.45 with the weights at the shoulders, ~0.92
 * with straight arms overhead. Both arms must press (or one, for a
 * single-arm press).
 */
export class PressAnalyzer extends RepCounter {
  static defaults = {
    rest: 0.45,
    top: 0.92,
    maxUneven: 0.3,
    maxLean: 20,
  };
  static statLabels = ['Elbows', 'Lean'];
  static meterLabel = 'height';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Step into view, facing the camera',
    ready: 'Ready — press overhead',
    going: (pct) => `Press… ${pct}%`,
    reached: 'Locked out — lower to your shoulders',
    notCounted: 'Not counted — press until your arms are straight',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'bring the weight back down to your shoulders', voice: 'Down to shoulders' },
    faults: {
      uneven: { live: 'Press evenly with both arms', rep: 'arms were uneven', voice: 'Even arms', cue: 'Even arms' },
      lean: { live: 'Don’t lean back — keep your ribs down', rep: 'leaned back', voice: 'Stay tall', cue: 'Ribs down' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    super.reset();
  }

  resetFilters() {
    this.heightEmas = [new Ema(0.5), new Ema(0.5)];
    this.elbowEmas = [new Ema(0.5), new Ema(0.5)];
    this.leanEma = new Ema(0.4);
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    const front = this.facingT.update(frame) === 'front';
    const angle = angleFn(frame, source === 'auto' ? (front ? '3d' : '2d') : source);
    const px = (i) => toPx(lm[i], frame.w, frame.h);

    const arms = ARMS.map((a, i) => {
      if ([a.sh, a.el, a.wr].some((j) => vis(lm[j]) < 0.5)) return null;
      const sh = px(a.sh), el = px(a.el), wr = px(a.wr);
      const len = Math.hypot(el.x - sh.x, el.y - sh.y) + Math.hypot(wr.x - el.x, wr.y - el.y) || 1;
      const h = this.heightEmas[i].next((sh.y - wr.y) / len);
      return { ...a, h, len, elbow: this.elbowEmas[i].next(angle(a.sh, a.el, a.wr)), p: (h - o.rest) / (o.top - o.rest) };
    });
    const seen = arms.filter(Boolean);
    if (seen.length === 0) return { status: 'partial', message: 'Make sure both arms are in view' };
    const up = seen.filter((a) => a.h > 0.15);
    if (up.length === 0) return { status: 'setup', message: 'Bring the weights up to your shoulders to start' };

    const progress = up.length === 2 ? Math.min(up[0].p, up[1].p) : up[0].p;
    const hipsSeen = vis(lm[P.leftHip]) >= 0.5 && vis(lm[P.rightHip]) >= 0.5;
    const lean = hipsSeen
      ? this.leanEma.next(leanDeg(mid(px(P.leftShoulder), px(P.rightShoulder)), mid(px(P.leftHip), px(P.rightHip))))
      : null;

    const faults = [];
    if (up.length === 2 && Math.max(up[0].p, up[1].p) > 0.3 && Math.abs(up[0].p - up[1].p) > o.maxUneven) faults.push('uneven');
    if (!front && lean != null && lean > o.maxLean) faults.push('lean');

    const overlay = [];
    for (const arm of up) {
      // Target line: where the wrist is with the arm straight overhead.
      const s = lm[arm.sh];
      const y = s.y - (o.top * arm.len) / frame.h;
      overlay.push(
        { type: 'dash', a: { x: s.x - 0.06, y }, b: { x: s.x + 0.06, y }, tone: 'neutral' },
        { type: 'seg', a: arm.sh, b: arm.el, tone: 'go' },
        { type: 'seg', a: arm.el, b: arm.wr, tone: 'go' },
        { type: 'dots', ids: [arm.sh, arm.el, arm.wr], tone: 'fault:uneven' },
      );
    }
    return {
      status: 'active',
      progress: clamp(progress, -1, 2),
      faults,
      stats: [
        { label: 'Elbows', value: seen.map((a) => `${Math.round(a.elbow)}°`).join(' / ') },
        { label: 'Lean', value: lean == null ? '–' : `${Math.round(lean)}°`, fault: 'lean' },
      ],
      overlay,
    };
  }
}
