import { SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, ChestSide, Baseline, sub, dot, unit, len, upNormal, fromUp, tiltOf, partial, setup, seg, dash, arc, dots, deg, DEG } from './kit.js';

/** Signed angle of the upper arm from hanging straight down; + = elbow in front of the body. */
function armSwing(f, S, chest) {
  const ua = unit(sub(f.p(S.el), f.p(S.sh)));
  const ang = Math.acos(Math.max(-1, Math.min(1, ua.y))) * DEG; // 0 = straight down
  if (!chest) return ang;
  return dot(ua, { x: Math.sign(chest.x) || 1, y: 0 }) >= 0 ? ang : -ang;
}

/**
 * Preacher curls, filmed side-on with the working arm toward the camera.
 * The upper arm lies on the 45° pad; progress is the elbow closing from
 * nearly straight (160°) to the forearm upright (about 55°). The upper arm
 * has to stay put: lifting it off the pad to swing the weight doesn't count.
 */
export class PreacherCurlAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    rest: 160,
    top: 55,
    finishAt: 0.1, // back to an almost straight arm, ~150°
    maxArmMove: 22, // upper arm leaving its line on the pad (deg)
    maxSway: 12,
    eccentric: 'up',
    minEccMs: 900,
  };
  static statLabels = ['Elbow', 'Upper arm'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Stand behind the bench, side-on to the camera, working arm nearest',
    toStart: 'Lower to an almost straight arm to start',
    ready: 'Ready — curl the weight up',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Forearm upright — now lower slowly',
    notCounted: 'Not counted — curl until your forearm is upright',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'lower all the way to an almost straight arm', voice: 'All the way down', miss: 'Not counted — lower to an almost straight arm each rep', missVoice: 'All the way down' },
    faults: {
      lift: { rep: 'upper arm came off the pad', miss: 'Not counted — keep your upper arm flat on the pad', missVoice: 'Arm on the pad' },
      up: { rep: 'the weight didn’t come up', miss: 'Not counted — curl the weight up until your forearm is upright', missVoice: 'Curl it up' },
      body: { live: 'Keep your chest against the pad — don’t swing', rep: 'body swung', voice: 'Stay still', cue: 'Stay still' },
      fast: { rep: 'dropped at the bottom — control it', voice: 'Slower down', miss: 'Not counted — control the bottom' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.leanBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr']);
    if (!f.seen([S.sh, S.el, S.wr])) return partial('Turn side-on with your working arm toward the camera', 'Turn side on');
    // Sitting or standing at the pad: lying on a bench (a press) is something else.
    const lean = f.v(S.hip) >= 0.5 ? fromUp(sub(f.p(S.sh), f.p(S.hip))) : null;
    if (lean != null && lean > 60) return setup('Sit at the preacher bench with your chest against the pad', 'Sit at the pad');
    const armDir = fromUp(sub(f.p(S.el), f.p(S.sh)));
    if (armDir > 162) return setup('Drape your upper arm over the pad', 'Arm over the pad');
    if (armDir < 90) return setup('Rest the back of your upper arm on the pad, sloping down', 'Arm on the pad');
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (lean != null && this.phase !== 'down') this.leanBase.learn(lean);
    const faults = [];
    if (lean != null && this.leanBase.value != null && Math.abs(lean - this.leanBase.value) > o.maxSway) faults.push('body');
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress: (o.rest - elbow) / (o.rest - o.top),
      faults,
      armDir,
      elbow,
      handUp: f.p(S.el).y - f.p(S.wr).y,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Upper arm', value: deg(180 - armDir), fault: 'lift' },
      ],
      overlay: [seg(S.sh, S.el, 'fault:lift', 7), seg(S.el, S.wr), arc(S.sh, S.el, S.wr, `${e}°`), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { armStart: m.armDir, armMove: 0, minElbow: m.elbow, handUp: m.handUp };
  }

  trackRep(r, m) {
    r.armMove = Math.max(r.armMove, Math.abs(m.armDir - r.armStart));
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.handUp = Math.max(r.handUp, m.handUp);
  }

  repBlocks(r) {
    const out = [];
    if (r.armMove > this.opts.maxArmMove) out.push('lift');
    // A curl brings the hand up over the elbow; pushing the body down onto the hands doesn't.
    if (r.handUp <= 0) out.push('up');
    return out;
  }

  repDetail(r) {
    return `elbow ${Math.round(r.minElbow)}° at the top`;
  }
}

/**
 * Incline dumbbell curls on a 55° bench, side-on. Arms hang straight down
 * behind the body; the stretch at the bottom is the point, so the elbows
 * must stay back — swinging them forward doesn't count.
 */
