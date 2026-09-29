import { SidePicker } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, ChestSide, Baseline, LEFT, RIGHT, sub, dot, unit, perp, len, fromUp, elevation, partial, setup, seg, dash, arc, dots, deg } from './kit.js';

/** Unit normal of the torso toward the floor (the chest side when face down). */
function floorNormal(f, S, axis, chest) {
  if (chest && chest.y > 0) return chest;
  const n = unit(perp(axis));
  return n.y >= 0 ? n : { x: -n.x, y: -n.y };
}

/** Straight-arm length that follows longer readings quickly and shorter ones slowly. */
function learnArm(ref, reach) {
  return ref == null ? reach : ref + (reach > ref ? 0.3 : 0.02) * (reach - ref);
}

/**
 * Rows, side-on with the rowing arm toward the camera: single-arm rows
 * (knee and hand on a bench, back flat) and chest-supported rows (chest on
 * a 30–45° bench). Progress is the elbow travelling from hanging below the
 * torso up to the line of the back. The elbow has to bend (a straight-arm
 * swing isn't a row), and on the chest-supported version the chest has to
 * stay on the pad.
 */
export class RowAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    support: 'bench', // 'bench' (single-arm, torso flat) | 'chest' (chest on an incline pad)
    topH: 0.02, // elbow height below the back line, in upper-arm lengths, that counts as rowed
    bendBy: 115, // the elbow must bend at least this far
    liftWarn: 8, // chest-supported: torso rising off the pad (deg)
    liftBlock: 15,
    twistWarn: 0.25, // single-arm: shoulders opening toward the camera, in torso lengths
    handRise: 0.35, // the hand must rise this much (upper-arm lengths), and the shoulders not sink this much
    hangMin: 1.1, // at the start the hand hangs at least this far below the shoulder (upper-arm lengths, ~0.6 of the arm)
    eccentric: 'up',
    minEccMs: 600,
  };
  static statLabels = ['Elbow', 'Row'];
  static meterLabel = 'row';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Set up side-on, with the rowing arm nearest the camera',
    toStart: 'Let the dumbbell hang with a straight arm to start',
    ready: 'Ready — row your elbow back',
    going: (pct) => `Row… ${pct}%`,
    reached: 'Squeeze — now lower to a full stretch',
    notCounted: 'Not counted — row until your elbow is level with your back',
    notCountedVoice: 'Elbow higher',
    incomplete: { rep: 'lower all the way to a straight arm', voice: 'Full stretch', miss: 'Not counted — lower to a straight arm each rep', missVoice: 'Full stretch' },
    faults: {
      straight: { rep: 'arm stayed straight', miss: 'Not counted — bend your elbow and pull it back', missVoice: 'Bend and pull' },
      still: { rep: 'the weight didn’t come up', miss: 'Not counted — pull the weight up to you; your body stays still', missVoice: 'Pull the weight up' },
      hang: { rep: 'didn’t start from a hanging arm', miss: 'Not counted — start each rep with the dumbbell hanging straight down', missVoice: 'Let it hang' },
      chest: { live: 'Keep your chest on the pad', rep: 'chest came off the pad', voice: 'Chest down', cue: 'Chest on the pad', miss: 'Not counted — you lifted your chest off the pad to jerk it up', missVoice: 'Chest down' },
      twist: { live: 'Keep your torso square to the floor — don’t twist', rep: 'torso twisted open', voice: 'Stay square', cue: 'Don’t twist' },
      lift: { live: 'Stay down — keep your back flat', rep: 'torso came up', voice: 'Stay down', cue: 'Stay down' },
      high: { live: 'Pull your elbow toward your hip, not your ear', rep: 'pulled toward the shoulder', voice: 'Elbow to hip', cue: 'Elbow to your hip' },
      fast: { rep: 'dropped the weight — lower under control', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.upperRef = null;
    this.restH = new Baseline(0.15);
    this.tiltBase = new Baseline(0.1);
    this.sepBase = new Baseline(0.1);
    this.hangAtRest = 0;
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip])) return partial('Turn side-on with the rowing arm toward the camera', 'Turn side on');
    const sh = f.p(S.sh), el = f.p(S.el), hip = f.p(S.hip);
    const axis = unit(sub(sh, hip));
    const torso = f.d(S.sh, S.hip) || 1;
    const tilt = elevation(sub(sh, hip));
    const chest = this.chest.update(f, S, axis);
    const slack = this.phase === 'down' ? 20 : 0;
    if (o.support === 'chest') {
      if (tilt < 8 - slack || tilt > 68 + slack) return setup('Lie chest-down on the bench set to 30–45°', 'Chest on the bench');
    } else if (fromUp(sub(sh, hip)) < 50 - slack) {
      return setup('Put one knee and hand on the bench, back flat', 'Knee and hand on the bench');
    }
    if (chest && chest.y < -0.2) return setup('Face the floor — chest down', 'Chest down');
    const n = floorNormal(f, S, axis, chest);

    const elbow = f.ang(S.sh, S.el, S.wr);
    if (elbow >= 150) this.upperRef = learnArm(this.upperRef, len(sub(el, sh)));
    const upper = Math.max(this.upperRef ?? 0, 0.55 * torso);
    // How far the hand hangs below the shoulder (straight down, image vertical) just before the rep.
    // Lying on the floor it can't hang at all.
    const hangNow = (f.p(S.wr).y - sh.y) / upper;
    const h = dot(sub(el, sh), n) / upper;
    if (this.phase !== 'down' && elbow >= 150) this.restH.learn(h);
    const rest = Math.max(0.6, this.restH.value ?? 0.9);
    const progress = (rest - h) / (rest - o.topH);
    if (this.phase !== 'down' && progress < 0.15) this.hangAtRest = hangNow;

    const faults = [];
    if (this.phase !== 'down') this.tiltBase.learn(tilt);
    const lifted = this.tiltBase.value == null ? 0 : tilt - this.tiltBase.value;
    if (o.support === 'chest' && lifted > o.liftWarn) faults.push('chest');
    if (o.support === 'bench') {
      if (Math.abs(lifted) > 15) faults.push('lift');
      if (f.v(LEFT.sh) >= 0.2 && f.v(RIGHT.sh) >= 0.2) {
        const sep = f.d(LEFT.sh, RIGHT.sh) / torso;
        if (this.phase !== 'down') this.sepBase.learn(sep);
        else if (this.sepBase.value != null && sep - this.sepBase.value > o.twistWarn) faults.push('twist');
      }
    }
    if (progress > 0.8 && dot(sub(el, sh), axis) / upper > 0.25) faults.push('high');

    const e = Math.round(elbow);
    return {
      status: 'active',
      progress,
      faults,
      elbow,
      lifted,
      handY: f.p(S.wr).y / upper,
      shY: sh.y / upper,
      hang: hangNow,
      stats: [
        { label: 'Elbow', value: `${e}°`, fault: 'straight' },
        { label: 'Row', value: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`, fault: 'high' },
      ],
      overlay: [dash(S.hip, S.sh, 'fault:chest|lift|twist', 3), seg(S.sh, S.el, 'fault:high'), seg(S.el, S.wr), arc(S.sh, S.el, S.wr, `${e}°`), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m, prev) {
    const start = prev ? prev.backM : m;
    // Straight after a rep that didn't come all the way down, the hang is wherever it turned around.
    const startHang = prev ? start.hang : this.hangAtRest;
    this.hangAtRest = 0;
    return { minElbow: m.elbow, maxLift: m.lifted, hand0: start.handY, handTop: m.handY, sh0: start.shY, shLow: m.shY, startHang };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.maxLift = Math.max(r.maxLift, m.lifted);
    r.handTop = Math.min(r.handTop, m.handY);
    r.shLow = Math.max(r.shLow, m.shY);
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (o.support === 'chest' && r.maxLift > o.liftBlock) out.push('chest');
    if (r.startHang < o.hangMin) out.push('hang');
    if (r.minElbow > o.bendBy) out.push('straight');
    // The hand (the dumbbell) has to travel up; the body mustn't travel down to it (that's a push-up).
    else if (r.hand0 - r.handTop < o.handRise || r.shLow - r.sh0 > o.handRise) out.push('still');
    return out;
  }

  repDetail(r) {
    return `elbow ${Math.round(r.minElbow)}° at the top`;
  }
}

/**
 * Reverse flyes chest-down on a 30° bench, side-on. Arms hang straight down,
 * then sweep out wide until the elbows reach shoulder height (measured on the
 * elbow, in upper-arm lengths, so a soft bend doesn't cost height). The
 * elbows keep that bend: bending them into a row doesn't count.
 */
export class RearFlyAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    topH: -0.15, // elbow height (upper-arm lengths, + = above the shoulder) that counts as shoulder height
    rowElbow: 110, // 3D elbow angle below this = rowing
    liftWarn: 10,
    minConMs: 350,
    eccentric: 'up',
    minEccMs: 500,
  };
  static statLabels = ['Height', 'Elbow'];
  static meterLabel = 'height';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie chest-down on the bench, side-on to the camera',
    toStart: 'Let your arms hang straight down to start',
    ready: 'Ready — raise your arms out wide',
    going: (pct) => `Raise… ${pct}%`,
    reached: 'Shoulder height — lower slowly',
    notCounted: 'Not counted — raise your arms until your elbows reach shoulder height',
    notCountedVoice: 'Higher',
    incomplete: { rep: 'lower your arms all the way down', voice: 'All the way down' },
    faults: {
      row: { rep: 'elbows bent — that was a row', miss: 'Not counted — keep a soft, fixed elbow bend and reach out wide', missVoice: 'Arms wide' },
      chest: { live: 'Keep your chest on the pad', rep: 'chest came off the pad', voice: 'Chest down', cue: 'Chest on the pad' },
      jerk: { rep: 'swung the weights up — lift smoothly', voice: 'Smooth' },
      fast: { rep: 'dropped the weights', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.armRef = null;
    this.restH = new Baseline(0.15);
    this.tiltBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip])) return partial('Turn side-on so I can see your arm and hip', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip);
    const axis = unit(sub(sh, hip));
    const tilt = elevation(sub(sh, hip));
    const chest = this.chest.update(f, S, axis);
    const slack = this.phase === 'down' ? 20 : 0;
    if (tilt < 5 - slack || tilt > 68 + slack) return setup('Lie chest-down on the bench set to about 30°', 'Chest on the bench');
    if (chest && chest.y < -0.2) return setup('Face the floor — chest down', 'Chest down');
    const el = f.p(S.el);
    const elbow2 = f.ang(S.sh, S.el, S.wr);
    if (elbow2 >= 150 && this.phase !== 'down') this.armRef = learnArm(this.armRef, len(sub(el, sh)));
    const upper = Math.max(this.armRef ?? 0, 0.55 * (f.d(S.sh, S.hip) || 1));
    const h = (sh.y - el.y) / upper;
    if (this.phase !== 'down' && elbow2 >= 150) this.restH.learn(h);
    const rest = Math.min(-0.6, this.restH.value ?? -0.95);
    const progress = (h - rest) / (o.topH - rest);
    if (this.phase !== 'down') this.tiltBase.learn(tilt);
    const faults = [];
    if (this.tiltBase.value != null && tilt - this.tiltBase.value > o.liftWarn) faults.push('chest');
    const elbow3 = f.ang3(S.sh, S.el, S.wr);
    return {
      status: 'active',
      progress,
      faults,
      elbow3,
      stats: [
        { label: 'Height', value: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` },
        { label: 'Elbow', value: deg(elbow3), fault: 'row' },
      ],
      overlay: [
        dash({ x: f.lm[S.sh].x - 0.12, y: f.lm[S.sh].y }, { x: f.lm[S.sh].x + 0.12, y: f.lm[S.sh].y }),
        dash(S.hip, S.sh, 'fault:chest', 3),
        seg(S.sh, S.el),
        seg(S.el, S.wr),
        dots([S.sh, S.el, S.wr]),
      ],
    };
  }

  repState(m) {
    return { minElbow: m.elbow3 };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow3);
  }

  repBlocks(r) {
    return r.minElbow < this.opts.rowElbow ? ['row'] : [];
  }

  repIssues(r) {
    return r.maxAt - r.from < this.opts.minConMs ? ['jerk'] : [];
  }
}

