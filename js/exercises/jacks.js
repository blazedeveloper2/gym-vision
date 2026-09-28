import { P, vis, toPx, angleFn, Ema, FacingTracker, clamp, mid, dist } from '../geometry.js';
import { RepCounter } from './base.js';

const NEEDED = [
  P.leftShoulder, P.rightShoulder, P.leftWrist, P.rightWrist,
  P.leftHip, P.rightHip, P.leftAnkle, P.rightAnkle,
];
const FEET = {
  l: [P.leftAnkle, P.leftHeel, P.leftFoot],
  r: [P.rightAnkle, P.rightHeel, P.rightFoot],
};

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/**
 * Jumping jacks, facing the camera. Arms (hands overhead = 1) and feet
 * (≈2.8 hip widths apart = 1) are scored separately and progress is the
 * smaller of the two, so very wide feet can't make up for lazy arms.
 *
 * A rep also has to be a jump: both feet must leave the floor at the same
 * time. The floor is where the feet usually are over the last two seconds;
 * stepping one foot out at a time (or just sliding the feet) never lifts
 * both, so it doesn't count.
 */
export class JacksAnalyzer extends RepCounter {
  static defaults = {
    countAt: 0.85,
    minRepMs: 400,
    armsFrom: 30, // arm angle (deg from the torso) that counts as "down"
    armsTo: 150, // ...and as "overhead"
    feetFrom: 1.3, // ankle spread in hip widths
    feetTo: 2.8,
    minAir: 0.06, // both feet off the floor by this much (torso lengths)
    airMemoryMs: 700, // a take-off just before the rep starts still counts
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
      jump: { rep: 'feet never left the floor', miss: 'Not counted — jump! Both feet have to leave the floor', missVoice: 'Jump' },
      arms: { rep: 'hands didn’t go overhead', voice: 'Hands up', miss: 'Not counted — get your hands all the way overhead', missVoice: 'Hands up' },
      legs: { rep: 'feet weren’t wide enough', voice: 'Wider', miss: 'Not counted — jump your feet wider', missVoice: 'Wider' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    super.reset();
  }

  resetFilters() {
    this.armEma = new Ema(0.6);
    this.legEma = new Ema(0.6);
    this.feet = []; // {t, l, r}: lowest point of each foot (px)
    this.airLog = []; // {t, air}
    this.prevLift = null;
  }

  /** How far both feet are off the floor right now, in torso lengths. */
  airborne(frame, torso) {
    const { lm, t } = frame;
    const low = (ids) => Math.max(...ids.filter((i) => vis(lm[i]) >= 0.3).map((i) => lm[i].y * frame.h));
    if (this.feet.length && t < this.feet[this.feet.length - 1].t) this.feet.length = 0; // seeked back
    this.feet.push({ t, l: low(FEET.l), r: low(FEET.r) });
    while (this.feet[0].t < t - 2000) this.feet.shift();
    const now = this.feet[this.feet.length - 1];
    // Feet are on the floor most of the time, so it's a high quantile of their height.
    const lift = Math.min(
      quantile(this.feet.map((f) => f.l), 0.85) - now.l,
      quantile(this.feet.map((f) => f.r), 0.85) - now.r,
    ) / torso;
    // Two frames in a row, so one jittery frame can't fake a jump.
    const air = this.feet.length < 8 ? 0 : Math.min(lift, this.prevLift ?? lift);
    this.prevLift = lift;
    this.airLog.push({ t, air });
    while (this.airLog[0].t < t - this.opts.airMemoryMs) this.airLog.shift();
    return air;
  }

  recentAir() {
    return this.airLog.reduce((m, a) => Math.max(m, a.air), 0);
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
    const torso = dist(mid(px(P.leftShoulder), px(P.rightShoulder)), mid(px(P.leftHip), px(P.rightHip))) || 1;
    const air = this.airborne(frame, torso);

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
      progress: Math.min(armP, legP),
      armP,
      legP,
      air,
      stats: [
        { label: 'Arms', value: `${Math.round(Math.min(armP, 1) * 100)}%` },
        { label: 'Feet', value: `${Math.round(Math.min(legP, 1) * 100)}%` },
      ],
      overlay,
    };
  }

  /** Both arms and both feet have to come back in. */
  canFinish(m) {
    return Math.max(m.armP, m.legP) < 0.35;
  }

  repState(m) {
    return { armMax: m.armP, legMax: m.legP, air: Math.max(m.air, this.recentAir()) };
  }

  trackRep(r, m) {
    r.armMax = Math.max(r.armMax, m.armP);
    r.legMax = Math.max(r.legMax, m.legP);
    r.air = Math.max(r.air, m.air);
  }

  repBlocks(r) {
    return r.air < this.opts.minAir ? ['jump'] : [];
  }

  repIssues(r) {
    const out = [];
    if (r.armMax < 0.85) out.push('arms');
    if (r.legMax < 0.85) out.push('legs');
    return out;
  }

  repDetail(r) {
    return `arms ${Math.round(Math.min(r.armMax, 1) * 100)}%, feet ${Math.round(Math.min(r.legMax, 1) * 100)}%, jump ${Math.round(r.air * 100)}%`;
  }
}
