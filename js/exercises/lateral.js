import { P, vis, angleFn, toPx, dist, Ema, FacingTracker } from '../geometry.js';
import { RepCounter } from './base.js';

const ARMS = [
  { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip },
  { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip },
];

/**
 * Lateral raises, facing the camera. Progress is upper-arm abduction (the
 * hip-shoulder-elbow angle) from ~20° at the sides to ~85° at shoulder height.
 *
 * Out to the side, the upper arm stays its full length on screen; raised
 * forward it points at the camera and looks short. Comparing it with its
 * length while hanging catches front raises passed off as lateral raises.
 */
export class LateralRaiseAnalyzer extends RepCounter {
  static defaults = {
    // Arms often rest a little away from the body, so "down" is generous.
    startAt: 0.4,
    finishAt: 0.25,
    restAngle: 20,
    targetAngle: 85,
    maxHigh: 105,
    minElbow: 120,
    maxUneven: 20,
    minSideways: 0.65, // upper arm's on-screen length at the top vs hanging
    overhead: 135, // arms above this (deg) = pressing, not raising
  };
  static statLabels = ['Arms', 'Elbows'];
  static meterLabel = 'height';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Face the camera with your whole upper body in view',
    ready: 'Ready — raise your arms out to the sides',
    going: (pct) => `Raise… ${pct}%`,
    reached: 'Shoulder height — lower slowly',
    notCounted: 'Not counted — raise your arms to shoulder height',
    notCountedVoice: 'Higher',
    incomplete: { rep: 'lower your arms all the way between reps', voice: 'All the way down' },
    faults: {
      forward: { rep: 'arms went forward', miss: 'Not counted — raise your arms out to the sides, not in front', missVoice: 'Out to the sides' },
      overhead: { rep: 'arms went overhead', miss: 'Not counted — raise to shoulder height; overhead is a press', missVoice: 'Shoulder height' },
      high: { live: 'Stop at shoulder height', rep: 'arms went above shoulder height', voice: 'Stop at shoulders', cue: 'Shoulder height' },
      bent: { live: 'Keep your arms almost straight', rep: 'elbows bent too much', voice: 'Straighter arms', cue: 'Straighter arms' },
      uneven: { live: 'Raise both arms evenly', rep: 'arms were uneven', voice: 'Even arms', cue: 'Even arms' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    super.reset();
  }

  resetFilters() {
    this.abdEmas = [new Ema(0.5), new Ema(0.5)];
    this.elbowEmas = [new Ema(0.5), new Ema(0.5)];
    this.restLen = [null, null];
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    if (this.facingT.update(frame) !== 'front') {
      return { status: 'partial', message: 'Face the camera for lateral raises' };
    }
    // The raise happens in the camera's plane (2D), but a bent elbow points the
    // forearm toward the camera, which only shows up in 3D.
    const flat = angleFn(frame, '2d');
    const deep = angleFn(frame, source === 'auto' ? '3d' : source);
    const arms = ARMS.map((a, i) => {
      if ([a.sh, a.el, a.wr, a.hip].some((j) => vis(lm[j]) < 0.5)) return null;
      // Upper-arm abduction (hip-shoulder-elbow): a bent elbow can't fake height.
      const abd = this.abdEmas[i].next(flat(a.el, a.sh, a.hip));
      const len = dist(toPx(lm[a.sh], frame.w, frame.h), toPx(lm[a.el], frame.w, frame.h));
      const p = (abd - o.restAngle) / (o.targetAngle - o.restAngle);
      if (p < 0.25 && this.phase !== 'down') this.restLen[i] = this.restLen[i] == null ? len : this.restLen[i] + 0.2 * (len - this.restLen[i]);
      const sideways = this.restLen[i] ? len / this.restLen[i] : null;
      return { ...a, abd, sideways, elbow: this.elbowEmas[i].next(deep(a.sh, a.el, a.wr)), p };
    });
    const seen = arms.filter(Boolean);
    if (seen.length === 0) return { status: 'partial', message: 'Make sure your arms and hips are in view' };

    const progress = Math.min(...seen.map((a) => a.p));
    const ratios = seen.map((a) => a.sideways).filter((v) => v != null);
    const sideways = ratios.length ? Math.min(...ratios) : null;
    const faults = [];
    if (Math.max(...seen.map((a) => a.abd)) > o.maxHigh) faults.push('high');
    if (progress > 0.3 && Math.min(...seen.map((a) => a.elbow)) < o.minElbow) faults.push('bent');
    if (seen.length === 2 && progress > 0.3 && Math.abs(seen[0].abd - seen[1].abd) > o.maxUneven) faults.push('uneven');

    const ls = lm[P.leftShoulder];
    const rs = lm[P.rightShoulder];
    const overlay = [
      // Shoulder-height guide extended out to the sides.
      { type: 'dash', a: { x: Math.min(ls.x, rs.x) - 0.2, y: (ls.y + rs.y) / 2 }, b: { x: Math.max(ls.x, rs.x) + 0.2, y: (ls.y + rs.y) / 2 }, tone: 'fault:high' },
    ];
    for (const arm of seen) {
      overlay.push(
        { type: 'seg', a: arm.sh, b: arm.el, tone: 'go' },
        { type: 'seg', a: arm.el, b: arm.wr, tone: 'fault:bent' },
        { type: 'arc', a: arm.hip, b: arm.sh, c: arm.el, tone: 'go', label: `${Math.round(arm.abd)}°` },
        { type: 'dots', ids: [arm.sh, arm.el, arm.wr], tone: 'go' },
      );
    }
    return {
      status: 'active',
      progress,
      faults,
      sideways,
      maxAbd: Math.max(...seen.map((a) => a.abd)),
      stats: [
        { label: 'Arms', value: seen.map((a) => `${Math.round(a.abd)}°`).join(' / '), fault: 'high|uneven' },
        { label: 'Elbows', value: seen.map((a) => `${Math.round(a.elbow)}°`).join(' / '), fault: 'bent' },
      ],
      overlay,
    };
  }

  repState(m) {
    return { sideways: null, maxAbd: m.maxAbd };
  }

  trackRep(r, m, p) {
    // Judge the arm near the top of the raise, where forward vs sideways differ most.
    if (p > 0.6 && m.sideways != null) r.sideways = Math.min(r.sideways ?? Infinity, m.sideways);
    r.maxAbd = Math.max(r.maxAbd, m.maxAbd);
  }

  repBlocks(r) {
    const out = [];
    if (r.sideways != null && r.sideways < this.opts.minSideways) out.push('forward');
    if (r.maxAbd > this.opts.overhead) out.push('overhead');
    return out;
  }
}
