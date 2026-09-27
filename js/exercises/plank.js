import { P, vis, toPx, angleFn, Ema, SidePicker, clamp } from '../geometry.js';
import { HoldTimer } from './base.js';

const SIDES = {
  left: { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  right: { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
};

/**
 * Plank hold (forearms or hands), side-on. The timer runs while you're in a
 * supported plank; time with sagging or piked hips doesn't count toward form.
 */
export class PlankAnalyzer extends HoldTimer {
  static defaults = { sagTolerance: 15, pikeTolerance: 20, maxIncline: 30 };
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
