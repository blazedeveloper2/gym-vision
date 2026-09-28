import { P, vis, toPx, angleFn, Ema, SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';

const SIDES = {
  left: { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  right: { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
};

/**
 * Push-ups, filmed side-on.
 *
 * Progress comes from the elbow angle (160° = arms straight, `depthTarget` =
 * full depth). Body line is the shoulder-hip-ankle angle; the hip's side of the
 * shoulder→ankle line tells a sag from a pike.
 *
 * A straight elbow alone doesn't finish a rep: the shoulders must also have
 * risen back up (shoulder height above the wrist, in arm lengths). Otherwise
 * moving the hands while lying at the bottom (hand-release push-ups) would
 * count as extra reps.
 */
export class PushupAnalyzer extends RepCounter {
  static defaults = {
    depthTarget: 90, // elbow angle (deg) that counts as full depth
    depthTolerance: 5,
    topAngle: 160, // elbow angle treated as "arms straight"
    sagTolerance: 18,
    pikeTolerance: 22,
    maxIncline: 45, // body steeper than this = not in a push-up position
    riseFraction: 0.6, // shoulders must climb back this share of the way up
    dropShare: 0.5, // shoulders must come down at least this share of what the target elbow angle implies
    bounce: 0.5,
  };
  static statLabels = ['Elbow', 'Body'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Step into view, side-on to the camera',
    ready: 'Ready — lower your chest to start',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Depth reached — push up!',
    notCounted: 'Not counted — go lower (elbows to about 90°)',
    notCountedVoice: 'Go lower',
    incomplete: { rep: 'straighten your arms at the top', voice: 'Lock out' },
    faults: {
      drop: { rep: 'chest didn’t go down', miss: 'Not counted — lower your whole body, not just your elbows', missVoice: 'Chest down' },
      sag: { live: 'Hips sagging — squeeze your glutes and brace', rep: 'hips sagged, keep one straight line', voice: 'Keep your hips up', cue: 'Tighten your core' },
      pike: { live: 'Hips too high — lower them into a straight line', rep: 'hips were too high', voice: 'Lower your hips', cue: 'Hips down' },
    },
  };

  get countAt() {
    const o = this.opts;
    return 1 - o.depthTolerance / (o.topAngle - o.depthTarget);
  }

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  resetFilters() {
    this.elbowEma = new Ema(0.5);
    this.bodyEma = new Ema(0.35);
    this.heightEma = new Ema(0.5);
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    const score = (s) =>
      vis(lm[s.sh]) + vis(lm[s.el]) + vis(lm[s.wr]) + vis(lm[s.hip]) + 0.5 * Math.max(vis(lm[s.ank]), vis(lm[s.knee]));
    const before = this.sides.value;
    const side = this.sides.update(score(SIDES.left), score(SIDES.right));
    if (before && before !== side) this.resetFilters();
    const S = SIDES[side];
    const foot = vis(lm[S.ank]) >= 0.4 ? S.ank : vis(lm[S.knee]) >= 0.4 ? S.knee : null;

    if ([S.sh, S.el, S.wr, S.hip].some((i) => vis(lm[i]) < 0.5)) {
      return { status: 'partial', message: 'Turn side-on so I can see your arm and hip' };
    }
    if (foot == null) return { status: 'partial', message: 'Move back so your whole body is in frame' };

    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const sh = px(S.sh), el = px(S.el), wr = px(S.wr), hip = px(S.hip), ft = px(foot);
    const dx = ft.x - sh.x;
    const dy = ft.y - sh.y;
    if ((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI > o.maxIncline) {
      return { status: 'setup', message: 'Get into a plank: hands under shoulders, body straight' };
    }

    const angle = angleFn(frame, source === 'auto' ? '2d' : source);
    const elbow = this.elbowEma.next(angle(S.sh, S.el, S.wr));
    const bodyAngle = this.bodyEma.next(angle(S.sh, S.hip, foot));
    const bend = 180 - bodyAngle;
    // Shoulder height above the wrist in arm lengths: ≈1 with straight arms,
    // ≈0.4 at the bottom, near 0 if the hands come off the floor.
    const arm = Math.hypot(el.x - sh.x, el.y - sh.y) + Math.hypot(wr.x - el.x, wr.y - el.y) || 1;
    const height = this.heightEma.next((wr.y - sh.y) / arm);

    const k = ((hip.x - sh.x) * dx + (hip.y - sh.y) * dy) / (dx * dx + dy * dy);
    const hipBelow = hip.y > sh.y + k * dy;
    const faults = [];
    if (hipBelow && bend > o.sagTolerance) faults.push('sag');
    else if (!hipBelow && bend > o.pikeTolerance) faults.push('pike');

    const e = Math.round(elbow);
    return {
      status: 'active',
      progress: (o.topAngle - elbow) / (o.topAngle - o.depthTarget),
      faults,
      height,
      shoulderY: sh.y,
      arm,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Body', value: `${Math.round(bodyAngle)}°`, fault: 'sag|pike' },
      ],
      overlay: [
        { type: 'dash', a: S.sh, b: foot, tone: 'neutral' },
        { type: 'seg', a: S.sh, b: S.hip, tone: 'fault:sag|pike', w: 5 },
        { type: 'seg', a: S.hip, b: foot, tone: 'fault:sag|pike', w: 5 },
        { type: 'seg', a: S.sh, b: S.el, tone: 'go' },
        { type: 'seg', a: S.el, b: S.wr, tone: 'go' },
        { type: 'arc', a: S.sh, b: S.el, c: S.wr, tone: 'go', label: `${e}°` },
        { type: 'angleLabel', a: S.sh, b: S.hip, c: foot, text: `${Math.round(bodyAngle)}°`, tone: 'fault:sag|pike', size: 12 },
        { type: 'dots', ids: [S.sh, S.el, S.wr], tone: 'go' },
        { type: 'dots', ids: [S.hip, foot], tone: 'fault:sag|pike' },
      ],
    };
  }

  repState(m, prev) {
    const start = prev ? prev.backM : m;
    return { startHeight: start.height, minHeight: m.height, topY: start.shoulderY, lowY: m.shoulderY, arm: m.arm };
  }

  trackRep(r, m) {
    r.minHeight = Math.min(r.minHeight, m.height);
    r.topY = Math.min(r.topY, m.shoulderY);
    r.lowY = Math.max(r.lowY, m.shoulderY);
    r.arm = Math.max(r.arm, m.arm);
  }

  repBlocks(r) {
    // Bending the elbows alone (shoulders staying up) isn't a push-up. With the
    // shoulder over the hand, its height is ≈ sin(elbow / 2) arm lengths, so
    // the target angle says how far the shoulders should travel down.
    const o = this.opts;
    const expected = Math.sin((o.topAngle * Math.PI) / 360) - Math.sin((o.depthTarget * Math.PI) / 360);
    return (r.lowY - r.topY) / r.arm < o.dropShare * expected ? ['drop'] : [];
  }

  canFinish(m, r) {
    return m.height - r.minHeight >= this.opts.riseFraction * Math.max(0.15, r.startHeight - r.minHeight);
  }

  repDetail(r) {
    const o = this.opts;
    return `elbow ${Math.round(o.topAngle - r.max * (o.topAngle - o.depthTarget))}°`;
  }
}
