import { P, vis, toPx, angleFn, Ema, FacingTracker, clamp } from '../geometry.js';
import { RepCounter } from './base.js';

const NEEDED = [
  P.leftShoulder, P.rightShoulder, P.leftWrist, P.rightWrist,
  P.leftHip, P.rightHip, P.leftAnkle, P.rightAnkle,
];

/**
 * Jumping jacks, facing the camera. Progress averages how far the arms are
 * raised (hands overhead = 1) and how wide the feet are (≈2.8 hip widths = 1).
 */
export class JacksAnalyzer extends RepCounter {
  static defaults = {
    countAt: 0.85,
    minRepMs: 250,
    armsFrom: 30, // arm angle (deg from the torso) that counts as "down"
    armsTo: 150, // ...and as "overhead"
    feetFrom: 1.3, // ankle spread in hip widths
    feetTo: 2.8,
  };
  static statLabels = ['Arms', 'Feet'];
  static meterLabel = 'spread';
  static tempo = ['out ', ' in '];
  static text = {
    noPerson: 'Face the camera with your whole body in view',
    ready: 'Ready — start jumping!',
    going: (pct) => `Out… ${pct}%`,
    reached: 'Nice and wide!',
    notCounted: 'Not counted — hands overhead and feet wide',
    notCountedVoice: 'Bigger',
    incomplete: { rep: 'bring your hands and feet all the way back in', voice: 'All the way in' },
    faults: {
      arms: { rep: 'hands didn’t go overhead', voice: 'Hands up' },
      legs: { rep: 'feet weren’t wide enough', voice: 'Wider' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    super.reset();
  }

  resetFilters() {
    this.armEma = new Ema(0.6);
    this.legEma = new Ema(0.6);
  }

  measure(frame) {
    const o = this.opts;
    const { lm } = frame;
    if (NEEDED.some((i) => vis(lm[i]) < 0.5)) return { status: 'partial', message: 'Move back so your hands and feet stay in frame' };
    if (this.facingT.update(frame) !== 'front') return { status: 'partial', message: 'Face the camera for jumping jacks' };

    const angle = angleFn(frame, '2d');
    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const arms = Math.min(angle(P.leftWrist, P.leftShoulder, P.leftHip), angle(P.rightWrist, P.rightShoulder, P.rightHip));
    const hipW = Math.abs(px(P.leftHip).x - px(P.rightHip).x) || 1;
    const spread = Math.abs(px(P.leftAnkle).x - px(P.rightAnkle).x) / hipW;
    const armP = this.armEma.next(clamp((arms - o.armsFrom) / (o.armsTo - o.armsFrom), 0, 1.2));
    const legP = this.legEma.next(clamp((spread - o.feetFrom) / (o.feetTo - o.feetFrom), 0, 1.2));

    const overlay = [];
    for (const [a, b, c] of [
      [P.leftShoulder, P.leftElbow, P.leftWrist],
      [P.rightShoulder, P.rightElbow, P.rightWrist],
      [P.leftHip, P.leftKnee, P.leftAnkle],
      [P.rightHip, P.rightKnee, P.rightAnkle],
    ]) {
      overlay.push({ type: 'seg', a, b, tone: 'go' }, { type: 'seg', a: b, b: c, tone: 'go' }, { type: 'dots', ids: [c], tone: 'go' });
    }
    return {
      status: 'active',
      progress: (armP + legP) / 2,
      armP,
      legP,
      stats: [
        { label: 'Arms', value: `${Math.round(Math.min(armP, 1) * 100)}%` },
        { label: 'Feet', value: `${Math.round(Math.min(legP, 1) * 100)}%` },
      ],
      overlay,
    };
  }

  repState(m) {
    return { armMax: m.armP, legMax: m.legP };
  }

  trackRep(r, m) {
    r.armMax = Math.max(r.armMax, m.armP);
    r.legMax = Math.max(r.legMax, m.legP);
  }

  repIssues(r) {
    const out = [];
    if (r.armMax < 0.8) out.push('arms');
    if (r.legMax < 0.7) out.push('legs');
    return out;
  }

  repDetail(r) {
    return `arms ${Math.round(Math.min(r.armMax, 1) * 100)}%, feet ${Math.round(Math.min(r.legMax, 1) * 100)}%`;
  }
}
