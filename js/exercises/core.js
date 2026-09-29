import { SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, ChestSide, LEFT, RIGHT, sub, dot, unit, upNormal, elevation, midPt, partial, setup, seg, dash, arc, dots, deg, DEG } from './kit.js';

/** Low-water mark that creeps up slowly while resting (the bottom of a movement). */
class LowWater {
  constructor(perSec) {
    this.perSec = perSec;
    this.value = null;
  }
  next(v, dt, resting) {
    if (this.value == null || v < this.value) this.value = v;
    else if (resting) this.value += Math.min(v - this.value, this.perSec * dt);
    return this.value;
  }
}

/** Seconds since the previous frame. */
function stepper() {
  let last = null;
  return (t) => {
    const dt = last == null ? 0 : Math.max(0, (t - last) / 1000);
    last = t;
    return dt;
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Dead bugs, lying on your back side-on (a little toward your feet is even
 * better). A rep is one arm reaching overhead while the opposite leg
 * straightens toward the floor, then back to 90/90. Rushing is called out.
 */
export class DeadBugAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    from: 95, // hip and shoulder angles at 90/90
    to: 150, // ...with the leg long and the arm overhead
    minMs: 1600, // quicker than this per rep = rushing
    minRepMs: 600,
  };
  static statLabels = ['Leg', 'Arm'];
  static meterLabel = 'reach';
  static tempo = ['out ', ' in '];
  static text = {
    noPerson: 'Lie on your back, side-on to the camera',
    toStart: 'Arms up, knees over your hips at 90° to start',
    ready: 'Ready — reach one arm back and the other leg long',
    going: (pct) => `Reach… ${pct}%`,
    reached: 'Long — now bring them back',
    notCounted: 'Not counted — straighten the leg and reach the opposite arm further',
    notCountedVoice: 'Reach further',
    incomplete: { rep: 'come all the way back to 90/90', voice: 'All the way back' },
    faults: {
      same: { live: 'Opposite arm and leg', rep: 'moved the same-side arm and leg', voice: 'Opposite arm and leg', cue: 'Opposite arm and leg' },
      rush: { rep: 'rushed — move slowly and keep breathing', voice: 'Slower' },
    },
  };

  reset() {
    this.chest = new ChestSide();
    this.sides = new SidePicker();
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee']);
    if (!f.seen([S.sh, S.hip, S.knee])) return partial('Turn side-on so I can see your arms and legs', 'Turn side on');
    const tilt = elevation(sub(f.p(S.sh), f.p(S.hip)));
    const chest = this.chest.update(f, S, unit(sub(f.p(S.sh), f.p(S.hip))));
    if (Math.abs(tilt) > 35 || (chest && chest.y > 0.2)) return setup('Lie on your back on the floor', 'Lie on your back');
    const p = (v) => clamp01((v - o.from) / (o.to - o.from));
    const leg = (L) => (f.seen([L.hip, L.knee, L.ank], 0.3) ? Math.min(p(f.ang(L.sh, L.hip, L.knee)), p(f.ang(L.hip, L.knee, L.ank))) : null);
    const arm = (A) => (f.seen([A.sh, A.wr], 0.3) ? p(f.ang(A.hip, A.sh, A.wr)) : null);
    const lg = { L: leg(LEFT), R: leg(RIGHT) };
    const am = { L: arm(LEFT), R: arm(RIGHT) };
    const pair = (l, a) => (lg[l] == null || am[a] == null ? 0 : Math.min(lg[l], am[a]));
    const opp = Math.max(pair('L', 'R'), pair('R', 'L'));
    const same = Math.max(pair('L', 'L'), pair('R', 'R'));
    const progress = Math.max(opp, same);
    const legSide = (lg.L ?? -1) >= (lg.R ?? -1) ? 'L' : 'R';
    // Only judge which arm moved when both sides are clearly in view.
    const clear = [LEFT, RIGHT].every((X) => f.seen([X.sh, X.wr, X.hip, X.knee], 0.6));
    const faults = clear && progress > 0.5 && same > opp + 0.35 ? ['same'] : [];
    return {
      status: 'active',
      progress,
      faults,
      side: legSide,
      stats: [
        { label: 'Leg', value: `${Math.round(Math.max(lg.L ?? 0, lg.R ?? 0) * 100)}%` },
        { label: 'Arm', value: `${Math.round(Math.max(am.L ?? 0, am.R ?? 0) * 100)}%`, fault: 'same' },
      ],
      overlay: [seg(S.sh, S.hip, 'neutral', 5), ...[LEFT, RIGHT].flatMap((X) => [seg(X.hip, X.knee), seg(X.knee, X.ank), seg(X.sh, X.wr, 'fault:same')])],
    };
  }

  repIssues(r) {
    return this.lastSeen - r.from < this.opts.minMs ? ['rush'] : [];
  }
}

