import { P, vis, clamp, toPx, angleFn, Ema } from '../geometry.js';

const SIDES = {
  left: { sh: P.leftShoulder, el: P.leftElbow, wr: P.leftWrist, hip: P.leftHip, knee: P.leftKnee, ank: P.leftAnkle },
  right: { sh: P.rightShoulder, el: P.rightElbow, wr: P.rightWrist, hip: P.rightHip, knee: P.rightKnee, ank: P.rightAnkle },
};

export const PUSHUP_DEFAULTS = {
  depthTarget: 90, // elbow angle (deg) at the bottom that counts as full depth
  depthTolerance: 5,
  topAngle: 160, // elbow angle treated as "arms straight" for the depth %
  startAngle: 140, // bending below this starts a rep
  lockoutAngle: 150, // straightening above this finishes a rep
  sagTolerance: 18, // how far (deg) the shoulder-hip-ankle line may bend downward
  pikeTolerance: 22, // ...or upward, before it's flagged
  holdMs: 400, // a hip fault must last this long before it counts
  maxIncline: 45, // body steeper than this is "not in a push-up position"
  minRepMs: 400, // anything faster is treated as tracking noise
  riseFraction: 0.6, // shoulders must climb back this share of the way up to finish a rep
};

/**
 * Push-up rep counter and form checker. Expects a side-on view.
 *
 * Depth is measured from the elbow angle (shoulder-elbow-wrist). Body
 * alignment is the shoulder-hip-ankle angle; whether a bend is a sag or a pike
 * depends on which side of the shoulder→ankle line the hip falls in the image.
 *
 * A straight elbow alone doesn't finish a rep: the shoulders must also have
 * risen back up (shoulder height above the wrist, in arm lengths). Otherwise
 * moving the hands while lying at the bottom (e.g. hand-release push-ups)
 * would count as extra reps.
 */
export class PushupAnalyzer {
  constructor(options = {}) {
    this.opts = { ...PUSHUP_DEFAULTS, ...options };
    this.statLabels = ['Elbow', 'Body'];
    this.reset();
  }

  setOptions(options) {
    Object.assign(this.opts, options);
  }

  reset() {
    this.count = 0;
    this.clean = 0;
    this.partials = 0;
    this.log = [];
    this.phase = 'setup'; // 'setup' | 'up' | 'down'
    this.rep = null;
    this.side = null;
    this.elbowEma = new Ema(0.5);
    this.bodyEma = new Ema(0.35);
    this.heightEma = new Ema(0.5);
    this.hipState = 'ok';
    this.hipSince = 0;
    this.lastSeen = -Infinity;
    this.lastRep = null;
    this.lastRepAt = -Infinity;
  }

  /** Abandon any rep in progress (tracking lost, video seeked, ...). */
  interrupt() {
    this.rep = null;
    if (this.phase === 'down') this.phase = 'up';
    this.elbowEma.reset();
    this.bodyEma.reset();
    this.heightEma.reset();
    this.lastRepAt = -Infinity;
  }

  get summary() {
    return { count: this.count, clean: this.clean, partials: this.partials, log: this.log };
  }

