import { P, vis, clamp, toPx, angleFn, Ema } from '../geometry.js';

const SIDES = {
  left: { sh: P.leftShoulder, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  right: { sh: P.rightShoulder, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
};
const FRONT_NEEDED = [
  P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip,
  P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle,
];

// Depth is "progress": 0 standing, 1 = hips level with the knees (parallel).
export const SQUAT_TARGETS = {
  half: { value: 0.6, label: 'Half squat' },
  parallel: { value: 1.0, label: 'Parallel' },
  deep: { value: 1.15, label: 'Below parallel' },
};

export const SQUAT_DEFAULTS = {
  depthTarget: 'parallel',
  depthTolerance: 0.05,
  startDepth: 0.3, // going past this starts a rep
  finishDepth: 0.15, // coming back above this finishes it
  checkFrom: 0.4, // only judge form once this deep
  maxLean: 50, // side view: torso lean from vertical (deg)
  valgusRatio: 0.85, // front view: knee width / ankle width below this = knees caving in
  holdMs: 300,
  minRepMs: 500,
};

/**
 * Squat rep counter and form checker. Works side-on (depth + torso lean) or
 * facing the camera (depth + knees caving in).
 *
 * Depth compares hip height to knee height, scaled by thigh length measured
 * while standing, so it reads the same from the side or the front.
 */
export class SquatAnalyzer {
  constructor(options = {}) {
    this.opts = { ...SQUAT_DEFAULTS, ...options };
    this.statLabels = ['Knee', 'Lean'];
    this.reset();
  }

  setOptions(options) {
    Object.assign(this.opts, options);
  }

  get target() {
    return (SQUAT_TARGETS[this.opts.depthTarget] || SQUAT_TARGETS.parallel).value;
  }

  reset() {
    this.count = 0;
    this.clean = 0;
    this.partials = 0;
    this.log = [];
    this.phase = 'setup';
    this.rep = null;
    this.side = null;
    this.facing = null; // 'side' | 'front'
    this.thighRef = null;
    this.depthEma = new Ema(0.5);
    this.kneeEma = new Ema(0.5);
    this.leanEma = new Ema(0.4);
    this.widthEma = new Ema(0.4);
    this.fault = 'ok';
    this.faultSince = 0;
    this.lastSeen = -Infinity;
    this.lastRep = null;
    this.lastRepAt = -Infinity;
  }

  interrupt() {
    this.rep = null;
    if (this.phase === 'down') this.phase = 'up';
    for (const e of [this.depthEma, this.kneeEma, this.leanEma, this.widthEma]) e.reset();
    this.lastRepAt = -Infinity;
  }

  get summary() {
    return { count: this.count, clean: this.clean, partials: this.partials, log: this.log };
  }

  update(frame, source = 'auto') {
    const o = this.opts;
    const { lm, t } = frame;
    const view = { status: 'none', message: '', tone: 'info', events: [], joints: null };

    if (!lm) {
      if (this.rep && t - this.lastSeen > 1500) this.interrupt();
      view.message = 'Step into view, about 2–3 m from the camera';
      return view;
    }
    this.lastSeen = t;
    const px = (i) => toPx(lm[i], frame.w, frame.h);
    const mid = (a, b) => {
      const p = px(a), q = px(b);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: 0 };
    };

    // Facing the camera shows both shoulders apart; side-on they overlap.
    const shouldersSeen = [P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip].every((i) => vis(lm[i]) >= 0.5);
    if (shouldersSeen) {
      const s = mid(P.leftShoulder, P.rightShoulder);
      const h = mid(P.leftHip, P.rightHip);
      const torso = Math.hypot(s.x - h.x, s.y - h.y) || 1;
      const ratio = Math.abs(px(P.leftShoulder).x - px(P.rightShoulder).x) / torso;
      if (this.facing == null) this.facing = ratio > 0.45 ? 'front' : 'side';
      else if (this.facing === 'front' && ratio < 0.38) this.setFacing('side');
      else if (this.facing === 'side' && ratio > 0.52) this.setFacing('front');
    } else if (this.facing == null) {
      this.facing = 'side';
    }
    const front = this.facing === 'front';

    const score = (s) => vis(lm[s.sh]) + vis(lm[s.hip]) + vis(lm[s.knee]) + vis(lm[s.ank]);
    const ls = score(SIDES.left);
    const rs = score(SIDES.right);
    if (!this.side) this.side = ls >= rs ? 'left' : 'right';
    else if (this.side === 'left' && rs > ls + 0.4) this.side = 'right';
    else if (this.side === 'right' && ls > rs + 0.4) this.side = 'left';
    const S = SIDES[this.side];
    view.side = this.side;
    view.joints = { front, ...S };

    const needed = front ? FRONT_NEEDED : [S.sh, S.hip, S.knee, S.ank];
    if (needed.some((i) => vis(lm[i]) < 0.5)) {
      view.status = 'partial';
      view.message = 'Move back so I can see you from shoulders to feet';
      return view;
    }

    const sh = front ? mid(P.leftShoulder, P.rightShoulder) : px(S.sh);
    const hip = front ? mid(P.leftHip, P.rightHip) : px(S.hip);
    const knee = front ? mid(P.leftKnee, P.rightKnee) : px(S.knee);

    const leanNow = (Math.atan2(Math.abs(sh.x - hip.x), hip.y - sh.y) * 180) / Math.PI;
    if (leanNow > 75) {
      if (this.rep) this.interrupt();
      this.phase = 'setup';
      view.status = 'setup';
      view.message = 'Stand up tall to start';
      return view;
    }

    // Thigh length in the image, learned while standing (thigh near vertical).
    const thigh = Math.hypot(hip.x - knee.x, hip.y - knee.y) || 1;
    if (this.thighRef == null) this.thighRef = thigh;
    else if (this.phase !== 'down' && (knee.y - hip.y) / thigh > 0.85) this.thighRef += 0.1 * (thigh - this.thighRef);
    const depthP = this.depthEma.next(1 + (hip.y - knee.y) / this.thighRef);

    const angle = angleFn(frame, source === 'auto' ? (front ? '3d' : '2d') : source);
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

    const target = this.target;
    const depth = clamp(depthP / target, 0, 1.2);
    const depthReached = depthP >= target - o.depthTolerance;

    let faultNow = 'ok';
    if (depthP >= o.checkFrom) {
      if (!front && lean > o.maxLean) faultNow = 'lean';
      else if (front && kneeWidth < o.valgusRatio) faultNow = 'knees';
    }
    if (faultNow !== this.fault) {
      this.fault = faultNow;
      this.faultSince = t;
    }
    const fault = faultNow !== 'ok' && t - this.faultSince >= o.holdMs ? faultNow : 'ok';

    if (this.phase === 'setup') {
      this.phase = 'up';
      view.events.push({ type: 'ready' });
    }
    if (this.phase === 'up' && depthP > o.startDepth) {
      this.phase = 'down';
      this.rep = { start: t, max: depthP, maxAt: t, minKnee: kneeAngle, lean: false, knees: false, cued: {} };
    }
    if (this.phase === 'down') {
      const r = this.rep;
      if (depthP > r.max) {
        r.max = depthP;
        r.maxAt = t;
      }
      r.minKnee = Math.min(r.minKnee, kneeAngle);
      if (fault !== 'ok') {
        r[fault] = true;
        if (!r.cued[fault]) {
          r.cued[fault] = true;
          view.events.push({ type: 'cue', key: fault });
        }
      }
      if (depthP < o.finishDepth) this.completeRep(t, view);
    }

    Object.assign(view, {
      status: 'active',
      phase: this.phase,
      depth,
      depthReached,
      kneeAngle,
      lean,
      kneeWidth,
      fault,
      stats: [
        { label: 'Knee', value: `${Math.round(kneeAngle)}°` },
        front
          ? { label: 'Knee width', value: `${Math.round(kneeWidth * 100)}%`, warn: fault === 'knees' }
          : { label: 'Lean', value: `${Math.round(lean)}°`, warn: fault === 'lean' },
      ],
    });

    const say = (message, tone) => Object.assign(view, { message, tone });
    const recent = this.lastRep && t >= this.lastRepAt && t - this.lastRepAt < 1800;
    if (fault === 'lean') say('Chest up — you’re leaning too far forward', 'warn');
    else if (fault === 'knees') say('Push your knees out over your toes', 'warn');
    else if (this.phase === 'down' && depthReached) say('Depth reached — drive up!', 'good');
    else if (this.phase === 'down') say(`Lower… ${Math.round(depth * 100)}%`, 'info');
    else if (recent) say(...this.repMessage(this.lastRep));
    else say(this.count === 0 ? 'Ready — squat down to start' : 'Ready for the next rep', 'info');

    return view;
  }

  setFacing(facing) {
    this.facing = facing;
    this.widthEma.reset();
    this.kneeEma.reset();
  }

  completeRep(tEnd, view) {
    const o = this.opts;
    const r = this.rep;
    this.rep = null;
    this.phase = 'up';
    if (tEnd - r.start < o.minRepMs) return;

    const counted = r.max >= this.target - o.depthTolerance;
    const issues = [];
    if (!counted) issues.push('depth');
    if (r.lean) issues.push('lean');
    if (r.knees) issues.push('knees');
    const rep = {
      counted,
      n: counted ? ++this.count : null,
      detail: `depth ${Math.round((r.max / this.target) * 100)}%, knee ${Math.round(r.minKnee)}°`,
      downMs: Math.max(0, r.maxAt - r.start),
      upMs: Math.max(0, tEnd - r.maxAt),
      issues,
    };
    if (!counted) this.partials++;
    else if (issues.length === 0) this.clean++;

    this.log.push(rep);
    if (this.log.length > 100) this.log.shift();
    this.lastRep = rep;
    this.lastRepAt = tEnd;
    view.events.push({ type: 'rep', rep });
  }

  repMessage(rep) {
    if (!rep.counted) return ['Not counted — squat deeper (hips down to knee height)', 'bad'];
    if (rep.issues.includes('lean')) return [`Rep ${rep.n} — chest dropped forward`, 'warn'];
    if (rep.issues.includes('knees')) return [`Rep ${rep.n} — knees caved in`, 'warn'];
    return [`Good rep! ${rep.n}`, 'good'];
  }

  voiceLine(event) {
    if (event.type === 'cue') return event.key === 'lean' ? 'Chest up' : 'Knees out';
    if (event.type === 'rep') {
      const { rep } = event;
      if (!rep.counted) return 'Go deeper';
      if (rep.issues.includes('lean')) return `${rep.n}. Chest up`;
      if (rep.issues.includes('knees')) return `${rep.n}. Knees out`;
      return String(rep.n);
    }
    return '';
  }
}