/**
 * Overhead dumbbell crunch lying along a flat bench, side-on. Progress is the
 * shoulders curling up off the bench (the hip–shoulder line lifting from
 * where it lies). The dumbbell stays at arm's length past the head: swinging
 * it forward to start the rep doesn't count.
 */
export class CrunchAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    target: 15, // hip–shoulder line lifting this much (deg) = shoulder blades off the bench
    armsWarn: 140, // arm angle from the torso (180 = in line with the ears)
    armsBlock: 115,
    situp: 45,
    eccentric: 'up',
    minRepMs: 600,
  };
  static statLabels = ['Curl', 'Arms'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie along the bench, side-on to the camera',
    toStart: 'Lie back with the dumbbell overhead to start',
    ready: 'Ready — curl your ribs toward your hips',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Shoulder blades up — lower slowly',
    notCounted: 'Not counted — curl up until your shoulder blades leave the bench',
    notCountedVoice: 'Curl higher',
    incomplete: { rep: 'lower all the way back down', voice: 'All the way down' },
    faults: {
      swing: { rep: 'swung the dumbbell forward', miss: 'Not counted — keep the dumbbell overhead; don’t swing it forward', missVoice: 'Arms back' },
      arms: { live: 'Keep your arms by your ears — the abs lift the weight', rep: 'arms came forward', voice: 'Arms back', cue: 'Arms by your ears' },
      situp: { live: 'Stop when your shoulder blades clear — don’t sit up', rep: 'sat up too far', voice: 'Not so high', cue: 'Not so high' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    super.reset();
  }

  resetFilters() {
    this.low = new LowWater(1.5);
    this.dt = stepper();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'wr']);
    if (!f.seen([S.sh, S.hip, S.wr])) return partial('Turn side-on so I can see your arms and hips', 'Turn side on');
    const lift = elevation(sub(f.p(S.sh), f.p(S.hip)));
    const chest = this.chest.update(f, S, unit(sub(f.p(S.sh), f.p(S.hip))));
    if (this.phase !== 'down' && (Math.abs(lift) > 35 || (chest && chest.y > 0.2))) return setup('Lie back along the bench, face up', 'Lie back');
    const base = this.low.next(lift, this.dt(frame.t), this.phase !== 'down');
    const arms = f.ang(S.hip, S.sh, S.wr);
    const faults = [];
    if (arms < o.armsWarn) faults.push('arms');
    if (lift - base > o.situp) faults.push('situp');
    return {
      status: 'active',
      progress: (lift - base) / o.target,
      faults,
      arms,
      stats: [
        { label: 'Curl', value: deg(lift - base), fault: 'situp' },
        { label: 'Arms', value: deg(arms), fault: 'arms' },
      ],
      overlay: [seg(S.hip, S.sh, 'go', 6), seg(S.sh, S.wr, 'fault:arms'), arc(S.hip, S.sh, S.wr, deg(arms), 'fault:arms'), dots([S.hip, S.sh, S.wr])],
    };
  }

  repState(m) {
    return { minArms: m.arms };
  }

  trackRep(r, m) {
    r.minArms = Math.min(r.minArms, m.arms);
  }

  repBlocks(r) {
    return r.minArms < this.opts.armsBlock ? ['swing'] : [];
  }
}

/**
 * Weighted reverse crunches on a flat bench, side-on: knees at 90°, curl the
 * pelvis up so the hips leave the bench. Progress is the hips lifting (the
 * shoulder–hip line tipping up); swinging the legs without the hips leaving
 * the bench is a hip-flexor exercise and doesn't count.
 */