export class InclineCurlAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    rest: 165,
    top: 60,
    fwdWarn: 20, // elbow forward of hanging straight down (deg)
    fwdBlock: 35,
    maxSway: 10,
    eccentric: 'up',
    minEccMs: 700,
  };
  static statLabels = ['Elbow', 'Upper arm'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Sit back on the incline bench, side-on to the camera',
    toStart: 'Let your arms hang straight down to start',
    ready: 'Ready — curl without moving your elbows forward',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Squeeze — now lower all the way to straight',
    notCounted: 'Not counted — curl all the way up',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'lower all the way to straight arms', voice: 'Full stretch', miss: 'Not counted — lower to straight arms; the stretch is the point', missVoice: 'Full stretch' },
    faults: {
      forward: { live: 'Keep your elbows back — let them hang', rep: 'elbows swung forward', voice: 'Elbows back', cue: 'Elbows back', miss: 'Not counted — your elbows came forward; keep them hanging back', missVoice: 'Elbows back' },
      shoulders: { live: 'Keep your head and shoulders on the pad', rep: 'shoulders came off the pad', voice: 'Shoulders back', cue: 'Shoulders back' },
      fast: { rep: 'lowered too fast', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.leanBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip])) return partial('Turn side-on so I can see your arm and hip', 'Turn side on');
    const torso = sub(f.p(S.sh), f.p(S.hip));
    const lean = fromUp(torso);
    const chest = this.chest.update(f, S, unit(torso));
    const slack = this.phase === 'down' ? 12 : 0;
    if (lean < 15 - slack) return setup('Lean back on the bench, set to about 55°', 'Lean back on the bench');
    if (lean > 62 + slack || (chest && chest.y > 0.2)) return setup('Sit back on the incline bench (about 55°)', 'Sit back on the bench');
    const swing = armSwing(f, S, chest);
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (this.phase !== 'down') this.leanBase.learn(lean);
    const faults = [];
    if (swing > o.fwdWarn) faults.push('forward');
    if (this.leanBase.value != null && this.leanBase.value - lean > o.maxSway) faults.push('shoulders');
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress: (o.rest - elbow) / (o.rest - o.top),
      faults,
      swing,
      elbow,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Upper arm', value: deg(swing), fault: 'forward' },
      ],
      overlay: [dash(S.hip, S.sh, 'fault:shoulders', 3), seg(S.sh, S.el, 'fault:forward', 7), seg(S.el, S.wr), arc(S.sh, S.el, S.wr, `${e}°`), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { maxSwing: m.swing };
  }

  trackRep(r, m) {
    r.maxSwing = Math.max(r.maxSwing, m.swing);
  }

  repBlocks(r) {
    return r.maxSwing > this.opts.fwdBlock ? ['forward'] : [];
  }
}

/**
 * Seated overhead triceps extensions (bench at 85°), side-on. The elbows
 * point up and stay there; progress is the elbow bending from straight
 * overhead down to a deep stretch behind the head (~75°). Dropping the
 * elbows forward turns it into a press, which doesn't count.
 */
