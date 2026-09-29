import { P, SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, ChestSide, Baseline, LEFT, RIGHT, sub, unit, fromUp, partial, setup, seg, dash, arc, dots, deg, sideSwitched } from './kit.js';

/**
 * Hanging from a bar. The bar is where the hands are; heights are measured
 * down from it in arm lengths (learned while the arms are straight), so they
 * read the same close up or far away, from the front, back or side.
 */
class Hanging extends RepCounter {
  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.armRef = null;
    this.restElbow = 0;
    super.reset();
  }

  /** Shared hanging geometry, or `out` with a status to report. */
  hang(frame) {
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    const arms = [LEFT, RIGHT].filter((A) => f.seen([A.sh, A.el, A.wr]));
    if (!arms.length || !f.seen([S.sh, S.hip])) return { out: partial('Step back so I can see your hands on the bar and your body', 'Step back') };
    const bar = Math.min(...arms.map((A) => f.p(A.wr).y));
    const shY = arms.reduce((s, A) => s + f.p(A.sh).y, 0) / arms.length;
    const torso = f.d(S.sh, S.hip) || 1;
    const headY = f.v(P.nose) >= 0.5 ? f.p(P.nose).y : null;
    // Hands above the shoulders; to start a rep, clearly hanging below them.
    if (shY - bar < (this.phase === 'down' ? 0 : 0.5 * torso)) return { out: setup('Hang from the bar with straight arms', 'Hang from the bar') };
    // The body hangs down from the hands: lying down with the arms up (a bench press) isn't hanging.
    if (fromUp(sub(f.p(S.sh), f.p(S.hip))) > 50) return { out: setup('Hang from the bar with straight arms', 'Hang from the bar') };
    // 3D: side-on, a wide-grip arm bends across the camera and looks straight in 2D.
    const elbows = arms.map((A) => f.ang3(A.sh, A.el, A.wr));
    const elbow = Math.min(...elbows);
    for (const [k, A] of arms.entries()) {
      if (elbows[k] >= 155) {
        const reach = f.d(A.sh, A.wr);
        this.armRef = this.armRef == null ? reach : this.armRef + (reach > this.armRef ? 0.3 : 0.02) * (reach - this.armRef);
      }
    }
    const arm = Math.max(this.armRef ?? 0, 1.1 * torso);
    if (this.phase !== 'down') this.restElbow = Math.max(this.restElbow, elbow);
    const barX = arms.reduce((s, A) => s + f.p(A.wr).x, 0) / arms.length;
    return { f, S, arms, bar, barX, shY, torso, arm, elbow, headY };
  }

  repState() {
    const startElbow = this.restElbow;
    this.restElbow = 0;
    return { startElbow };
  }
}

/**
 * Pull-ups and chin-ups. Filmed from the front, back or side. Progress is
 * the shoulders rising toward the bar; with the face in view, the rep also
 * needs the chin over the bar. A rep must start from a dead hang (straight
 * arms), come back to one, and can't be kipped: swinging the hips or kicking
 * the legs doesn't count.
 */