export class ReverseCrunchAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    target: 8, // hip–shoulder line tipping up (deg) as the pelvis curls off the bench
    swingHip: 60, // knees pulled this close (hip angle) without the hips lifting = swinging
    eccentric: 'up',
    minEccMs: 700,
    minRepMs: 600,
  };
  static statLabels = ['Hips', 'Knees'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie on the bench side-on to the camera, knees up',
    toStart: 'Lower your hips onto the bench to start',
    ready: 'Ready — curl your hips up off the bench',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Hips up — lower one vertebra at a time',
    notCounted: 'Not counted — curl your hips up off the bench',
    notCountedVoice: 'Hips up',
    incomplete: { rep: 'lower your hips back to the bench', voice: 'All the way down' },
    faults: {
      swing: { live: 'Curl your hips up — don’t just swing your legs', rep: 'swung the legs', voice: 'Curl your hips', cue: 'Curl your hips' },
      fast: { rep: 'dropped down — lower one vertebra at a time', voice: 'Slower down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    super.reset();
  }

  resetFilters() {
    this.low = new LowWater(1);
    this.dt = stepper();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee']);
    if (!f.seen([S.sh, S.hip, S.knee])) return partial('Turn side-on so I can see your shoulders, hips and knees', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), knee = f.p(S.knee);
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const lying = Math.abs(elevation(sub(sh, hip)));
    if (lying > (this.phase === 'down' ? 50 : 35) || (chest && chest.y > 0.2)) return setup('Lie on your back on the bench', 'Lie on your back');
    if (knee.y > hip.y + 0.1 * (f.d(S.sh, S.hip) || 1)) return setup('Lift your knees up over your hips, bent to 90°', 'Knees up');
    const lift = elevation(sub(hip, sh));
    const base = this.low.next(lift, this.dt(frame.t), this.phase !== 'down');
    const progress = (lift - base) / o.target;
    const hipAng = f.ang(S.sh, S.hip, S.knee);
    const faults = hipAng < o.swingHip && progress < 0.3 ? ['swing'] : [];
    return {
      status: 'active',
      progress,
      faults,
      stats: [
        { label: 'Hips', value: deg(Math.max(0, lift - base)) },
        { label: 'Knees', value: deg(hipAng), fault: 'swing' },
      ],
      overlay: [dash(S.sh, S.hip, 'go', 3), seg(S.hip, S.knee, 'fault:swing'), seg(S.knee, S.ank, 'fault:swing'), dots([S.sh, S.hip, S.knee])],
    };
  }
}

/**
 * Weighted side plank with a reach-through, filmed from the front (facing
 * your chest). A rep is the top arm going from up at the ceiling to threaded
 * under the body and back. The hips have to stay high the whole time.
 */
export class SidePlankReachAnalyzer extends RepCounter {
  static defaults = {
    upH: 0.7, // top hand above the top shoulder (arm lengths) = reaching up
    underH: -0.45, // ...below it = threaded under the body
    sagBy: 0.12, // hips below the shoulder–ankle line (torso lengths)
    pikeBy: 0.25,
    minRepMs: 700,
  };
  static statLabels = ['Reach', 'Hips'];
  static meterLabel = 'reach';
  static tempo = ['↓', '↑'];
  static text = {
    noPerson: 'Face the camera in a side plank',
    toStart: 'Reach your top arm up to the ceiling to start',
    ready: 'Ready — thread the dumbbell under your body',
    going: (pct) => `Reach through… ${pct}%`,
    reached: 'Through — unwind back up',
    notCounted: 'Not counted — thread the weight all the way under your body',
    notCountedVoice: 'Reach further under',
    incomplete: { rep: 'unwind all the way back up to the ceiling', voice: 'All the way up' },
    faults: {
      sag: { live: 'Keep your hips up — one straight line', rep: 'hips sagged', voice: 'Hips up', cue: 'Hips up' },
      pike: { live: 'Don’t pike — turn your chest instead', rep: 'piked the hips back', voice: 'Turn your chest', cue: 'Hips down, turn your chest' },
    },
  };

  reset() {
    this.armRef = null;
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    if (!f.seen([LEFT.sh, RIGHT.sh, LEFT.hip, RIGHT.hip], 0.45)) return partial('Face the camera so I can see your chest and hips', 'Face the camera');
    const low = f.p(LEFT.sh).y >= f.p(RIGHT.sh).y ? LEFT : RIGHT; // side on the floor
    const top = low === LEFT ? RIGHT : LEFT;
    const ank = [LEFT.ank, RIGHT.ank].filter((i) => f.v(i) >= 0.4);
    if (!ank.length) return partial('Move back so I can see your feet', 'Move back');
    const feet = ank.map((i) => f.p(i)).reduce(midPt);
    const shM = f.mid(LEFT.sh, RIGHT.sh), hipM = f.mid(LEFT.hip, RIGHT.hip);
    const axis = unit(sub(shM, feet));
    const torso = Math.hypot(shM.x - hipM.x, shM.y - hipM.y) || 1;
    if (Math.abs(elevation(axis)) > 55) return setup('Get into a side plank, facing the camera', 'Side plank');
    const n = upNormal(axis);
    const hipOff = dot(sub(hipM, shM), n) / torso; // + = hips above the shoulder–feet line
    if (hipOff < -0.45) return setup('Lift your hips off the floor into a side plank', 'Hips up');
    if (!f.seen([top.sh, top.wr], 0.45)) return partial('Keep your top arm in view', 'Top arm in view');
    const reach = f.d(top.sh, top.wr);
    if (f.v(top.el) >= 0.4 && f.ang(top.sh, top.el, top.wr) >= 150) this.armRef = this.armRef == null ? reach : this.armRef + (reach > this.armRef ? 0.3 : 0.02) * (reach - this.armRef);
    const arm = Math.max(this.armRef ?? 0, 1.1 * torso);
    const h = dot(sub(f.p(top.wr), f.p(top.sh)), n) / arm;
    const faults = [];
    if (hipOff < -o.sagBy) faults.push('sag');
    else if (hipOff > o.pikeBy) faults.push('pike');
    return {
      status: 'active',
      progress: (o.upH - h) / (o.upH - o.underH),
      faults,
      side: top.key,
      stats: [
        { label: 'Reach', value: `${Math.round(clamp01((o.upH - h) / (o.upH - o.underH)) * 100)}%` },
        { label: 'Hips', value: hipOff < -o.sagBy ? 'low' : hipOff > o.pikeBy ? 'high' : 'level', fault: 'sag|pike' },
      ],
      overlay: [dash(LEFT.sh, low.ank ?? LEFT.ank), seg(low.sh, low.hip, 'fault:sag|pike', 6), seg(top.sh, top.el), seg(top.el, top.wr), dots([top.sh, top.wr])],
    };
  }
}

/**
 * Ab wheel rollouts, side-on: kneeling or standing, to a wall or all the way
 * out, and standing negatives (lower slowly, then drop to the knees). Progress
 * needs both the arms going overhead and the hips opening, so reaching with
 * the arms alone or dropping the hips alone doesn't count. The lower back
 * must not sag, the arms stay straight, and on the way back the arms pull —
 * the hips don't push back first.
 */
export class RolloutAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    stance: 'kneel', // 'kneel' | 'stand'
    reach: 'full', // 'wall' (the wall stops you short) | 'full'
    sagWarn: 0.1, // hips below the shoulder–knee line (torso lengths)
    sagBlock: 0.2,
    elbowWarn: 150,
    elbowBlock: 135,
    hipsFirst: 0.45,
    minRepMs: 800,
  };
  static statLabels = ['Arms', 'Hips'];
  static meterLabel = 'extension';
  static tempo = ['out ', ' in '];
  static text = {
    noPerson: 'Set up side-on to the camera with the wheel',
    toStart: 'Start with the wheel under your shoulders',
    ready: 'Ready — tuck your tailbone and roll out',
    going: (pct) => `Roll out… ${pct}%`,
    reached: 'Out — pull back with straight arms',
    notCounted: 'Not counted — roll out further',
    notCountedVoice: 'Further',
    incomplete: { rep: 'roll all the way back in', voice: 'All the way back' },
    faults: {
      sag: { live: 'Tuck your tailbone — don’t let your back sag', rep: 'lower back sagged', voice: 'Tuck', cue: 'Tuck your hips', miss: 'Not counted — your lower back sagged; tuck your tailbone and squeeze your glutes', missVoice: 'Tuck your hips' },
      elbows: { live: 'Keep your arms straight', rep: 'bent the elbows', voice: 'Straight arms', cue: 'Straight arms', miss: 'Not counted — keep your arms straight', missVoice: 'Straight arms' },
      hipsFirst: { rep: 'pushed the hips back first — pull with your arms', voice: 'Pull with your arms' },
      stand: { rep: 'started on the knees', miss: 'Not counted — start each negative standing', missVoice: 'Start standing' },
      fast: { rep: 'fell into the bottom', voice: 'Slower', miss: 'Not counted — lower slowly, fighting the whole way down', missVoice: 'Slower' },
    },
  };

  get targets() {
    const o = this.opts;
    const full = o.reach === 'full';
    return {
      sa: [o.stance === 'stand' ? 70 : 80, full ? 152 : 135],
      ha: [o.stance === 'stand' ? 75 : 105, full ? 155 : 145],
    };
  }

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'wr', 'hip', 'knee']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip, S.knee], 0.45)) return partial('Turn side-on so I can see your arms, hips and knees', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), knee = f.p(S.knee), wr = f.p(S.wr);
    if (wr.y < sh.y) return setup('Hands on the wheel, on the floor in front of you', 'Hands on the wheel');
    // Standing: the shins are upright (knee well above the ankle). Kneeling, they lie on the floor.
    const standing = f.v(S.ank) >= 0.4 ? f.p(S.ank).y - knee.y > 0.6 * (f.d(S.knee, S.ank) || 1) : false;
    if (this.phase !== 'down' && o.stance === 'kneel' && standing && !o.negativeMs) return setup('Kneel on a pad with the wheel under your shoulders', 'Kneel down');
    if (this.phase === 'setup' && o.stance === 'stand' && !standing) return setup('Stand with your legs nearly straight, wheel on the floor', 'Stand up');
    const sa = f.ang(S.hip, S.sh, S.wr);
    const ha = f.ang(S.sh, S.hip, S.knee);
    const T = this.targets;
    const progress = Math.min((sa - T.sa[0]) / (T.sa[1] - T.sa[0]), (ha - T.ha[0]) / (T.ha[1] - T.ha[0]));
    const torso = f.d(S.sh, S.hip) || 1;
    // Hips dropping below the shoulder–knee line = the lower back sagging.
    const down = upNormal(sub(knee, sh));
    const sag = -dot(sub(hip, sh), down) / torso;
    const elbow = f.ang(S.sh, S.el, S.wr);
    const faults = [];
    if (progress > 0.4 && sag > o.sagWarn) faults.push('sag');
    if (elbow < o.elbowWarn) faults.push('elbows');
    return {
      status: 'active',
      progress,
      faults,
      sa,
      ha,
      sag,
      elbow,
      standing,
      stats: [
        { label: 'Arms', value: deg(sa), fault: 'elbows' },
        { label: 'Hips', value: deg(ha), fault: 'sag' },
      ],
      overlay: [dash(S.sh, S.knee, 'fault:sag'), seg(S.sh, S.hip, 'fault:sag', 6), seg(S.hip, S.knee, 'fault:sag', 6), seg(S.sh, S.el, 'fault:elbows'), seg(S.el, S.wr, 'fault:elbows'), dots([S.sh, S.hip, S.wr])],
    };
  }

  repState(m) {
    return { maxSag: m.sag, minElbow: m.elbow, startStanding: m.standing, sa0: m.sa, ha0: m.ha, saMax: m.sa, haMax: m.ha, hipsFirst: false };
  }

  trackRep(r, m, p) {
    r.maxSag = Math.max(r.maxSag, p > 0.4 ? m.sag : -Infinity);
    r.minElbow = Math.min(r.minElbow, m.elbow);
    if (m.sa > r.saMax) r.saMax = m.sa;
    if (m.ha > r.haMax) r.haMax = m.ha;
    if (this.lastSeen > r.maxAt && r.max >= 0.6) {
      const back = (x, max, start) => (max - x) / Math.max(1, max - start);
      if (back(m.ha, r.haMax, r.ha0) - back(m.sa, r.saMax, r.sa0) > this.opts.hipsFirst) r.hipsFirst = true;
    }
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.maxSag > o.sagBlock) out.push('sag');
    if (r.minElbow < o.elbowBlock) out.push('elbows');
    if (o.stance === 'stand' && o.negativeMs && !r.startStanding) out.push('stand');
    return out;
  }

  repIssues(r) {
    return r.hipsFirst ? ['hipsFirst'] : [];
  }
}