  /**
   * @param frame {lm, world, w, h, t} — t in ms
   * @param source '2d' | '3d'
   */
  update(frame, source = '2d') {
    const o = this.opts;
    const { lm, t } = frame;
    const view = { status: 'none', message: '', tone: 'info', events: [], joints: null };

    if (!lm) {
      if (this.rep && t - this.lastSeen > 1500) this.interrupt();
      view.message = 'Step into view, side-on to the camera';
      return view;
    }
    this.lastSeen = t;

    // Track the side of the body facing the camera; hysteresis avoids flicker.
    const score = (s) =>
      vis(lm[s.sh]) + vis(lm[s.el]) + vis(lm[s.wr]) + vis(lm[s.hip]) +
      0.5 * Math.max(vis(lm[s.ank]), vis(lm[s.knee]));
    const ls = score(SIDES.left);
    const rs = score(SIDES.right);
    if (!this.side) this.side = ls >= rs ? 'left' : 'right';
    else if (this.side === 'left' && rs > ls + 0.4) this.switchSide('right');
    else if (this.side === 'right' && ls > rs + 0.4) this.switchSide('left');

    const S = SIDES[this.side];
    const foot = vis(lm[S.ank]) >= 0.4 ? S.ank : vis(lm[S.knee]) >= 0.4 ? S.knee : null;
    view.side = this.side;
    view.joints = { sh: S.sh, el: S.el, wr: S.wr, hip: S.hip, foot };

    if ([S.sh, S.el, S.wr, S.hip].some((i) => vis(lm[i]) < 0.5)) {
      view.status = 'partial';
      view.message = 'Turn side-on so I can see your arm and hip';
      return view;
    }
    if (foot == null) {
      view.status = 'partial';
      view.message = 'Move back so your whole body is in frame';
      return view;
    }

    const sh = toPx(lm[S.sh], frame.w, frame.h);
    const hip = toPx(lm[S.hip], frame.w, frame.h);
    const ft = toPx(lm[foot], frame.w, frame.h);
    const dx = ft.x - sh.x;
    const dy = ft.y - sh.y;
    const incline = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
    if (incline > o.maxIncline) {
      if (this.rep) this.interrupt();
      this.phase = 'setup';
      view.status = 'setup';
      view.message = 'Get into a plank: hands under shoulders, body straight';
      return view;
    }

    const angle = angleFn(frame, source);
    const elbow = this.elbowEma.next(angle(S.sh, S.el, S.wr));
    const bodyAngle = this.bodyEma.next(angle(S.sh, S.hip, foot));
    const bend = 180 - bodyAngle;

    // Shoulder height above the wrist, in arm lengths: ≈1 with straight arms,
    // ≈0.4 at the bottom, and near 0 if the hands come off the floor.
    const el = toPx(lm[S.el], frame.w, frame.h);
    const wr = toPx(lm[S.wr], frame.w, frame.h);
    const arm = Math.hypot(el.x - sh.x, el.y - sh.y) + Math.hypot(wr.x - el.x, wr.y - el.y) || 1;
    const height = this.heightEma.next((wr.y - sh.y) / arm);

    // Is the hip below the shoulder→foot line (toward the floor)?
    const k = ((hip.x - sh.x) * dx + (hip.y - sh.y) * dy) / (dx * dx + dy * dy);
    const hipBelow = hip.y > sh.y + k * dy;
    let hipNow = 'ok';
    if (hipBelow && bend > o.sagTolerance) hipNow = 'sag';
    else if (!hipBelow && bend > o.pikeTolerance) hipNow = 'pike';
    if (hipNow !== this.hipState) {
      this.hipState = hipNow;
      this.hipSince = t;
    }
    const hipFault = hipNow !== 'ok' && t - this.hipSince >= o.holdMs ? hipNow : 'ok';

    const depth = clamp((o.topAngle - elbow) / (o.topAngle - o.depthTarget), 0, 1.2);
    const depthReached = elbow <= o.depthTarget + o.depthTolerance;

    // Rep state machine.
    if (this.phase === 'setup') {
      this.phase = 'up';
      view.events.push({ type: 'ready' });
    }
    if (this.phase === 'up' && elbow < o.startAngle) {
      this.phase = 'down';
      this.rep = newRep(t, elbow, height);
    }
    if (this.phase === 'down') {
      const r = this.rep;
      r.minHeight = Math.min(r.minHeight, height);
      const risen = (h) => h - r.minHeight >= o.riseFraction * Math.max(0.15, r.startHeight - r.minHeight);
      if (elbow < r.min) {
        r.min = elbow;
        r.minAt = t;
        r.peak = elbow;
        r.peakAt = t;
        r.peakHeight = height;
      } else if (elbow > r.peak) {
        r.peak = elbow;
        r.peakAt = t;
        r.peakHeight = height;
      }
      if (hipFault !== 'ok') {
        r[hipFault] = Math.max(r[hipFault], bend);
        if (!r.cued[hipFault]) {
          r.cued[hipFault] = true;
          view.events.push({ type: 'cue', key: hipFault });
        }
      }
      if (elbow > o.lockoutAngle && risen(height)) {
        this.completeRep(t, true, view);
      } else if (r.peak - r.min > 35 && elbow < r.peak - 15 && risen(r.peakHeight)) {
        // Came most of the way up, then went back down without straightening the arms.
        this.completeRep(r.peakAt, false, view);
        this.phase = 'down';
        this.rep = newRep(t, elbow, r.peakHeight);
      }
    }

    Object.assign(view, {
      status: 'active',
      phase: this.phase,
      elbow,
      depth,
      depthReached,
      bodyAngle,
      hipFault,
      stats: [
        { label: 'Elbow', value: `${Math.round(elbow)}°` },
        { label: 'Body', value: `${Math.round(bodyAngle)}°`, warn: hipFault !== 'ok' },
      ],
    });

    const say = (message, tone) => Object.assign(view, { message, tone });
    const recent = this.lastRep && t >= this.lastRepAt && t - this.lastRepAt < 1800;
    if (hipFault === 'sag') say('Hips sagging — squeeze your glutes and brace', 'warn');
    else if (hipFault === 'pike') say('Hips too high — lower them into a straight line', 'warn');
    else if (this.phase === 'down' && depthReached) say('Depth reached — push up!', 'good');
    else if (this.phase === 'down') say(`Lower… ${Math.round(depth * 100)}%`, 'info');
    else if (recent) say(...this.repMessage(this.lastRep));
    else say(this.count === 0 ? 'Ready — lower your chest to start' : 'Ready for the next rep', 'info');

    return view;
  }