export class OverheadExtensionAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    rest: 160,
    deep: 75,
    lockout: 150,
    driftWarn: 35, // upper arm tipped forward from vertical (deg)
    driftBlock: 55,
    maxArch: 12,
    minEccMs: 600,
  };
  static statLabels = ['Elbow', 'Upper arm'];
  static meterLabel = 'stretch';
  static text = {
    noPerson: 'Sit side-on to the camera with the dumbbell overhead',
    toStart: 'Straighten your arms overhead to start',
    ready: 'Ready — lower the weight behind your head',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Deep stretch — extend!',
    notCounted: 'Not counted — lower the weight further behind your head',
    notCountedVoice: 'Deeper',
    incomplete: { rep: 'straighten your arms at the top', voice: 'Lock out', miss: 'Not counted — straighten your arms all the way at the top', missVoice: 'Lock out' },
    faults: {
      drift: { live: 'Keep your elbows pointing up', rep: 'elbows drifted forward', voice: 'Elbows up', cue: 'Elbows up' },
      drop: { rep: 'elbows dropped — that was a press', miss: 'Not counted — keep your elbows up; only your forearms move', missVoice: 'Elbows up' },
      arch: { live: 'Keep your back flat against the pad', rep: 'arched your back', voice: 'Ribs down', cue: 'Ribs down' },
      fast: { rep: 'dropped into the stretch — lower with control', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.leanBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr']);
    if (!f.seen([S.sh, S.el, S.wr])) return partial('Turn side-on so I can see your arm', 'Turn side on');
    const armUp = fromUp(sub(f.p(S.el), f.p(S.sh)));
    if (armUp > (this.phase === 'down' ? 80 : 60)) return setup('Hold the dumbbell overhead with your elbows pointing up', 'Elbows up, weight overhead');
    const lean = f.v(S.hip) >= 0.5 ? fromUp(sub(f.p(S.sh), f.p(S.hip))) : null;
    if (lean != null && lean > 45) return setup('Sit up tall against the bench', 'Sit up tall');
    if (lean != null && this.phase !== 'down') this.leanBase.learn(lean);
    const elbow = f.ang(S.sh, S.el, S.wr);
    const faults = [];
    if (armUp > o.driftWarn) faults.push('drift');
    if (lean != null && this.leanBase.value != null && Math.abs(lean - this.leanBase.value) > o.maxArch) faults.push('arch');
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress: (o.rest - elbow) / (o.rest - o.deep),
      faults,
      armUp,
      elbow,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Upper arm', value: deg(armUp), fault: 'drift' },
      ],
      overlay: [seg(S.sh, S.el, 'fault:drift', 7), seg(S.el, S.wr), arc(S.sh, S.el, S.wr, `${e}°`), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { maxArm: m.armUp };
  }

  trackRep(r, m) {
    r.maxArm = Math.max(r.maxArm, m.armUp);
  }

  repBlocks(r) {
    return r.maxArm > this.opts.driftBlock ? ['drop'] : [];
  }

  canFinish(m) {
    return m.elbow >= this.opts.lockout;
  }
}

/**
 * Wrist curls and reverse wrist curls with the forearms flat on the bench,
 * side-on. Progress is the hand's angle above the forearm line, from
 * hanging below it (the weight rolled down) to curled up above it. The
 * forearms must stay on the bench.
 */
export class WristCurlAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    low: -25, // hand angle below the forearm line (deg) at the bottom
    high: 30, // ...and above it at the top
    finishAt: 0.1,
    maxForearmMove: 15,
    maxLift: 0.2, // wrist rising off the bench, in forearm lengths
    eccentric: 'up',
    minEccMs: 500,
    minRepMs: 350,
  };
  static statLabels = ['Wrist', 'Forearm'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Kneel side-on to the camera with your forearms on the bench',
    toStart: 'Let your hand drop below the bench edge to start',
    ready: 'Ready — curl your wrist up',
    going: (pct) => `Up… ${pct}%`,
    reached: 'Top — lower all the way down',
    notCounted: 'Not counted — bend your wrist all the way up',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'let your hand drop all the way down', voice: 'All the way down', miss: 'Not counted — lower your hand all the way each rep', missVoice: 'All the way down' },
    faults: {
      forearm: { rep: 'forearm came off the bench', miss: 'Not counted — keep your forearms flat on the bench; only your hands move', missVoice: 'Forearms down' },
      fast: { rep: 'lowered too fast', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['el', 'wr', 'index', 'pinky']);
    if (!f.seen([S.el, S.wr])) return partial('Turn side-on so I can see your forearm and hand', 'Turn side on');
    const tips = [S.index, S.pinky].filter((i) => f.v(i) >= 0.3);
    if (!tips.length) return partial('Move closer so I can see your hand', 'Move closer');
    const el = f.p(S.el), wr = f.p(S.wr);
    const fore = sub(wr, el);
    if (len(fore) < 80) return partial('Move the phone closer to your hands', 'Move closer');
    const foreTilt = tiltOf(fore);
    const flat = foreTilt <= (this.phase === 'down' ? 45 : 25);
    // Resting on the bench, the hand is well out in front of the shoulder (a weight held at the chest isn't).
    const out = f.v(S.sh) < 0.5 || f.d(S.sh, S.wr) >= 1.3 * len(fore);
    if (!flat || !out) return setup('Rest your forearms flat on the bench, hands past the edge', 'Forearms flat on the bench');
    const tip = tips.map((i) => f.p(i)).reduce((a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
    const hand = sub(tip, wr);
    const along = unit(fore);
    const up = upNormal(fore);
    const angle = Math.atan2(dot(hand, up), dot(hand, along)) * DEG;
    return {
      status: 'active',
      progress: (angle - o.low) / (o.high - o.low),
      faults: [],
      angle,
      foreTilt,
      wristY: wr.y,
      elbowPt: el,
      foreLen: len(fore),
      stats: [
        { label: 'Wrist', value: deg(angle) },
        { label: 'Forearm', value: deg(foreTilt), fault: 'forearm' },
      ],
      overlay: [seg(S.el, S.wr, 'neutral', 7), seg(S.wr, tips[0]), dots([S.el, S.wr])],
    };
  }

  repState(m) {
    return { tilt0: m.foreTilt, y0: m.wristY, el0: m.elbowPt, len: m.foreLen, moved: 0, lift: 0 };
  }

  trackRep(r, m) {
    r.moved = Math.max(r.moved, Math.abs(m.foreTilt - r.tilt0));
    r.lift = Math.max(r.lift, (r.y0 - m.wristY) / (r.len || 1), Math.hypot(m.elbowPt.x - r.el0.x, m.elbowPt.y - r.el0.y) / (r.len || 1));
  }

  repBlocks(r) {
    const o = this.opts;
    return r.moved > o.maxForearmMove || r.lift > o.maxLift ? ['forearm'] : [];
  }
}

