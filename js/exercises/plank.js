import { P, vis, toPx, angleFn, Ema, SidePicker, clamp } from '../geometry.js';
import { HoldTimer } from './base.js';

const SIDES = {
  left: { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle, heel: P.leftHeel, toe: P.leftFoot },
  right: { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle, heel: P.rightHeel, toe: P.rightFoot },
};

/**
 * Plank hold (forearms or hands), side-on. The timer runs while you're in a
 * supported plank; time with sagging or piked hips doesn't count toward form.
 *
 * It pauses when the plank isn't real: hips resting on the floor (measured
 * above the floor line through the hands/elbows and the feet) or knees down.
 */
export class PlankAnalyzer extends HoldTimer {
  static defaults = {
    sagTolerance: 15,
    pikeTolerance: 20,
    maxIncline: 30,
    minHipHeight: 0.18, // hips above the floor, in torso lengths (lying down ≈ 0.1–0.15)
    minKnee: 145, // straighter than this, or you're on your knees
  };
  static statLabels = ['Body'];
  static meterLabel = 'body line';
  static text = {
    noPerson: 'Step into view, side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      sag: { live: 'Hips sagging — squeeze your glutes', cue: 'Hips up' },
      pike: { live: 'Hips too high — flatten your back', cue: 'Hips down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  resetFilters() {
    this.bodyEma = new Ema(0.35);
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    const score = (s) => vis(lm[s.sh]) + vis(lm[s.hip]) + Math.max(vis(lm[s.el]), vis(lm[s.wr])) + Math.max(vis(lm[s.ank]), vis(lm[s.knee]));
    const S = SIDES[this.sides.update(score(SIDES.left), score(SIDES.right))];
    const foot = vis(lm[S.ank]) >= 0.4 ? S.ank : vis(lm[S.knee]) >= 0.4 ? S.knee : null;
    if (vis(lm[S.sh]) < 0.5 || vis(lm[S.hip]) < 0.5 || foot == null) {
      return { status: 'partial', message: 'Turn side-on with your whole body in frame' };
    }
    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const sh = px(S.sh), hip = px(S.hip), ft = px(foot);
    const dx = ft.x - sh.x;
    const dy = ft.y - sh.y;
    const incline = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
    // Supported: elbows or hands clearly below the shoulders (not lying flat).
    const support = Math.max(vis(lm[S.el]) >= 0.4 ? px(S.el).y : -Infinity, vis(lm[S.wr]) >= 0.4 ? px(S.wr).y : -Infinity) - sh.y;
    const torso = Math.hypot(hip.x - sh.x, hip.y - sh.y) || 1;
    if (incline > o.maxIncline || support < 0.25 * torso) {
      return { status: 'setup', message: 'Get into a plank — forearms or hands on the floor' };
    }

    // Floor line: from the lowest hand/elbow to the lowest point of the foot.
    const lowest = (ids) => ids.filter((i) => vis(lm[i]) >= 0.4).reduce((b, i) => (!b || px(i).y > b.y ? px(i) : b), null);
    const hand = lowest([S.el, S.wr]);
    const toe = lowest([S.ank, S.heel, S.toe]) || ft;
    if (hand && toe && Math.abs(toe.x - hand.x) > 1) {
      const floorY = hand.y + ((hip.x - hand.x) * (toe.y - hand.y)) / (toe.x - hand.x);
      if ((floorY - hip.y) / torso < o.minHipHeight) return { status: 'setup', message: 'Lift your hips off the floor — timer paused' };
    }
    if (foot === S.ank && vis(lm[S.knee]) >= 0.4) {
      const knee = angleFn(frame, '2d')(S.hip, S.knee, S.ank);
      if (knee < o.minKnee) return { status: 'setup', message: 'Knees off the floor, legs straight — timer paused' };
    }

    const bodyAngle = this.bodyEma.next(angleFn(frame, source === 'auto' ? '2d' : source)(S.sh, S.hip, foot));
    const bend = 180 - bodyAngle;
    const k = ((hip.x - sh.x) * dx + (hip.y - sh.y) * dy) / (dx * dx + dy * dy);
    const hipBelow = hip.y > sh.y + k * dy;
    const faults = [];
    if (hipBelow && bend > o.sagTolerance) faults.push('sag');
    else if (!hipBelow && bend > o.pikeTolerance) faults.push('pike');

    return {
      status: 'active',
      progress: clamp(1 - bend / 30, 0, 1),
      faults,
      stats: [{ label: 'Body', value: `${Math.round(bodyAngle)}°`, fault: 'sag|pike' }],
      overlay: [
        { type: 'dash', a: S.sh, b: foot, tone: 'neutral' },
        { type: 'seg', a: S.sh, b: S.hip, tone: 'fault:sag|pike', w: 6 },
        { type: 'seg', a: S.hip, b: foot, tone: 'fault:sag|pike', w: 6 },
        { type: 'dots', ids: [S.sh, S.hip, foot], tone: 'fault:sag|pike' },
        { type: 'angleLabel', a: S.sh, b: S.hip, c: foot, text: `${Math.round(bodyAngle)}°`, tone: 'fault:sag|pike', size: 14 },
      ],
    };
  }
}