export class PullUpAnalyzer extends Hanging {
  static defaults = {
    hangS: 0.9, // shoulders below the bar (arm lengths) at a dead hang
    topS: 0.32, // ...with the chin over the bar
    chinClear: 0.08, // nose this far above the bar (arm lengths) = chin over it
    craneS: 0.55, // chin over the bar with the shoulders still this low = craning the neck
    lockout: 140, // a dead hang reads ~145–160° on camera (a half rep's bottom is ~120°)
    finishAt: 0.12,
    strictBack: 0.25,
    kipRange: 35, // hip or knee angle changing this much in a rep = kicking
    swingWarn: 0.25, // hips this far in front of / behind the bar (arm lengths)
    barMove: 0.3, // hands moving more than this (arm lengths) = not hanging from a bar
    bodyRise: 0.3, // the shoulders must rise at least this much on screen (arm lengths)
    swingBlock: 0.45,
    eccentric: 'up',
    minEccMs: 600,
  };
  static statLabels = ['Height', 'Elbows'];
  static meterLabel = 'height';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Step back so I can see you hanging from the bar',
    toStart: 'Start from a dead hang — arms straight',
    ready: 'Ready — pull your chin over the bar',
    going: (pct) => `Pull… ${pct}%`,
    reached: 'Chin over the bar — lower under control',
    notCounted: 'Not counted — pull until your chin clears the bar',
    notCountedVoice: 'Chin over the bar',
    incomplete: { rep: 'lower all the way to straight arms', voice: 'All the way down', miss: 'Not counted — lower all the way to straight arms between reps', missVoice: 'All the way down' },
    faults: {
      hang: { rep: 'didn’t start from a dead hang', miss: 'Not counted — start each rep from straight arms', missVoice: 'Full hang' },
      kip: { rep: 'kicked or swung up', miss: 'Not counted — no kicking or swinging; pull with your arms', missVoice: 'No kipping' },
      crane: { rep: 'reached with the chin', miss: 'Not counted — pull your body up, don’t just reach with your chin', missVoice: 'Pull higher' },
      bar: { rep: 'hands moved', miss: 'Not counted — keep your hands on the bar and pull your body up', missVoice: 'Pull your body up' },
      swing: { live: 'Stop swinging — keep your body still', rep: 'body swung', voice: 'Stay still', cue: 'Stay still' },
      fast: { rep: 'dropped down — lower under control', voice: 'Slower down' },
    },
  };

  resetFilters() {
    this.headRest = new Baseline(0.2);
  }

  measure(frame) {
    const o = this.opts;
    const g = this.hang(frame);
    if (g.out) return g.out;
    const { f, S, bar, barX, shY, arm, elbow, headY } = g;
    const s = (shY - bar) / arm;
    let progress = (o.hangS - s) / (o.hangS - o.topS);
    let chin = null;
    if (headY != null) {
      // Nose height below the bar; the rep needs it above.
      const hd = (headY - bar) / arm;
      if (this.phase !== 'down' && elbow >= o.lockout) this.headRest.learn(hd);
      const rest = Math.max(0.2, this.headRest.value ?? 0.45);
      chin = (rest - hd) / (rest + o.chinClear);
      progress = chin;
    }
    // Where the shoulders hang at rest (a dead hang), for "did the body really go up".
    if (this.phase !== 'down' && progress < 0.15) this.restSh = shY / arm;
    const hipX = f.p(S.hip).x;
    const swing = Math.abs(hipX - barX) / arm;
    const faults = swing > o.swingWarn ? ['swing'] : [];
    const hipAng = f.v(S.knee) >= 0.4 ? f.ang3(S.sh, S.hip, S.knee) : null;
    const kneeAng = f.v(S.knee) >= 0.4 && f.v(S.ank) >= 0.4 ? f.ang3(S.hip, S.knee, S.ank) : null;
    return {
      status: 'active',
      progress,
      faults,
      s,
      elbow,
      swing,
      hipAng,
      kneeAng,
      barY: bar / arm,
      shAbs: shY / arm,
      stats: [
        { label: 'Height', value: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` },
        { label: 'Elbows', value: deg(elbow) },
      ],
      overlay: [
        dash({ x: barX / f.w - 0.15, y: bar / f.h }, { x: barX / f.w + 0.15, y: bar / f.h }),
        ...g.arms.flatMap((A) => [seg(A.sh, A.el), seg(A.el, A.wr), dots([A.sh, A.el, A.wr])]),
        seg(S.sh, S.hip, 'fault:swing', 5),
      ],
    };
  }

  repState(m, prev) {
    const start = prev ? prev.backM : m;
    return {
      ...super.repState(m, prev),
      minS: m.s,
      maxSwing: m.swing,
      hip: [m.hipAng, m.hipAng],
      knee: [m.kneeAng, m.kneeAng],
      bar0: start.barY,
      barMove: 0,
      sh0: prev ? start.shAbs : Math.max(start.shAbs, this.restSh ?? -Infinity),
      shTop: m.shAbs,
    };
  }

  trackRep(r, m) {
    r.minS = Math.min(r.minS, m.s);
    r.maxSwing = Math.max(r.maxSwing, m.swing);
    r.barMove = Math.max(r.barMove, Math.abs(m.barY - r.bar0));
    r.shTop = Math.min(r.shTop, m.shAbs);
    for (const [k, v] of [['hip', m.hipAng], ['knee', m.kneeAng]]) {
      if (v == null) continue;
      r[k] = [Math.min(r[k][0] ?? v, v), Math.max(r[k][1] ?? v, v)];
    }
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.startElbow < o.lockout) out.push('hang');
    const range = (a) => (a[0] == null ? 0 : a[1] - a[0]);
    if (range(r.hip) > o.kipRange || range(r.knee) > o.kipRange + 10 || r.maxSwing > o.swingBlock) out.push('kip');
    if (r.max >= this.countAt && r.minS > o.craneS) out.push('crane');
    // A pull-up moves the body to the bar; the bar (the hands) doesn't come down to the body.
    if (r.barMove > o.barMove || r.sh0 - r.shTop < o.bodyRise) out.push('bar');
    return out;
  }

  canFinish(m) {
    return m.elbow >= this.opts.lockout;
  }

  repDetail(r) {
    return `shoulders ${Math.round(r.minS * 100)}% of an arm below the bar`;
  }
}

/**
 * Scapular pulls: in a dead hang, pull the shoulders down away from the ears
 * so the body rises an inch or two, elbows locked. Progress is how far the
 * head and hips rise relative to the hands, from the passive hang.
 */
export class ScapPullAnalyzer extends Hanging {
  static defaults = {
    target: 0.05, // rise of the head and hips, in arm lengths (~3 cm)
    lockout: 145,
    kipRange: 25,
    minTopMs: 400,
    minRepMs: 700,
    eccentric: 'up',
  };
  static statLabels = ['Rise', 'Elbows'];
  static meterLabel = 'rise';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Step back so I can see you hanging from the bar',
    toStart: 'Hang with straight arms and relaxed shoulders to start',
    ready: 'Ready — pull your shoulders down, arms straight',
    going: (pct) => `Down and back… ${pct}%`,
    reached: 'Hold it — then lower slowly',
    notCounted: 'Not counted — pull your shoulders down further so your body rises',
    notCountedVoice: 'Shoulders down',
    incomplete: { rep: 'relax back into the hang', voice: 'Relax down' },
    faults: {
      bent: { rep: 'elbows bent', miss: 'Not counted — keep your elbows locked; only your shoulder blades move', missVoice: 'Straight arms' },
      kip: { rep: 'legs swung', miss: 'Not counted — no swinging or kicking', missVoice: 'No swinging' },
      hold: { rep: 'pause a second at the top', voice: 'Pause at the top' },
    },
  };

  resetFilters() {
    this.low = { head: null, hip: null };
    this.lastT = null;
  }

  /** The passive hang is the lowest the body gets: a low-water mark that creeps up slowly between reps. */
  lowWater(key, v, dt) {
    const cur = this.low[key];
    if (cur == null || v < cur) this.low[key] = v;
    else if (this.phase !== 'down') this.low[key] += Math.min(v - cur, 0.01 * dt);
    return v - this.low[key];
  }

  measure(frame) {
    const o = this.opts;
    const g = this.hang(frame);
    if (g.out) return g.out;
    const { f, S, bar, arm, elbow } = g;
    if (sideSwitched(this, S)) this.resetFilters();
    if (elbow < 120) return setup('Straighten your arms — this is done in a dead hang', 'Straight arms');
    // A rise of a few centimetres: it needs a big enough picture.
    if (arm < 150) return partial('Move the phone closer — I need a bigger view of you', 'Move closer');
    const dt = this.lastT == null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    // In arm lengths: the arm doesn't change length here, the torso (shoulder to hip) does.
    const ear = [S.ear, P.nose].find((i) => f.v(i) >= 0.5);
    const rises = [this.lowWater('hip', (bar - f.p(S.hip).y) / arm, dt)];
    if (ear != null) rises.push(this.lowWater('head', (bar - f.p(ear).y) / arm, dt));
    const rise = rises.reduce((a, b) => a + b, 0) / rises.length;
    const hipAng = f.v(S.knee) >= 0.4 ? f.ang3(S.sh, S.hip, S.knee) : null;
    return {
      status: 'active',
      progress: rise / o.target,
      faults: [],
      elbow,
      hipAng,
      stats: [
        { label: 'Rise', value: `${Math.round(rise * 100)}%` },
        { label: 'Elbows', value: deg(elbow), fault: 'bent' },
      ],
      overlay: [...g.arms.flatMap((A) => [seg(A.sh, A.el), seg(A.el, A.wr)]), seg(S.sh, S.hip), dots([S.sh, S.hip])],
    };
  }

  repState(m, prev) {
    return { ...super.repState(m, prev), minElbow: m.elbow, hip: [m.hipAng, m.hipAng], topMs: 0, lastT: null };
  }

  trackRep(r, m, p) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    if (m.hipAng != null) r.hip = [Math.min(r.hip[0] ?? m.hipAng, m.hipAng), Math.max(r.hip[1] ?? m.hipAng, m.hipAng)];
    const t = this.lastSeen;
    if (p >= 0.85 && r.lastT != null) r.topMs += t - r.lastT;
    r.lastT = t;
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.minElbow < o.lockout) out.push('bent');
    if (r.hip[0] != null && r.hip[1] - r.hip[0] > o.kipRange) out.push('kip');
    return out;
  }

  repIssues(r) {
    return r.topMs < this.opts.minTopMs ? ['hold'] : [];
  }
}

/**
 * Arch hangs, side-on: from a dead hang, press the bar toward the hips so the
 * chest rises and the upper back arches, arms nearly straight. Progress is
 * the torso tilting back (chest turning up toward the bar). Rowing up with
 * bent arms or kicking the legs forward doesn't count.
 */
export class ArchHangAnalyzer extends Hanging {
  static sideOnly = true;
  static defaults = {
    target: 25, // torso tilt back from hanging straight (deg)
    bentBlock: 120,
    kickFwd: 30, // thighs swung this far forward of hanging straight down (deg) = kicking
    minTopMs: 800,
    minRepMs: 900,
    eccentric: 'up',
  };
  static statLabels = ['Arch', 'Elbows'];
  static meterLabel = 'arch';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Hang side-on to the camera',
    toStart: 'Start from a dead hang',
    ready: 'Ready — shoulders down, chest up to the bar',
    going: (pct) => `Chest up… ${pct}%`,
    reached: 'Hold the arch — a second or two',
    notCounted: 'Not counted — lift your chest toward the bar and arch your upper back',
    notCountedVoice: 'Chest up',
    incomplete: { rep: 'lower back into the hang', voice: 'Back to the hang' },
    faults: {
      bent: { rep: 'rowed up with bent arms', miss: 'Not counted — arms stay almost straight; press the bar toward your hips', missVoice: 'Straight arms' },
      kick: { rep: 'kicked the legs forward', miss: 'Not counted — don’t kick your legs forward; keep them trailing', missVoice: 'Legs back' },
      hold: { rep: 'hold the top for a second or two', voice: 'Hold the top' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const g = this.hang(frame);
    if (g.out) return g.out;
    const { f, S, elbow } = g;
    const torso = sub(f.p(S.sh), f.p(S.hip));
    const chest = this.chest.update(f, S, unit(torso));
    if (!chest) return partial('Turn side-on so I can see your chest and back', 'Turn side on');
    // Chest turning to face up: its normal rises above horizontal.
    const tilt = Math.asin(Math.max(-1, Math.min(1, -chest.y))) * (180 / Math.PI);
    // Thighs swinging forward of hanging straight down (toward the chest side) = kicking.
    let legFwd = 0;
    if (f.v(S.knee) >= 0.4) {
      const th = unit(sub(f.p(S.knee), f.p(S.hip)));
      legFwd = Math.atan2(th.x * Math.sign(chest.x || 1), th.y) * (180 / Math.PI);
    }
    return {
      status: 'active',
      progress: tilt / o.target,
      faults: [],
      elbow,
      kick: legFwd > o.kickFwd,
      stats: [
        { label: 'Arch', value: deg(Math.max(0, tilt)) },
        { label: 'Elbows', value: deg(elbow), fault: 'bent' },
      ],
      overlay: [...g.arms.flatMap((A) => [seg(A.sh, A.el), seg(A.el, A.wr)]), seg(S.sh, S.hip), dots([S.sh, S.hip])],
    };
  }

  repState(m, prev) {
    return { ...super.repState(m, prev), minElbow: m.elbow, kick: m.kick, topMs: 0, lastT: null };
  }

  trackRep(r, m, p) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.kick ||= m.kick;
    const t = this.lastSeen;
    if (p >= 0.85 && r.lastT != null) r.topMs += t - r.lastT;
    r.lastT = t;
  }

  repBlocks(r) {
    const out = [];
    if (r.minElbow < this.opts.bentBlock) out.push('bent');
    if (r.kick) out.push('kick');
    return out;
  }

  repIssues(r) {
    return r.topMs < this.opts.minTopMs ? ['hold'] : [];
  }
}

/**
 * Hanging leg raises (weighted or not), side-on. Progress is the hip angle
 * closing from a straight hang to the legs past level; the feet have to get
 * above hip height, the legs have to stay straight (bent knees make it a knee
 * raise) and swinging the body doesn't count.
 */
export class HangingLegRaiseAnalyzer extends Hanging {
  static sideOnly = true;
  static defaults = {
    from: 175,
    to: 85,
    levelBy: 0.05, // feet no lower than this below the hips at the top (torso lengths)
    kneeWarn: 145,
    kneeBlock: 115,
    swingWarn: 20, // torso tipped from hanging straight (deg)
    swingBlock: 38,
    minPauseMs: 400,
    eccentric: 'up',
    minEccMs: 600,
  };
  static statLabels = ['Hips', 'Knees'];
  static meterLabel = 'raise';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Hang from the bar, side-on to the camera',
    toStart: 'Start hanging still with your legs down',
    ready: 'Ready — raise your legs past level',
    going: (pct) => `Raise… ${pct}%`,
    reached: 'Past level — lower slowly',
    notCounted: 'Not counted — raise your legs past level',
    notCountedVoice: 'Higher',
    incomplete: { rep: 'lower all the way down', voice: 'All the way down', miss: 'Not counted — lower your legs all the way each rep', missVoice: 'All the way down' },
    faults: {
      level: { rep: 'feet stayed below hip height', miss: 'Not counted — get your feet above hip height', missVoice: 'Higher' },
      knees: { rep: 'knees bent — that was a knee raise', miss: 'Not counted — straighten your legs; bent knees make it a knee raise', missVoice: 'Straight legs' },
      bent: { live: 'Keep your legs straighter', rep: 'knees bent', voice: 'Straight legs', cue: 'Straight legs' },
      swing: { live: 'Stop swinging — pause at the bottom', rep: 'body swung', voice: 'No swinging', cue: 'Stop swinging', miss: 'Not counted — you swung the legs up; stop the swing first', missVoice: 'No swinging' },
      pause: { rep: 'no pause at the bottom', voice: 'Pause at the bottom' },
      fast: { rep: 'dropped the legs', voice: 'Slower down' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const g = this.hang(frame);
    if (g.out) return g.out;
    const { f, S, torso } = g;
    const foot = f.v(S.ank) >= 0.4 ? S.ank : f.v(S.knee) >= 0.4 ? S.knee : null;
    if (foot == null) return partial('Step back so I can see your legs', 'Step back');
    const hipAng = f.ang(S.sh, S.hip, foot);
    const kneeAng = foot === S.ank && f.v(S.knee) >= 0.4 ? f.ang(S.hip, S.knee, S.ank) : 180;
    const lean = fromUp(sub(f.p(S.sh), f.p(S.hip)));
    const below = (f.p(foot).y - f.p(S.hip).y) / torso;
    const progress = (o.from - hipAng) / (o.from - o.to);
    const faults = [];
    if (progress > 0.5 && kneeAng < o.kneeWarn) faults.push('bent');
    if (lean > o.swingWarn) faults.push('swing');
    return {
      status: 'active',
      progress,
      faults,
      kneeAng,
      lean,
      below,
      stats: [
        { label: 'Hips', value: deg(hipAng) },
        { label: 'Knees', value: deg(kneeAng), fault: 'bent' },
      ],
      overlay: [
        dash({ x: f.lm[S.hip].x - 0.12, y: f.lm[S.hip].y }, { x: f.lm[S.hip].x + 0.12, y: f.lm[S.hip].y }),
        seg(S.sh, S.hip, 'fault:swing', 5),
        seg(S.hip, S.knee, 'fault:bent'),
        seg(S.knee, S.ank, 'fault:bent'),
        arc(S.sh, S.hip, foot, deg(hipAng)),
        dots([S.hip, S.knee, S.ank]),
      ],
    };
  }

  repState(m, prev) {
    return { ...super.repState(m, prev), minBelow: m.below, minKnee: m.kneeAng, maxLean: m.lean };
  }

  trackRep(r, m, p) {
    r.minBelow = Math.min(r.minBelow, m.below);
    if (p > 0.35) r.minKnee = Math.min(r.minKnee, m.kneeAng);
    r.maxLean = Math.max(r.maxLean, m.lean);
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.maxLean > o.swingBlock) out.push('swing');
    if (r.minKnee < o.kneeBlock) out.push('knees');
    if (r.max >= this.countAt && r.minBelow > o.levelBy) out.push('level');
    return out;
  }
}