/**
 * Reverse snow angels, face down on a flat bench, side-on. Straight arms
 * sweep from the hips out wide to overhead and back, hovering the whole way.
 * Progress is where the hands are along the body: at the hips → past the head.
 */
export class SnowAngelAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    from: -0.7, // hands along the body toward the hips (arm lengths)
    to: 0.75, // ...and past the head
    dropBelow: 0.35, // hands sinking this far below the shoulders = not lifted
    bentBelow: 140,
    liftWarn: 12,
    minRepMs: 1000,
  };
  static statLabels = ['Sweep', 'Arms'];
  static meterLabel = 'sweep';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie face down on the bench, side-on to the camera',
    toStart: 'Start with your arms by your hips, lifted off the bench',
    ready: 'Ready — sweep your arms overhead',
    going: (pct) => `Sweep… ${pct}%`,
    reached: 'Overhead — sweep back to your hips',
    notCounted: 'Not counted — sweep your arms all the way overhead',
    notCountedVoice: 'All the way overhead',
    incomplete: { rep: 'sweep all the way back to your hips', voice: 'Back to your hips' },
    faults: {
      drop: { live: 'Keep your arms lifted — hover them the whole way', rep: 'arms dropped', voice: 'Arms up', cue: 'Arms up' },
      bent: { live: 'Keep your arms straight', rep: 'elbows bent', voice: 'Straight arms', cue: 'Straight arms' },
      chest: { live: 'Keep your chest down on the bench', rep: 'lifted your chest', voice: 'Chest down', cue: 'Chest down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.armRef = null;
    this.tiltBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'wr', 'hip']);
    if (!f.seen([S.sh, S.wr, S.hip])) return partial('Turn side-on so I can see your arm and hip', 'Turn side on');
    const sh = f.p(S.sh), wr = f.p(S.wr), hip = f.p(S.hip);
    const axis = unit(sub(sh, hip));
    const tilt = elevation(sub(sh, hip));
    const chest = this.chest.update(f, S, axis);
    if (Math.abs(tilt) > (this.phase === 'down' ? 40 : 25)) return setup('Lie face down on a flat bench', 'Lie face down');
    if (chest && chest.y < -0.2) return setup('Turn over — face down', 'Face down');
    const elbow3 = f.v(S.el) >= 0.3 ? f.ang3(S.sh, S.el, S.wr) : 180;
    if (elbow3 >= 150) this.armRef = learnArm(this.armRef, len(sub(wr, sh)));
    const arm = Math.max(this.armRef ?? 0, 1.1 * (f.d(S.sh, S.hip) || 1));
    const along = dot(sub(wr, sh), axis) / arm;
    const low = (wr.y - sh.y) / arm;
    if (this.phase !== 'down') this.tiltBase.learn(tilt);
    const faults = [];
    if (low > o.dropBelow) faults.push('drop');
    if (elbow3 < o.bentBelow) faults.push('bent');
    if (this.tiltBase.value != null && Math.abs(tilt - this.tiltBase.value) > o.liftWarn) faults.push('chest');
    const progress = (along - o.from) / (o.to - o.from);
    return {
      status: 'active',
      progress,
      faults,
      stats: [
        { label: 'Sweep', value: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` },
        { label: 'Arms', value: deg(elbow3), fault: 'bent|drop' },
      ],
      overlay: [dash(S.hip, S.sh, 'fault:chest', 3), seg(S.sh, S.wr, 'fault:drop|bent'), dots([S.sh, S.wr])],
    };
  }
}
