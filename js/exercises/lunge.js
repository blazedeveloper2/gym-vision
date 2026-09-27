import { P, vis, toPx, angleFn, Ema, FacingTracker, mid, leanDeg } from '../geometry.js';
import { RepCounter } from './base.js';

const LEGS = [
  { hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  { hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
];
const NEEDED = [P.leftHip, P.rightHip, P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle];

/**
 * Lunges (forward, reverse or walking). Progress follows the more bent knee
 * from standing (~170°) down to about 90°; side-on it also watches torso lean.
 */
export class LungeAnalyzer extends RepCounter {
  static defaults = {
    standAngle: 170,
    targetAngle: 95,
    maxLean: 30,
    minRepMs: 500,
  };
  static statLabels = ['Front knee', 'Lean'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Step into view, side-on, with room to step forward',
    ready: 'Ready — step into a lunge',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Depth reached — drive back up!',
    notCounted: 'Not counted — lower until your front knee is at about 90°',
    notCountedVoice: 'Go lower',
    incomplete: { rep: 'stand all the way up between reps', voice: 'Stand tall' },
    faults: {
      lean: { live: 'Keep your chest up — torso is leaning forward', rep: 'torso leaned forward', voice: 'Chest up', cue: 'Chest up' },
    },
  };

  get countAt() {
    const o = this.opts;
    return 1 - 5 / (o.standAngle - o.targetAngle);
  }

  reset() {
    this.facingT = new FacingTracker();
    super.reset();
  }

  resetFilters() {
    this.kneeEmas = [new Ema(0.5), new Ema(0.5)];
    this.leanEma = new Ema(0.4);
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    if (NEEDED.some((i) => vis(lm[i]) < 0.4) || Math.max(vis(lm[P.leftShoulder]), vis(lm[P.rightShoulder])) < 0.5) {
      return { status: 'partial', message: 'Move back so I can see you from shoulders to feet' };
    }
    const front = this.facingT.update(frame) === 'front';
    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const sh = mid(px(P.leftShoulder), px(P.rightShoulder));
    const hip = mid(px(P.leftHip), px(P.rightHip));
    const leanNow = leanDeg(sh, hip);
    if (leanNow > 60) return { status: 'setup', message: 'Stand up tall to start' };

    const angle = angleFn(frame, source === 'auto' ? (front ? '3d' : '2d') : source);
    const knees = LEGS.map((l, i) => this.kneeEmas[i].next(angle(l.hip, l.knee, l.ank)));
    const f = knees[0] <= knees[1] ? 0 : 1; // front leg = the more bent knee
    const kneeAngle = knees[f];
    const lean = this.leanEma.next(leanNow);
    const progress = (o.standAngle - kneeAngle) / (o.standAngle - o.targetAngle);

    const faults = [];
    if (!front && progress > 0.4 && lean > o.maxLean) faults.push('lean');

    const F = LEGS[f];
    const B = LEGS[1 - f];
    const k = Math.round(kneeAngle);
    return {
      status: 'active',
      progress,
      faults,
      kneeAngle,
      stats: [
        { label: 'Front knee', value: `${k}°` },
        { label: 'Lean', value: `${Math.round(lean)}°`, fault: 'lean' },
      ],
      overlay: [
        { type: 'seg', a: mid(lm[P.leftShoulder], lm[P.rightShoulder]), b: mid(lm[P.leftHip], lm[P.rightHip]), tone: 'fault:lean', w: 5 },
        { type: 'seg', a: B.hip, b: B.knee, tone: 'neutral', w: 5 },
        { type: 'seg', a: B.knee, b: B.ank, tone: 'neutral', w: 5 },
        { type: 'seg', a: F.hip, b: F.knee, tone: 'go' },
        { type: 'seg', a: F.knee, b: F.ank, tone: 'go' },
        { type: 'arc', a: F.hip, b: F.knee, c: F.ank, tone: 'go', label: `${k}°` },
        { type: 'dots', ids: [F.hip, F.knee, F.ank], tone: 'go' },
      ],
    };
  }

  repState(m) {
    return { minKnee: m.kneeAngle };
  }

  trackRep(r, m) {
    r.minKnee = Math.min(r.minKnee, m.kneeAngle);
  }

  repDetail(r) {
    return `front knee ${Math.round(r.minKnee)}°`;
  }
}