/**
 * Hollow body rocks (on your back) and arch body rocks (face down), side-on.
 * A rep is one rock from one end to the other and back, measured on the tilt
 * of the shoulder–ankle line. The shape has to hold: bending at the hips to
 * keep the rock going doesn't count.
 */
export class RockAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    shape: 'hollow', // 'hollow' | 'arch'
    amp: 12, // tilt change end to end (deg)
    shapeRange: 20, // hip angle changing more than this in a rep = bending, not rocking
    armsWarn: 140,
    minRepMs: 500,
  };
  static statLabels = ['Rock', 'Shape'];
  static meterLabel = 'rock';
  static tempo = ['→', '←'];
  static text = {
    noPerson: 'Lie down side-on to the camera',
    toStart: 'Get into the hold, then start rocking',
    ready: 'Ready — rock head to toe',
    going: (pct) => `Rock… ${pct}%`,
    reached: 'Now rock back',
    notCounted: 'Not counted — rock further, keeping the same shape',
    notCountedVoice: 'Bigger rocks',
    incomplete: { rep: 'rock all the way back', voice: 'All the way back' },
    faults: {
      shape: { rep: 'bent at the hips', miss: 'Not counted — hold the same shape; rock, don’t bend at the hips', missVoice: 'Hold the shape' },
      arms: { live: 'Arms overhead, by your ears', rep: 'arms dropped', voice: 'Arms overhead', cue: 'Arms overhead' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    super.reset();
  }

  resetFilters() {
    this.hi = null;
    this.dt = stepper();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'ank']);
    if (!f.seen([S.sh, S.hip, S.ank], 0.45)) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), ank = f.p(S.ank);
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const hollow = o.shape === 'hollow';
    if (Math.abs(elevation(sub(sh, ank))) > 45) return setup(hollow ? 'Lie on your back in a hollow hold' : 'Lie face down in an arch hold');
    if (chest && (hollow ? chest.y > 0.2 : chest.y < -0.2)) return setup(hollow ? 'Turn over — on your back' : 'Turn over — face down');
    // Tilt of the body: + when the shoulders are higher than the feet.
    const tilt = Math.atan2(ank.y - sh.y, Math.abs(sh.x - ank.x)) * DEG;
    const dt = this.dt(frame.t);
    if (this.hi == null || tilt > this.hi) this.hi = tilt;
    else if (this.phase !== 'down') this.hi -= Math.min(this.hi - tilt, 4 * dt);
    // Hollow and arch are both a curve with the hips lowest: they sit below the shoulder–ankle line.
    const curve = (hip.y - (sh.y + ((ank.y - sh.y) * (hip.x - sh.x)) / ((ank.x - sh.x) || 1))) / (f.d(S.sh, S.hip) || 1);
    const arms = f.v(S.wr) >= 0.4 ? f.ang(S.hip, S.sh, S.wr) : 180;
    if (this.phase !== 'down' && (curve < 0.08 || arms < 120)) {
      return setup(hollow ? 'Get into the hollow hold: arms overhead, shoulders and legs up' : 'Get into the arch hold: arms overhead, chest and legs up', hollow ? 'Hollow hold, arms overhead' : 'Arch hold, arms overhead');
    }
    const shape = f.ang(S.sh, S.hip, S.ank);
    const faults = hollow && arms < o.armsWarn ? ['arms'] : [];
    return {
      status: 'active',
      progress: (this.hi - tilt) / o.amp,
      faults,
      shape,
      stats: [
        { label: 'Rock', value: deg(this.hi - tilt) },
        { label: 'Shape', value: deg(shape), fault: 'shape' },
      ],
      overlay: [dash(S.sh, S.ank), seg(S.sh, S.hip, 'fault:shape', 6), seg(S.hip, S.ank, 'fault:shape', 6), dots([S.sh, S.hip, S.ank])],
    };
  }

  repState(m) {
    return { shapeMin: m.shape, shapeMax: m.shape };
  }

  trackRep(r, m) {
    r.shapeMin = Math.min(r.shapeMin, m.shape);
    r.shapeMax = Math.max(r.shapeMax, m.shape);
  }

  repBlocks(r) {
    return r.shapeMax - r.shapeMin > this.opts.shapeRange ? ['shape'] : [];
  }
}

