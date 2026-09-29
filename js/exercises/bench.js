import { SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, Baseline, LEFT, RIGHT, sub, dot, unit, upNormal, elevation, partial, setup, seg, dash, arc, dots, norm, deg, MSG } from './kit.js';

/**
 * Lying face up on a bench, filmed side-on: dumbbell presses, flyes and
 * pullovers. The torso line (hip → shoulder) is the bench; "up" is its
 * normal on the ceiling side. Arm length is learned whenever an arm is
 * straight, so heights are in arm lengths whoever is lifting.
 */
const BENCH = {
  flat: { lo: -20, hi: 20, low: 'Lie back flat on the bench', high: 'Lie flat on the bench (it looks inclined)' },
  incline: { lo: 20, hi: 62, low: 'Set the bench to about 30° and lie back on it', high: 'Lie back on the bench (about 30°)' },
};

class SupineBench extends RepCounter {
  static sideOnly = true;
  static defaults = { bench: 'flat', hipLift: 10 };

  reset() {
    this.sides = new SidePicker();
    this.armRef = null;
    this.tiltBase = new Baseline(0.1);
    super.reset();
  }

  /** Common geometry, or a status to report. */
  lying(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip])) return { out: partial(MSG.side, MSG.sideSay) };
    const sh = f.p(S.sh), hip = f.p(S.hip);
    const axis = unit(sub(sh, hip));
    const torso = f.d(S.sh, S.hip) || 1;
    const tilt = elevation(sub(sh, hip));
    const B = BENCH[o.bench];
    // Mid-rep the window widens, so hips coming off the bench are called out rather than pausing the count.
    const slack = this.phase === 'down' ? 20 : 0;
    if (tilt > B.hi + 15 + slack || tilt < B.lo - 15 - slack) return { out: setup(B.low) };
    if (tilt > B.hi + slack) return { out: setup(B.high) };
    if (tilt < B.lo - slack) return { out: setup(B.low) };

    // Arm length: follows the longest straight-arm reach quickly, shorter ones slowly.
    const reach = f.d(S.sh, S.wr);
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (elbow >= 150) this.armRef = this.armRef == null ? reach : this.armRef + (reach > this.armRef ? 0.3 : 0.02) * (reach - this.armRef);
    const arm = Math.max(this.armRef ?? 0, 1.1 * torso);
    const n = upNormal(axis);
    const h = dot(sub(f.p(S.wr), sh), n) / arm;
    if (this.phase !== 'down') this.tiltBase.learn(tilt);
    const hipsUp = this.tiltBase.value != null && this.tiltBase.value - tilt > o.hipLift;
    return { f, S, axis, n, torso, tilt, arm, h, elbow, hipsUp };
  }

  /** Where the wrist is at a given height (for the target guide), normalized. */
  guide(g, h) {
    const { f, S, n, arm, axis } = g;
    const sh = f.p(S.sh);
    const c = { x: sh.x + n.x * h * arm, y: sh.y + n.y * h * arm };
    const a = { x: c.x - axis.x * 0.35 * arm, y: c.y - axis.y * 0.35 * arm };
    const b = { x: c.x + axis.x * 0.35 * arm, y: c.y + axis.y * 0.35 * arm };
    return dash(norm(f, a), norm(f, b));
  }
}

/**
 * Dumbbell bench press, flat or incline. Progress is how far the dumbbells
 * come down toward the chest (wrist height above the shoulder, 1 arm length
 * locked out → about a quarter at the chest). A rep only finishes with the
 * arm straight again, so short reps at either end don't count.
 */
export class BenchPressAnalyzer extends SupineBench {
  static defaults = {
    bench: 'flat',
    topH: 0.9, // wrist height (arm lengths) with the arms locked out
    bottomH: 0.33, // ...and with the dumbbells down at the chest (elbows a little below the bench line)
    lockout: 150, // elbow angle that counts as straight at the top
    flareBelow: 0.22, // elbow's reach toward the hips (upper-arm lengths) below this at the bottom = flared to ~90°
    depthElbow: 115, // at the chest the elbows are bent at least this much
    minEccMs: 450,
  };
  static statLabels = ['Elbow', 'Bench'];
  static meterLabel = 'depth';

