import { P, vis, toPx, angleFn, Ema, SidePicker, FacingTracker, mid, leanDeg } from '../geometry.js';
import { RepCounter } from './base.js';

const SIDES = {
  left: { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  right: { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
};
const FRONT_NEEDED = [
  P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip,
  P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle,
];

// Hip depth: 0 standing, 1 = hips level with the knees (parallel).
// `knee`: the knee must also bend at least this far (deg), so tilting or
// shifting the hips can't fake depth.
export const SQUAT_TARGETS = {
  half: { value: 0.6, knee: 145, label: 'Half squat' },
  parallel: { value: 1.0, knee: 125, label: 'Parallel' },
  deep: { value: 1.15, knee: 115, label: 'Below parallel' },
};

/**
 * Squats, side-on (depth + torso lean) or facing the camera (depth + knees
 * caving in). Depth compares hip height to knee height, scaled by thigh
 * length learned while standing, so it reads the same from either angle.
 *
 * `hold` adds the checks for where the weight is, side-on: 'front' (a bar in
 * the front rack — the elbows stay up) or 'goblet' (a dumbbell held against
 * the chest).
 */
export class SquatAnalyzer extends RepCounter {
  static defaults = {
    depthTarget: 'parallel',
    depthTolerance: 0.05,
    checkFrom: 0.4, // only judge form this deep (in hip-depth units)
    maxLean: 50, // side view: torso lean from vertical (deg)
    valgusRatio: 0.85, // front view: knee width / ankle width below this = knees caving in
    holdMs: 300,
    minRepMs: 500,
    hold: null, // null | 'front' | 'goblet'
    elbowDrop: 35, // front rack: upper arm below horizontal (deg)
    driftBy: 0.6, // goblet: hands this far in front of the torso line (torso lengths)
  };
  static statLabels = ['Knee', 'Lean'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Step into view, about 2–3 m from the camera',
    ready: 'Ready — squat down to start',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Depth reached — drive up!',
    notCounted: 'Not counted — squat deeper (hips down to knee height)',
    notCountedVoice: 'Go deeper',
    incomplete: { rep: 'stand all the way up between reps', voice: 'Stand tall' },
    faults: {
      bend: { rep: 'knees barely bent', miss: 'Not counted — bend your knees and sit down into it', missVoice: 'Bend your knees' },
      lean: { live: 'Chest up — you’re leaning too far forward', rep: 'chest dropped forward', voice: 'Chest up', cue: 'Chest up' },
      knees: { live: 'Push your knees out over your toes', rep: 'knees caved in', voice: 'Knees out', cue: 'Knees out' },
      elbows: { live: 'Elbows up — keep the bar high on your shoulders', rep: 'elbows dropped', voice: 'Elbows up', cue: 'Elbows up' },
      drift: { live: 'Keep the dumbbell tight against your chest', rep: 'dumbbell drifted forward', voice: 'Weight to your chest', cue: 'Weight to your chest' },
    },
  };

  get targetInfo() {
    return SQUAT_TARGETS[this.opts.depthTarget] || SQUAT_TARGETS.parallel;
  }

  get target() {
    return this.targetInfo.value;
  }

  get countAt() {
    return 1 - this.opts.depthTolerance / this.target;
  }

  get facing() {
    return this.facingT.value;
  }

  reset() {
    this.sides = new SidePicker();
    this.facingT = new FacingTracker();
    this.thighRef = null;
    super.reset();
  }

  resetFilters() {
    this.depthEma = new Ema(0.5);
    this.kneeEma = new Ema(0.5);
    this.leanEma = new Ema(0.4);
    this.widthEma = new Ema(0.4);
  }

  measure(frame, source) {
    const o = this.opts;
    const { lm } = frame;
    const before = this.facingT.value;
    const facing = this.facingT.update(frame);
    if (before && before !== facing) {
      this.widthEma.reset();
      this.kneeEma.reset();
    }
    const front = facing === 'front';
    const score = (s) => vis(lm[s.sh]) + vis(lm[s.hip]) + vis(lm[s.knee]) + vis(lm[s.ank]);
    const S = SIDES[this.sides.update(score(SIDES.left), score(SIDES.right))];

    if ((front ? FRONT_NEEDED : [S.sh, S.hip, S.knee, S.ank]).some((i) => vis(lm[i]) < 0.5)) {
      return { status: 'partial', message: 'Move back so I can see you from shoulders to feet' };
    }

    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const both = (a, b) => mid(px(a), px(b));
    const sh = front ? both(P.leftShoulder, P.rightShoulder) : px(S.sh);
    const hip = front ? both(P.leftHip, P.rightHip) : px(S.hip);
    const knee = front ? both(P.leftKnee, P.rightKnee) : px(S.knee);

    const leanNow = leanDeg(sh, hip);
    if (leanNow > 75) return { status: 'setup', message: 'Stand up tall to start' };

    // Thigh length in the image, learned while standing (thigh near vertical).
    const thigh = Math.hypot(hip.x - knee.x, hip.y - knee.y) || 1;
    if (this.thighRef == null) this.thighRef = thigh;
    else if (this.phase !== 'down' && (knee.y - hip.y) / thigh > 0.85) this.thighRef += 0.1 * (thigh - this.thighRef);
    const depth = this.depthEma.next(1 + (hip.y - knee.y) / this.thighRef);

    const src = source === 'auto' ? (front ? '3d' : '2d') : source;
    const angle = angleFn(frame, src);
    // Facing the camera, the knee angle only means something in 3D.
    const kneeTrusted = !front || (src === '3d' && !!frame.world);
    const kneeAngle = this.kneeEma.next(
      front
        ? (angle(P.leftHip, P.leftKnee, P.leftAnkle) + angle(P.rightHip, P.rightKnee, P.rightAnkle)) / 2
        : angle(S.hip, S.knee, S.ank),
    );
    const lean = this.leanEma.next(leanNow);
    let kneeWidth = null;
    if (front) {
      const kw = Math.abs(px(P.leftKnee).x - px(P.rightKnee).x);
      const aw = Math.abs(px(P.leftAnkle).x - px(P.rightAnkle).x) || 1;
      kneeWidth = this.widthEma.next(kw / aw);
    }

    const faults = [];
    if (depth >= o.checkFrom) {
      if (!front && lean > o.maxLean) faults.push('lean');
      else if (front && kneeWidth < o.valgusRatio) faults.push('knees');
    }
    if (!front && o.hold === 'front' && vis(lm[S.el]) >= 0.5) {
      const el = px(S.el), s0 = px(S.sh);
      if ((Math.atan2(el.y - s0.y, Math.abs(el.x - s0.x)) * 180) / Math.PI > o.elbowDrop) faults.push('elbows');
    }
    if (!front && o.hold === 'goblet' && vis(lm[S.wr]) >= 0.5) {
      // Hands' distance in front of the hip–shoulder line.
      const wr = px(S.wr), s0 = px(S.sh), h0 = px(S.hip);
      const tl = Math.hypot(s0.x - h0.x, s0.y - h0.y) || 1;
      const off = Math.abs((s0.x - h0.x) * (wr.y - h0.y) - (s0.y - h0.y) * (wr.x - h0.x)) / tl;
      if (off / tl > o.driftBy) faults.push('drift');
    }

    const k = Math.round(kneeAngle);
    const overlay = front
      ? [
          { type: 'dash', a: P.leftKnee, b: P.rightKnee, tone: 'fault:knees', w: 2.5 },
          { type: 'dash', a: P.leftAnkle, b: P.rightAnkle, tone: 'neutral', w: 2.5 },
          ...[[P.leftHip, P.leftKnee, P.leftAnkle], [P.rightHip, P.rightKnee, P.rightAnkle]].flatMap(([h, kn, a]) => [
            { type: 'seg', a: h, b: kn, tone: 'go' },
            { type: 'seg', a: kn, b: a, tone: 'go' },
            { type: 'dots', ids: [h, a], tone: 'go' },
            { type: 'dots', ids: [kn], tone: 'fault:knees' },
          ]),
          { type: 'label', at: mid(lm[P.leftKnee], lm[P.rightKnee]), text: `${k}°`, tone: 'go', size: 15 },
        ]
      : [
          // Horizontal "parallel" line through the knee: hips below it = below parallel.
          { type: 'dash', a: { x: lm[S.knee].x - 0.15, y: lm[S.knee].y }, b: { x: lm[S.knee].x + 0.15, y: lm[S.knee].y }, tone: 'neutral' },
          { type: 'seg', a: S.sh, b: S.hip, tone: 'fault:lean', w: 5 },
          { type: 'seg', a: S.hip, b: S.knee, tone: 'go' },
          { type: 'seg', a: S.knee, b: S.ank, tone: 'go' },
          { type: 'arc', a: S.hip, b: S.knee, c: S.ank, tone: 'go', label: `${k}°` },
          { type: 'dots', ids: [S.hip, S.knee, S.ank], tone: 'go' },
          { type: 'dots', ids: [S.sh], tone: 'fault:lean' },
          { type: 'label', at: mid(lm[S.sh], lm[S.hip]), text: `lean ${Math.round(lean)}°`, tone: 'fault:lean', size: 12 },
        ];

    return {
      status: 'active',
      progress: depth / this.target,
      faults,
      kneeAngle,
      kneeTrusted,
      stats: [
        { label: 'Knee', value: `${k}°` },
        front
          ? { label: 'Knee width', value: `${Math.round(kneeWidth * 100)}%`, fault: 'knees' }
          : { label: 'Lean', value: `${Math.round(lean)}°`, fault: 'lean' },
      ],
      overlay,
    };
  }

  repState(m) {
    return { minKnee: m.kneeAngle, kneeTrusted: m.kneeTrusted };
  }

  trackRep(r, m) {
    r.minKnee = Math.min(r.minKnee, m.kneeAngle);
    r.kneeTrusted &&= m.kneeTrusted;
  }

  repBlocks(r) {
    return r.kneeTrusted && r.minKnee > this.targetInfo.knee ? ['bend'] : [];
  }

  repDetail(r) {
    return `depth ${Math.round(r.max * 100)}%, knee ${Math.round(r.minKnee)}°`;
  }
}