/**
 * Reverse hyperextensions, face down on a flat bench with the hips at the
 * end, side-on. Progress is the straight legs rising from hanging to level
 * with the body. Legs stay straight; lifting past level by arching is called
 * out; swinging up is flagged.
 */
export class ReverseHyperAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    from: 100,
    to: 170,
    countAt: 0.93,
    kneeBlock: 140,
    archBy: 12, // legs above the line of the body (deg)
    minConMs: 350,
    eccentric: 'up',
    minEccMs: 0,
  };
  static statLabels = ['Legs', 'Knees'];
  static meterLabel = 'lift';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie face down on the bench, side-on, hips at the end',
    toStart: 'Let your legs hang down to start',
    ready: 'Ready — squeeze your glutes and lift your legs',
    going: (pct) => `Lift… ${pct}%`,
    reached: 'Level — lower with control',
    notCounted: 'Not counted — lift your legs until they’re level with your body',
    notCountedVoice: 'Lift higher',
    incomplete: { rep: 'lower your legs all the way down', voice: 'All the way down' },
    faults: {
      knees: { rep: 'bent the knees', miss: 'Not counted — keep your legs straight; lift from the hips', missVoice: 'Straight legs' },
      arch: { live: 'Stop at body level — don’t arch your back', rep: 'lifted past level', voice: 'Stop at level', cue: 'Stop at level' },
      swing: { rep: 'swung the legs up', voice: 'Control it' },
      fast: { rep: 'dropped the weight — lower slowly', voice: 'Slower down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee', 'ank']);
    if (!f.seen([S.sh, S.hip, S.knee, S.ank], 0.45)) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), ank = f.p(S.ank);
    const body = sub(hip, sh);
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    if (Math.abs(elevation(body)) > 35 || (chest && chest.y < -0.2)) return setup('Lie face down on the bench, hips at the end', 'Face down on the bench');
    const legs = f.ang(S.sh, S.hip, S.ank);
    // Legs above the line of the torso (toward the ceiling) = arching.
    const leg = sub(ank, hip);
    const above = legs > 150 && dot(leg, upNormal(body)) > 0 ? 180 - legs : 0;
    const kneeAng = f.ang(S.hip, S.knee, S.ank);
    const faults = above > o.archBy ? ['arch'] : [];
    return {
      status: 'active',
      progress: (legs - o.from) / (o.to - o.from),
      faults,
      kneeAng,
      stats: [
        { label: 'Legs', value: deg(legs), fault: 'arch' },
        { label: 'Knees', value: deg(kneeAng), fault: 'knees' },
      ],
      overlay: [dash(S.sh, S.hip), seg(S.hip, S.knee, 'fault:knees|arch'), seg(S.knee, S.ank, 'fault:knees|arch'), arc(S.sh, S.hip, S.ank, deg(legs)), dots([S.hip, S.knee, S.ank])],
    };
  }

  repState(m) {
    return { minKnee: m.kneeAng };
  }

  trackRep(r, m, p) {
    if (p > 0.3) r.minKnee = Math.min(r.minKnee, m.kneeAng);
  }

  repBlocks(r) {
    return r.minKnee < this.opts.kneeBlock ? ['knees'] : [];
  }

  repIssues(r) {
    return r.maxAt - r.from < this.opts.minConMs ? ['swing'] : [];
  }
}

