import { P, vis, toPx, angleFn, Ema, FacingTracker, mid, leanDeg } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, ChestSide, LEFT, RIGHT, sub, dot, unit } from './kit.js';

const ARMS = [
  { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip },
  { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip },
];

/**
 * Bicep curls — both arms together or alternating. Progress follows whichever
 * arm is curling (elbow ~155° straight → ~60° at the top). Checks that the
 * upper arm stays by the side (side-on it can tell forward from back) and the
 * body doesn't swing.
 */
export class CurlAnalyzer extends RepCounter {
  static defaults = {
    restAngle: 155,
    topAngle: 60,
    maxSwing: 35, // upper arm forward of the torso (deg)
    maxBack: 20, // ...or behind it (side view)
    maxRaise: 65, // beyond this it's a raise or a flex pose, not a curl
    maxSway: 15, // torso lean change from the start (deg)
  };
  static statLabels = ['Elbow', 'Upper arm'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Step into view — side-on or facing the camera',
    ready: 'Ready — curl the weight up',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Squeeze at the top — now lower slowly',
    notCounted: 'Not counted — curl all the way up',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'lower all the way down between reps', voice: 'Full extension' },
    faults: {
      raise: { rep: 'elbow came up', miss: 'Not counted — keep your elbow down by your side and curl', missVoice: 'Elbows down' },
      swing: { live: 'Keep your elbows pinned to your sides', rep: 'elbow drifted forward', voice: 'Elbows in', cue: 'Elbows in' },
      back: { live: 'Don’t let your elbows drift behind you', rep: 'elbow drifted back', voice: 'Elbows by your sides', cue: 'Elbows by your sides' },
      sway: { live: 'Don’t swing your body — keep your torso still', rep: 'body swung', voice: 'No swinging', cue: 'Stay still' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    this.chest = new ChestSide();
    super.reset();
  }

  resetFilters() {
    this.elbowEmas = [new Ema(0.5), new Ema(0.5)];
    this.swingEmas = [new Ema(0.4), new Ema(0.4)];
    this.leanEma = new Ema(0.4);
    this.restLean = null;
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    const front = this.facingT.update(frame) === 'front';
    const angle = angleFn(frame, source === 'auto' ? (front ? '3d' : '2d') : source);

    const arms = ARMS.map((a, i) => {
      if ([a.sh, a.el, a.wr, a.hip].some((j) => vis(lm[j]) < 0.5)) return null;
      const elbow = this.elbowEmas[i].next(angle(a.sh, a.el, a.wr));
      const swing = this.swingEmas[i].next(angle(a.el, a.sh, a.hip));
      return { ...a, elbow, swing, p: (o.restAngle - elbow) / (o.restAngle - o.topAngle) };
    });
    const seen = arms.filter(Boolean);
    if (seen.length === 0) return { status: 'partial', message: 'Make sure your arm and hip are in view' };

    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const leanNow = leanDeg(px(seen[0].sh), px(seen[0].hip));
    if (leanNow > 45) return { status: 'setup', message: 'Stand up tall to start' };
    const lean = this.leanEma.next(leanNow);
    if (this.phase !== 'down' || this.restLean == null) this.restLean = lean;

    const active = seen.reduce((a, b) => (b.p > a.p ? b : a));
    const progress = active.p;
    // Side-on, which side of the torso the elbow is on: + in front, − behind.
    let swing = active.swing;
    if (!front) {
      const f = new Frame(frame);
      const S = active.sh === P.leftShoulder ? LEFT : RIGHT;
      const chest = this.chest.update(f, S, unit(sub(f.p(S.sh), f.p(S.hip))));
      if (chest && dot(sub(f.p(S.el), f.p(S.sh)), chest) < 0) swing = -swing;
    }
    const faults = [];
    if (progress > 0.2 && swing > o.maxSwing) faults.push('swing');
    if (progress > 0.2 && swing < -o.maxBack) faults.push('back');
    if (progress > 0.2 && Math.abs(lean - this.restLean) > o.maxSway) faults.push('sway');

    const e = Math.round(active.elbow);
    const overlay = [{ type: 'dash', a: mid(lm[P.leftShoulder], lm[P.rightShoulder]), b: mid(lm[P.leftHip], lm[P.rightHip]), tone: 'fault:sway' }];
    for (const arm of seen) {
      const tone = arm === active ? 'go' : 'neutral';
      overlay.push(
        { type: 'seg', a: arm.sh, b: arm.el, tone: arm === active ? 'fault:swing|back' : 'neutral', w: 6 },
        { type: 'seg', a: arm.el, b: arm.wr, tone },
        { type: 'dots', ids: [arm.el, arm.wr], tone },
      );
    }
    overlay.push({ type: 'arc', a: active.sh, b: active.el, c: active.wr, tone: 'go', label: `${e}°` });

    return {
      status: 'active',
      progress,
      faults,
      elbow: active.elbow,
      swing,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Upper arm', value: `${Math.round(swing)}°`, fault: 'swing|back' },
      ],
      overlay,
    };
  }

  repState(m) {
    return { minElbow: m.elbow, maxSwing: m.swing };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.maxSwing = Math.max(r.maxSwing, m.swing);
  }

  repBlocks(r) {
    return r.maxSwing > this.opts.maxRaise ? ['raise'] : [];
  }

  repDetail(r) {
    return `elbow ${Math.round(r.minElbow)}° at the top`;
  }
}