  reset() {
    this.alongTop = new Baseline(0.2);
    super.reset();
  }
  static text = {
    noPerson: 'Lie on the bench side-on to the camera',
    toStart: 'Press the dumbbells up to straight arms to start',
    ready: 'Ready — lower the dumbbells to your chest',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Full depth — press up!',
    notCounted: 'Not counted — lower the dumbbells all the way to your chest',
    notCountedVoice: 'Lower to your chest',
    incomplete: { rep: 'press all the way up to straight arms', voice: 'Lock out', miss: 'Not counted — press all the way up to straight arms', missVoice: 'Lock out' },
    faults: {
      flare: { live: 'Tuck your elbows to about 45° from your body', rep: 'elbows flared out', voice: 'Elbows in', cue: 'Tuck your elbows' },
      hips: { live: 'Keep your hips down on the bench', rep: 'hips came off the bench', voice: 'Hips down', cue: 'Hips down' },
      fast: { rep: 'dropped the weights — control the way down', voice: 'Slower down', miss: 'Not counted — control the way down' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const g = this.lying(frame);
    if (g.out) return g.out;
    const { f, S, h, elbow, arm, axis, hipsUp, tilt } = g;
    let progress = (o.topH - h) / (o.topH - o.bottomH);
    // The dumbbells can't be at the chest with straight arms: then a wrist was misread
    // (off the edge of the picture, or hidden behind a weight). Depth needs bent elbows too.
    if (elbow > o.depthElbow) progress = Math.min(progress, 0.8);
    const faults = [];
    // Elbow flare reads right only from straight side-on (shoulders overlapping), and relative
    // to where the elbow sits over the shoulder at lockout: tucked elbows travel toward the hips.
    const toHip = { x: -axis.x, y: -axis.y };
    const along = dot(sub(f.p(S.el), f.p(S.sh)), toHip) / (0.5 * arm);
    const sideOn = f.v(LEFT.sh) < 0.3 || f.v(RIGHT.sh) < 0.3 || f.d(LEFT.sh, RIGHT.sh) < 0.35 * g.torso;
    if (progress < 0.15 && elbow >= 150) this.alongTop.learn(along);
    if (sideOn && progress > 0.65 && this.alongTop.value != null && along - this.alongTop.value < o.flareBelow) faults.push('flare');
    if (hipsUp) faults.push('hips');
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress,
      faults,
      elbow,
      stats: [
        { label: 'Elbow', value: `${e}°`, fault: 'flare' },
        { label: 'Bench', value: deg(Math.max(0, tilt)), fault: 'hips' },
      ],
      overlay: [
        dash(S.hip, S.sh, 'fault:hips', 3),
        this.guide(g, o.bottomH),
        seg(S.sh, S.el, 'fault:flare'),
        seg(S.el, S.wr),
        arc(S.sh, S.el, S.wr, `${e}°`),
        dots([S.sh, S.el, S.wr]),
      ],
    };
  }

  canFinish(m) {
    return m.elbow == null || m.elbow >= this.opts.lockout;
  }
}

/**
 * Dumbbell flyes. The dumbbells sweep down in a wide arc with a fixed, soft
 * elbow bend. Bending the elbows turns it into a press, which is easier, so
 * a rep with the elbows bent much past 90° doesn't count.
 */
export class FlyAnalyzer extends SupineBench {
  static defaults = {
    bench: 'flat',
    topH: 0.85,
    bottomH: 0.2,
    pressElbow: 105, // 3D elbow angle below this = pressing, not flying
    tooDeep: -0.25, // wrists this far below the shoulders = forcing the stretch
    minEccMs: 800,
  };
  static statLabels = ['Elbow', 'Depth'];
  static meterLabel = 'stretch';
  static text = {
    noPerson: 'Lie on the bench side-on to the camera',
    toStart: 'Bring the dumbbells up over your chest to start',
    ready: 'Ready — open your arms in a wide arc',
    going: (pct) => `Open… ${pct}%`,
    reached: 'Full stretch — squeeze back up',
    notCounted: 'Not counted — lower until your chest is fully stretched',
    notCountedVoice: 'Wider',
    incomplete: { rep: 'bring the dumbbells back over your chest', voice: 'All the way up' },
    faults: {
      press: { rep: 'elbows bent — that was a press', miss: 'Not counted — keep the same slight elbow bend; bending it turns the fly into a press', missVoice: 'Fixed elbows' },
      deep: { live: 'Don’t force the stretch — stop at chest level', rep: 'went too deep', voice: 'Not so deep', cue: 'Not so deep' },
      hips: { live: 'Keep your hips down on the bench', rep: 'hips came off the bench', voice: 'Hips down', cue: 'Hips down' },
      fast: { rep: 'dropped into the stretch — lower slowly', voice: 'Slower' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const g = this.lying(frame);
    if (g.out) return g.out;
    const { f, S, h, hipsUp } = g;
    const elbow3 = f.ang3(S.sh, S.el, S.wr);
    const progress = (o.topH - h) / (o.topH - o.bottomH);
    const faults = [];
    if (h < o.tooDeep) faults.push('deep');
    if (hipsUp) faults.push('hips');
    return {
      status: 'active',
      progress,
      faults,
      elbow3,
      stats: [
        { label: 'Elbow', value: deg(elbow3) },
        { label: 'Depth', value: `${Math.round(Math.max(0, progress) * 100)}%`, fault: 'deep' },
      ],
      overlay: [dash(S.hip, S.sh, 'fault:hips', 3), this.guide(g, o.bottomH), seg(S.sh, S.el), seg(S.el, S.wr), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { minElbow: m.elbow3 };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow3);
  }

  repBlocks(r) {
    return r.minElbow < this.opts.pressElbow ? ['press'] : [];
  }

  repDetail(r) {
    return `stretch ${Math.round(r.max * 100)}%, elbow ${Math.round(r.minElbow)}°`;
  }
}

/**
 * Dumbbell pullovers: from over the chest to behind the head with the same
 * elbow bend throughout. Progress is the arm's angle from the torso (90° over
 * the chest → about 150° behind the head).
 */
export class PulloverAnalyzer extends SupineBench {
  static defaults = {
    bench: 'flat',
    fromAngle: 95,
    toAngle: 150,
    maxElbowChange: 35, // bending and straightening the elbows = a triceps extension
    minElbow: 100,
    minEccMs: 700,
  };
  static statLabels = ['Arm', 'Elbow'];
  static meterLabel = 'stretch';
  static text = {
    noPerson: 'Lie on the bench side-on to the camera',
    toStart: 'Hold the dumbbell over your chest to start',
    ready: 'Ready — lower the dumbbell behind your head',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Stretched — pull it back over your chest',
    notCounted: 'Not counted — lower the weight further behind your head',
    notCountedVoice: 'Further back',
    incomplete: { rep: 'bring the weight back over your chest', voice: 'Back over your chest' },
    faults: {
      elbows: { rep: 'elbows bent and straightened', miss: 'Not counted — keep the same elbow bend; bending it turns it into a triceps exercise', missVoice: 'Fixed elbows' },
      hips: { live: 'Ribs down — keep your hips on the bench', rep: 'arched off the bench', voice: 'Ribs down', cue: 'Ribs down' },
      fast: { rep: 'dropped into the stretch — lower slowly', voice: 'Slower' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const g = this.lying(frame);
    if (g.out) return g.out;
    const { f, S, elbow, hipsUp } = g;
    const armAngle = f.ang(S.hip, S.sh, S.wr);
    const progress = (armAngle - o.fromAngle) / (o.toAngle - o.fromAngle);
    const faults = hipsUp ? ['hips'] : [];
    return {
      status: 'active',
      progress,
      faults,
      elbow,
      stats: [
        { label: 'Arm', value: deg(armAngle) },
        { label: 'Elbow', value: deg(elbow), fault: 'elbows' },
      ],
      overlay: [dash(S.hip, S.sh, 'fault:hips', 3), seg(S.sh, S.el), seg(S.el, S.wr), arc(S.hip, S.sh, S.wr, deg(armAngle)), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { minElbow: m.elbow, maxElbow: m.elbow };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.maxElbow = Math.max(r.maxElbow, m.elbow);
  }

  repBlocks(r) {
    const o = this.opts;
    return r.maxElbow - r.minElbow > o.maxElbowChange || r.minElbow < o.minElbow ? ['elbows'] : [];
  }
}