  switchSide(side) {
    this.side = side;
    this.elbowEma.reset();
    this.bodyEma.reset();
    this.heightEma.reset();
  }

  completeRep(tEnd, lockedOut, view) {
    const o = this.opts;
    const r = this.rep;
    this.rep = null;
    this.phase = 'up';
    if (tEnd - r.start < o.minRepMs) return;

    const counted = r.min <= o.depthTarget + o.depthTolerance;
    const issues = [];
    if (!counted) issues.push('depth');
    if (r.sag) issues.push('sag');
    if (r.pike) issues.push('pike');
    if (!lockedOut) issues.push('lockout');

    const rep = {
      counted,
      n: counted ? ++this.count : null,
      minElbow: Math.round(r.min),
      detail: `elbow ${Math.round(r.min)}°`,
      downMs: Math.max(0, r.minAt - r.start),
      upMs: Math.max(0, tEnd - r.minAt),
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
    if (!rep.counted) return ['Not counted — go lower (elbows to about 90°)', 'bad'];
    if (rep.issues.includes('sag')) return [`Rep ${rep.n} — hips sagged, keep one straight line`, 'warn'];
    if (rep.issues.includes('pike')) return [`Rep ${rep.n} — hips were too high`, 'warn'];
    if (rep.issues.includes('lockout')) return [`Rep ${rep.n} — straighten your arms at the top`, 'warn'];
    return [`Good rep! ${rep.n}`, 'good'];
  }

  /** Short phrases for spoken feedback. */
  voiceLine(event) {
    if (event.type === 'cue') return event.key === 'sag' ? 'Tighten your core' : 'Hips down';
    if (event.type === 'rep') {
      const { rep } = event;
      if (!rep.counted) return 'Go lower';
      if (rep.issues.includes('sag')) return `${rep.n}. Keep your hips up`;
      if (rep.issues.includes('pike')) return `${rep.n}. Lower your hips`;
      if (rep.issues.includes('lockout')) return `${rep.n}. Lock out`;
      return String(rep.n);
    }
    return '';
  }
}

function newRep(t, elbow, height) {
  return {
    start: t,
    min: elbow,
    minAt: t,
    peak: elbow,
    peakAt: t,
    startHeight: height,
    minHeight: height,
    peakHeight: height,
    sag: 0,
    pike: 0,
    cued: {},
  };
}
