import { P, SidePicker, FacingTracker, Ema } from '../geometry.js';
import { RepCounter } from './base.js';
import { PushupAnalyzer } from './pushup.js';
import { Frame, nearSide, ChestSide, LEFT, RIGHT, sub, dot, unit, perp, fromUp, elevation, partial, setup, seg, arc, dots, deg, sideSwitched } from './kit.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Straight-arm length that follows longer readings quickly and shorter ones slowly. */
const learn = (ref, v) => (ref == null ? v : ref + (v > ref ? 0.3 : 0.02) * (v - ref));

/**
 * Push-ups filmed from the front (phone on the floor ahead of your head).
 * Depth is the shoulders coming down toward the hands, in arm lengths
 * (1 locked out); from the front that's the one thing that reads cleanly.
 * Used for the variants where what the hands do is the point: diamond
 * (hands together), archer (one arm stays straight) and one-arm push-ups.
 *
 * Returns the same fields as the side-on push-up (height, shoulderY, arm),
 * so the "shoulders must come back up" and "the chest must go down" checks
 * work the same from either angle.
 */
function frontPush(an, frame) {
  const o = an.opts;
  const f = new Frame(frame);
  if (!f.seen([LEFT.sh, RIGHT.sh, LEFT.el, RIGHT.el, LEFT.wr, RIGHT.wr], 0.45)) return partial('Face the camera so I can see both arms and hands', 'Face the camera');
  const shW = f.d(LEFT.sh, RIGHT.sh) || 1;
  const wrs = [LEFT, RIGHT].map((A) => f.p(A.wr));
  // Hands on the floor (or bench) below the shoulders.
  if (Math.max(...wrs.map((w) => w.y)) < Math.max(f.p(LEFT.sh).y, f.p(RIGHT.sh).y)) return setup('Get into a plank, hands on the floor', 'Hands down');
  // Working hand: the one lower down (on the floor); for one-arm push-ups, the other is off it.
  const W = wrs[0].y >= wrs[1].y ? LEFT : RIGHT;
  const X = W === LEFT ? RIGHT : LEFT;
  const e3 = { L: f.ang3(LEFT.sh, LEFT.el, LEFT.wr), R: f.ang3(RIGHT.sh, RIGHT.el, RIGHT.wr) };
  const heightOf = (A) => f.p(A.wr).y - f.p(A.sh).y;
  for (const A of [LEFT, RIGHT]) if (e3[A.key] >= 155) an.armRef = learn(an.armRef, heightOf(A));
  const arm = Math.max(an.armRef ?? 0, 1.1 * shW);
  const handGap = Math.abs(wrs[0].x - wrs[1].x) / shW;
  const freeUp = (f.p(W.wr).y - f.p(X.wr).y) / arm;
  const tilt = Math.abs(elevation(sub(f.p(RIGHT.sh), f.p(LEFT.sh))));
  const out = { f, W, X, e3, arm, handGap, freeUp, tilt, shW };

  let height;
  if (o.variant === 'archer') {
    // The working shoulder drops toward its hand; the other arm stays long.
    const lower = f.p(LEFT.sh).y >= f.p(RIGHT.sh).y ? LEFT : RIGHT;
    out.work = lower;
    out.straight = lower === LEFT ? RIGHT : LEFT;
    height = heightOf(lower) / arm;
  } else if (o.variant === 'oneArm') {
    out.work = W;
    height = heightOf(W) / arm;
  } else {
    height = (heightOf(LEFT) + heightOf(RIGHT)) / (2 * arm);
  }
  out.height = height;
  out.shoulderY = (f.p(LEFT.sh).y + f.p(RIGHT.sh).y) / 2;
  return out;
}

/**
 * The push-up ladder's variants. Side-on they're read like normal push-ups
 * (elbow depth, body line); facing the camera they also check the hands:
 * diamond = hands together under the chest, archer = hands wide and the
 * other arm straight, one-arm = the free hand off the floor. Decline
 * push-ups need the feet up on the bench.
 */
export class PushVariantAnalyzer extends PushupAnalyzer {
  static defaults = {
    variant: 'standard', // 'standard' | 'diamond' | 'archer' | 'oneArm'
    frontBottom: 0.62, // front view: shoulder height (arm lengths) at full depth
    feetTogether: false,
    diamondGap: 0.55, // hands closer than this many shoulder widths
    archerGap: 1.6, // hands at least this many shoulder widths apart
    straightMin: 145, // archer: the long arm's elbow
    freeUp: 0.25, // one-arm: free hand this far off the floor (arm lengths)
    twistMax: 25,
    armAtStart: false,
  };
  static text = {
    faults: {
      wide: { rep: 'hands weren’t together', miss: 'Not counted — hands together in a diamond under your chest', missVoice: 'Hands together' },
      bothBent: { rep: 'both arms bent', miss: 'Not counted — keep the other arm straight; only one arm bends', missVoice: 'Straight arm' },
      twoHands: { rep: 'used both hands', miss: 'Not counted — one hand only; free hand behind your back', missVoice: 'One hand' },
      twist: { live: 'Keep your shoulders level — don’t twist', rep: 'twisted', voice: 'Square up', cue: 'Square up' },
      flare: { live: 'Elbows back — brush your ribs', rep: 'elbows flared', voice: 'Elbows in', cue: 'Elbows in' },
      feet: { live: 'Keep your feet together', rep: 'feet came apart', voice: 'Feet together', cue: 'Feet together' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    this.armRef = null;
    super.reset();
  }

  measure(frame, source) {
    const o = this.opts;
    const front = this.facingT.update(frame) === 'front';
    const oneOrArcher = o.variant === 'archer' || o.variant === 'oneArm';
    if (!front) {
      if (oneOrArcher) return partial('Face the camera: phone on the floor in front of your head', 'Face the camera');
      return super.measure(frame, source);
    }
    // Decline push-ups are judged side-on, where the bench under the feet shows.
    if (o.feetUp) return partial('Turn side-on so I can see your feet on the bench', 'Turn side on');
    const g = frontPush(this, frame);
    if (g.status) return g;
    const { f, W, e3, arm, handGap, freeUp, tilt, shW, height } = g;
    if (this.phase !== 'down') {
      if (o.variant === 'archer' && handGap < o.archerGap) return setup('Set your hands about twice shoulder-width apart', 'Hands wide');
      if (o.variant === 'oneArm' && freeUp < o.freeUp) return setup('Put your free hand behind your back', 'Free hand behind your back');
      if (o.variant === 'oneArm' && o.feetTogether && f.seen([LEFT.ank, RIGHT.ank], 0.4) && f.d(LEFT.ank, RIGHT.ank) > 0.6 * shW) return setup('Bring your feet together', 'Feet together');
    }
    const topH = 0.97;
    const progress = (topH - height) / (topH - o.frontBottom);
    const faults = [];
    if (oneOrArcher && tilt > o.twistMax) faults.push('twist');
    if (o.variant === 'diamond' && progress > 0.4) {
      const out = [LEFT, RIGHT].some((A) => Math.abs(f.p(A.el).x - f.mid(LEFT.sh, RIGHT.sh).x) > Math.abs(f.p(A.sh).x - f.mid(LEFT.sh, RIGHT.sh).x) + 0.3 * shW);
      if (out) faults.push('flare');
    }
    if (o.variant === 'oneArm' && o.feetTogether && f.seen([LEFT.ank, RIGHT.ank], 0.4) && f.d(LEFT.ank, RIGHT.ank) > 0.8 * shW) faults.push('feet');
    const work = g.work || W;
    return {
      status: 'active',
      progress,
      faults,
      height: height,
      shoulderY: g.shoulderY,
      arm,
      handGap,
      freeUp,
      straightElbow: g.straight ? e3[g.straight.key] : null,
      side: oneOrArcher ? work.key : null,
      stats: [
        { label: 'Depth', value: `${Math.round(clamp01(progress) * 100)}%` },
        { label: o.variant === 'archer' ? 'Long arm' : 'Hands', value: o.variant === 'archer' && g.straight ? deg(e3[g.straight.key]) : `${handGap.toFixed(1)}×`, fault: 'bothBent|wide|twoHands' },
      ],
      overlay: [
        seg(LEFT.sh, RIGHT.sh, 'fault:twist', 4),
        ...[LEFT, RIGHT].flatMap((A) => [seg(A.sh, A.el, A === work || o.variant === 'diamond' ? 'go' : 'fault:bothBent'), seg(A.el, A.wr, A === work || o.variant === 'diamond' ? 'go' : 'fault:bothBent'), dots([A.sh, A.el, A.wr])]),
      ],
    };
  }

  repState(m, prev) {
    return { ...super.repState(m, prev), minGapRatio: m.handGap ?? 0, maxGap: m.handGap ?? 0, minStraight: m.straightElbow ?? 180, minFreeUp: m.freeUp ?? 1 };
  }

  trackRep(r, m, p) {
    super.trackRep(r, m, p);
    if (m.handGap != null) r.maxGap = Math.max(r.maxGap, m.handGap);
    if (m.straightElbow != null && p > 0.5) r.minStraight = Math.min(r.minStraight, m.straightElbow);
    if (m.freeUp != null) r.minFreeUp = Math.min(r.minFreeUp, m.freeUp);
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [...super.repBlocks(r)];
    if (o.variant === 'diamond' && this.facingT.value === 'front' && r.maxGap > o.diamondGap) out.push('wide');
    if (o.variant === 'archer' && r.minStraight < o.straightMin) out.push('bothBent');
    if (o.variant === 'oneArm' && r.minFreeUp < o.freeUp * 0.6) out.push('twoHands');
    return out;
  }

  get countAt() {
    return this.facingT?.value === 'front' ? 0.95 : super.countAt;
  }
}

/**
 * Pike push-ups (feet on the floor, hips high) and elevated pike push-ups
 * (feet on the bench, hips stacked over the shoulders), side-on. Depth is the
 * elbow bend, and the head has to actually travel down toward the floor. The
 * head should land in front of the hands, not straight between them.
 */
export class PikePushupAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    elevated: false,
    top: 165,
    depth: 90,
    countAt: 0.93,
    lockout: 150,
    dropShare: 0.5,
    hipMax: 135, // pike: hip angle opening past this = turning into a push-up
    stackMax: 40, // elevated: torso this far from vertical = hips drifting back
    armAtStart: true,
  };
  static statLabels = ['Elbow', 'Hips'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Set up side-on to the camera in a pike',
    toStart: 'Straighten your arms to start',
    ready: 'Ready — lower your head toward the floor',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Depth — press back up',
    notCounted: 'Not counted — lower until your head nearly touches the floor',
    notCountedVoice: 'Lower',
    incomplete: { rep: 'press all the way back up', voice: 'Lock out', miss: 'Not counted — press to straight arms between reps', missVoice: 'Lock out' },
    faults: {
      drop: { rep: 'head didn’t go down', miss: 'Not counted — lower your head toward the floor, not just bend your elbows', missVoice: 'Head down' },
      hips: { live: 'Hips up — stay in the pike', rep: 'hips dropped into a push-up', voice: 'Hips up', cue: 'Hips up' },
      stack: { live: 'Stack your hips over your hands', rep: 'hips drifted back', voice: 'Hips over hands', cue: 'Hips over your hands' },
      head: { live: 'Head in front of your hands — make a triangle', rep: 'head went between the hands', voice: 'Head forward', cue: 'Head forward' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.armRef = null;
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    const foot = f.v(S.ank) >= 0.4 ? S.ank : f.v(S.knee) >= 0.4 ? S.knee : null;
    if (!f.seen([S.sh, S.el, S.wr, S.hip]) || foot == null) return partial('Turn side-on so I can see you from hands to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), wr = f.p(S.wr), ft = f.p(foot), torso = f.d(S.sh, S.hip) || 1;
    if (wr.y < sh.y || hip.y > sh.y + 0.1 * torso) return setup(o.elevated ? 'Feet on the bench, hips up over your hands' : 'Hands down, hips up high in an upside-down V', 'Hips up');
    if (o.elevated && this.phase !== 'down' && wr.y - ft.y < 0.3 * torso) return setup('Put your feet up on the bench', 'Feet on the bench');
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (elbow >= 155) this.armRef = learn(this.armRef, f.d(S.sh, S.wr));
    const arm = Math.max(this.armRef ?? 0, 1.0 * torso);
    const hipAng = f.ang(S.sh, S.hip, foot);
    const stack = fromUp(sub(hip, sh));
    const faults = [];
    if (!o.elevated && hipAng > o.hipMax) faults.push('hips');
    if (o.elevated && stack > o.stackMax) faults.push('stack');
    const progress = (o.top - elbow) / (o.top - o.depth);
    if (progress > 0.7 && f.v(P.nose) >= 0.5) {
      // "In front of the hands" = away from the feet.
      const away = Math.sign(wr.x - ft.x) || 1;
      if (((f.p(P.nose).x - wr.x) * away) / arm < -0.1) faults.push('head');
    }
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress,
      faults,
      elbow,
      height: (wr.y - sh.y) / arm,
      shoulderY: sh.y,
      arm,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Hips', value: deg(o.elevated ? stack : hipAng), fault: 'hips|stack' },
      ],
      overlay: [seg(S.sh, S.el), seg(S.el, S.wr), arc(S.sh, S.el, S.wr, `${e}°`), seg(S.sh, S.hip, 'fault:hips|stack', 5), seg(S.hip, foot, 'fault:hips', 5), dots([S.sh, S.el, S.wr])],
    };
  }

  repState(m) {
    return { topY: m.shoulderY, lowY: m.shoulderY, armLen: m.arm };
  }

  trackRep(r, m) {
    r.topY = Math.min(r.topY, m.shoulderY);
    r.lowY = Math.max(r.lowY, m.shoulderY);
    r.armLen = Math.max(r.armLen, m.arm);
  }

  repBlocks(r) {
    const o = this.opts;
    const expected = Math.sin((o.top * Math.PI) / 360) - Math.sin((o.depth * Math.PI) / 360);
    return (r.lowY - r.topY) / r.armLen < o.dropShare * expected ? ['drop'] : [];
  }

  canFinish(m) {
    return m.elbow >= this.opts.lockout;
  }
}

/**
 * Handstand push-ups against the wall (full reps, negatives, from a
 * deficit) and freestanding, side-on. Depth is the shoulders coming down
 * toward the hands, in arm lengths (1 locked out); a full rep brings the
 * head to the floor (below the hands for the deficit). Kicking the legs to
 * get back up doesn't count. Negatives count at the bottom and must take
 * their time.
 */
export class HSPUAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    bottomH: 0.45, // shoulder height above the hands (arm lengths) with the head on the floor
    lockout: 150,
    kickRange: 35,
    archBy: 0.1,
    maxTilt: 35,
    eccentric: 'down',
    minEccMs: 600,
  };
  static statLabels = ['Elbow', 'Depth'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Set up side-on to the camera',
    toStart: 'Kick up to a handstand with straight arms to start',
    ready: 'Ready — lower your head to the floor',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Head down — press up!',
    notCounted: 'Not counted — lower until your head touches the floor',
    notCountedVoice: 'Head to the floor',
    incomplete: { rep: 'press all the way to straight arms', voice: 'Lock out', miss: 'Not counted — press all the way back to straight arms', missVoice: 'Lock out' },
    faults: {
      kick: { rep: 'kicked the legs', miss: 'Not counted — don’t kick; press with your arms', missVoice: 'No kicking' },
      banana: { live: 'Ribs in, glutes tight — straight line', rep: 'arched into a banana', voice: 'Ribs in', cue: 'Ribs in' },
      fast: { rep: 'dropped too fast', voice: 'Slower', miss: 'Not counted — lower slowly, 3 to 5 seconds', missVoice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.armRef = null;
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    const foot = f.v(S.ank) >= 0.4 ? S.ank : f.v(S.knee) >= 0.4 ? S.knee : null;
    if (!f.seen([S.sh, S.el, S.wr, S.hip]) || foot == null) return partial('Turn side-on so I can see you from hands to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), wr = f.p(S.wr), ft = f.p(foot), torso = f.d(S.sh, S.hip) || 1;
    const inverted = hip.y < sh.y - 0.3 * torso && ft.y < hip.y + 0.2 * torso && fromUp(sub(hip, sh)) <= o.maxTilt + 10;
    if (!inverted || wr.y < sh.y) return setup('Kick up into your handstand — reps count upside down', 'Kick up');
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (elbow >= 155) this.armRef = learn(this.armRef, f.d(S.sh, S.wr));
    const arm = Math.max(this.armRef ?? 0, 1.1 * torso);
    const h = (wr.y - sh.y) / arm;
    const progress = (0.97 - h) / (0.97 - o.bottomH);
    // Banana: hips pushed toward the chest side of the shoulder–foot line.
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const n = unit(perp(unit(sub(ft, sh))));
    const off = (dot(sub(hip, sh), n) / torso) * (chest && dot(n, chest) < 0 ? -1 : 1);
    const faults = chest && off > o.archBy ? ['banana'] : [];
    const hipAng = f.v(S.knee) >= 0.4 ? f.ang(S.sh, S.hip, S.knee) : null;
    const kneeAng = f.v(S.knee) >= 0.4 && f.v(S.ank) >= 0.4 ? f.ang(S.hip, S.knee, S.ank) : null;
    const e = Math.round(elbow);
    return {
      status: 'active',
      progress,
      faults,
      elbow,
      hipAng,
      kneeAng,
      stats: [
        { label: 'Elbow', value: `${e}°` },
        { label: 'Depth', value: `${Math.round(clamp01(progress) * 100)}%` },
      ],
      overlay: [seg(S.wr, S.el), seg(S.el, S.sh), arc(S.sh, S.el, S.wr, `${e}°`), seg(S.sh, S.hip, 'fault:banana', 6), seg(S.hip, foot, 'fault:banana', 6), dots([S.wr, S.el, S.sh])],
    };
  }

  repState(m) {
    return { hip: [m.hipAng, m.hipAng], knee: [m.kneeAng, m.kneeAng] };
  }

  trackRep(r, m) {
    for (const [k, v] of [['hip', m.hipAng], ['knee', m.kneeAng]]) {
      if (v == null) continue;
      r[k] = [Math.min(r[k][0] ?? v, v), Math.max(r[k][1] ?? v, v)];
    }
  }

  repBlocks(r) {
    const range = (a) => (a[0] == null ? 0 : a[1] - a[0]);
    return range(r.hip) > this.opts.kickRange || range(r.knee) > this.opts.kickRange ? ['kick'] : [];
  }

  canFinish(m) {
    return m.elbow >= this.opts.lockout;
  }
}

/**
 * Scapular push-ups, side-on in a push-up plank with locked arms: let the
 * chest sink between the shoulder blades, then push the floor away. The
 * elbows never bend. Progress is the chest (read at the head) sinking below
 * the shoulders, from the top (upper back rounded).
 */
export class ScapPushupAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = { target: 0.07, hipShare: 0.4, bentBlock: 155, maxIncline: 45, sagTolerance: 18, minRepMs: 600 };
  static statLabels = ['Sink', 'Elbows'];
  static meterLabel = 'sink';
  static text = {
    noPerson: 'Get into a plank, side-on to the camera',
    toStart: 'Push the floor away, upper back rounded, to start',
    ready: 'Ready — let your chest sink between your shoulder blades',
    going: (pct) => `Sink… ${pct}%`,
    reached: 'Now push the floor away',
    notCounted: 'Not counted — let your chest sink further between your shoulder blades',
    notCountedVoice: 'Sink deeper',
    incomplete: { rep: 'push all the way up until your upper back rounds', voice: 'Push away' },
    faults: {
      bent: { rep: 'elbows bent', miss: 'Not counted — keep your elbows locked; only your shoulder blades move', missVoice: 'Straight arms' },
      sag: { live: 'Hips sagging — squeeze your glutes', rep: 'hips sagged', voice: 'Hips up', cue: 'Hips up' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  resetFilters() {
    this.low = { head: null, hip: null };
    this.ema = { head: new Ema(0.4), hip: new Ema(0.4) };
    this.lastT = null;
    this.lastP = 0;
  }

  /**
   * How far a point has sunk below the shoulders since its highest (the top,
   * upper back rounded). The top only creeps down slowly, and only at rest.
   */
  sinkOf(key, raw, dt) {
    const v = this.ema[key].next(raw);
    const low = this.low[key];
    if (low == null || v < low) this.low[key] = v;
    else if (this.phase !== 'down' && this.lastP < 0.15) this.low[key] += Math.min(v - low, 0.01 * dt);
    return v - this.low[key];
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip']);
    const foot = f.v(S.ank) >= 0.4 ? S.ank : f.v(S.knee) >= 0.4 ? S.knee : null;
    if (!f.seen([S.sh, S.el, S.wr, S.hip]) || foot == null) return partial('Turn side-on so I can see you from hands to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), ft = f.p(foot), torso = f.d(S.sh, S.hip) || 1;
    if (Math.abs(elevation(sub(sh, ft))) > o.maxIncline || f.p(S.wr).y < sh.y) return setup('Get into a push-up plank, arms straight', 'Plank position');
    if (sideSwitched(this, S)) this.resetFilters();
    if (torso < 110) return partial('Move the phone closer — I need a bigger view of your upper body', 'Move closer');
    const elbow = f.ang(S.sh, S.el, S.wr);
    const head = [S.ear, P.nose].find((i) => f.v(i) >= 0.5);
    // The trunk sinks between the shoulder blades: the hips drop with it (a nod moves only the head).
    const dt = this.lastT == null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    const hipSink = this.sinkOf('hip', (hip.y - sh.y) / torso, dt);
    const headSink = head != null ? this.sinkOf('head', (f.p(head).y - sh.y) / torso, dt) : null;
    const sink = headSink == null ? hipSink / o.hipShare : Math.min(headSink, hipSink / o.hipShare);
    this.lastP = sink / o.target;
    const body = f.ang(S.sh, S.hip, foot);
    const below = dot(sub(hip, sh), unit(perp(unit(sub(ft, sh))))) * Math.sign(perp(unit(sub(ft, sh))).y || 1) > 0;
    const faults = below && 180 - body > o.sagTolerance ? ['sag'] : [];
    return {
      status: 'active',
      progress: sink / o.target,
      faults,
      elbow,
      stats: [
        { label: 'Sink', value: `${Math.round(clamp01(sink / o.target) * 100)}%` },
        { label: 'Elbows', value: deg(elbow), fault: 'bent' },
      ],
      overlay: [seg(S.wr, S.el, 'fault:bent'), seg(S.el, S.sh, 'fault:bent'), seg(S.sh, S.hip, 'fault:sag', 5), seg(S.hip, foot, 'fault:sag', 5), dots([S.sh, S.hip])],
    };
  }

  repState(m) {
    return { minElbow: m.elbow };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
  }

  repBlocks(r) {
    return r.minElbow < this.opts.bentBlock ? ['bent'] : [];
  }
}

/**
 * Wrist prep rocks on all fours, side-on: rock the shoulders forward past
 * the hands and back. Counts the forward-and-back rocks (side-to-side ones
 * can't be seen side-on) and keeps the elbows straight and the pace slow.
 */
export class WristRockAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = { target: 0.22, elbowMin: 150, minMs: 1200, minRepMs: 500 };
  static statLabels = ['Lean', 'Elbows'];
  static meterLabel = 'lean';
  static tempo = ['→', '←'];
  static text = {
    noPerson: 'Get on all fours, side-on to the camera',
    toStart: 'Shoulders over your hands to start',
    ready: 'Ready — rock slowly forward over your hands',
    going: (pct) => `Forward… ${pct}%`,
    reached: 'Stretch — now rock back',
    notCounted: 'Not counted — rock further forward over your hands',
    notCountedVoice: 'Further forward',
    incomplete: { rep: 'rock all the way back', voice: 'Back' },
    faults: {
      elbows: { live: 'Keep your elbows straight', rep: 'bent the elbows', voice: 'Straight elbows', cue: 'Straight elbows' },
      rush: { rep: 'rushed — ease the weight on and off', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.armRef = null;
    super.reset();
  }

  resetFilters() {
    this.low = null;
    this.lastT = null;
    this.lastP = 0;
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'el', 'wr', 'hip', 'knee']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip, S.knee], 0.45)) return partial('Turn side-on so I can see your hands and knees', 'Turn side on');
    const sh = f.p(S.sh), wr = f.p(S.wr), hip = f.p(S.hip), knee = f.p(S.knee), torso = f.d(S.sh, S.hip) || 1;
    // On all fours: hands and knees on the floor, with the hips up over the knees and the
    // shoulders up over the hands (lying face down, they're all on the floor).
    const fours = wr.y - sh.y > 0.5 * torso && knee.y - hip.y > 0.5 * torso && Math.abs(elevation(sub(sh, hip))) < 35 && Math.abs(wr.y - knee.y) < 0.4 * torso;
    if (!fours) return setup('Kneel on all fours, hands under your shoulders', 'On all fours');
    if (sideSwitched(this, S)) this.resetFilters();
    const elbow = f.ang(S.sh, S.el, S.wr);
    if (elbow >= 155) this.armRef = learn(this.armRef, f.d(S.sh, S.wr));
    const arm = Math.max(this.armRef ?? 0, 0.9 * torso);
    const lean = dot(sub(sh, wr), unit(sub(sh, hip))) / arm;
    const dt = this.lastT == null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    if (this.low == null || lean < this.low) this.low = lean;
    else if (this.phase !== 'down' && this.lastP < 0.15) this.low += Math.min(lean - this.low, 0.05 * dt);
    this.lastP = (lean - this.low) / o.target;
    const faults = elbow < o.elbowMin ? ['elbows'] : [];
    return {
      status: 'active',
      progress: (lean - this.low) / o.target,
      faults,
      stats: [
        { label: 'Lean', value: `${Math.round(Math.max(0, lean) * 100)}%` },
        { label: 'Elbows', value: deg(elbow), fault: 'elbows' },
      ],
      overlay: [seg(S.wr, S.el, 'fault:elbows'), seg(S.el, S.sh, 'fault:elbows'), seg(S.sh, S.hip, 'neutral', 5), dots([S.wr, S.sh])],
    };
  }

  repIssues(r) {
    return this.lastSeen - r.from < this.opts.minMs ? ['rush'] : [];
  }
}

/**
 * Straddle press to handstand, side-on: from a straddle fold with the hands
 * down, lean until the feet float and press the legs up overhead. Arms stay
 * locked, and the feet have to float off — hopping off the floor with the
 * hips still low doesn't count.
 */
export class StraddlePressAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = { target: 160, bentBlock: 145, hopLift: 0.15, eccentric: 'up', minRepMs: 1200 };
  static statLabels = ['Legs', 'Elbows'];
  static meterLabel = 'press';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Set up side-on to the camera',
    toStart: 'Fold forward in a wide straddle, hands on the floor',
    ready: 'Ready — lean forward until your feet float',
    going: (pct) => `Press… ${pct}%`,
    reached: 'Handstand! Lower back down with control',
    notCounted: 'Not counted — press all the way up to a handstand',
    notCountedVoice: 'All the way up',
    incomplete: { rep: 'lower all the way back to the floor', voice: 'All the way down' },
    faults: {
      bent: { rep: 'bent the arms', miss: 'Not counted — keep your arms locked; lean, don’t muscle it up', missVoice: 'Straight arms' },
      hop: { rep: 'hopped off the floor', miss: 'Not counted — lean until your feet float; no jumping', missVoice: 'No jumping' },
      hips: { rep: 'hips didn’t get over the hands', miss: 'Not counted — get your hips over your hands', missVoice: 'Hips over hands' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  resetFilters() {
    this.floor = null;
    this.takeoff = null; // null (feet down) | 'lean' | 'hop'
  }

  measure(frame) {
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'wr', 'hip', 'ank']);
    if (!f.seen([S.sh, S.el, S.wr, S.hip]) || f.v(S.ank) < 0.4) return partial('Turn side-on so I can see you from hands to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), ank = f.p(S.ank), wr = f.p(S.wr), torso = f.d(S.sh, S.hip) || 1;
    if (wr.y < sh.y) return setup('Hands on the floor to start', 'Hands down');
    if (sideSwitched(this, S)) this.resetFilters();
    const legs = 180 - fromUp(sub(ank, hip));
    const toe = [S.toe, S.ank].find((i) => f.v(i) >= 0.4);
    const toeY = f.p(toe).y;
    if (this.phase !== 'down' && legs < 60) this.floor = this.floor == null ? toeY : Math.max(this.floor - 0.5, toeY);
    const lift = this.floor == null ? 0 : (this.floor - toeY) / torso;
    const elbow = f.ang(S.sh, S.el, S.wr);
    // Hips stacked over the hands: above the shoulders and not still back over the feet.
    const hipOver = sh.y - hip.y > 0.2 * torso && Math.abs(hip.x - wr.x) < 0.3 * torso;
    // The moment the feet leave the floor decides it: floated (hips already over) or hopped.
    if (lift < 0.05) this.takeoff = null;
    else if (this.takeoff == null && lift > this.opts.hopLift) this.takeoff = hipOver ? 'lean' : 'hop';
    return {
      status: 'active',
      progress: legs / this.opts.target,
      faults: [],
      elbow,
      hipOver,
      stats: [
        { label: 'Legs', value: deg(legs) },
        { label: 'Elbows', value: deg(elbow), fault: 'bent' },
      ],
      overlay: [seg(S.wr, S.el), seg(S.el, S.sh), seg(S.sh, S.hip, 'go', 6), seg(S.hip, S.ank, 'go', 6), dots([S.wr, S.sh, S.hip, S.ank])],
    };
  }

  repState(m) {
    return { minElbow: m.elbow, hop: this.takeoff === 'hop', hipOver: m.hipOver };
  }

  trackRep(r, m) {
    r.minElbow = Math.min(r.minElbow, m.elbow);
    r.hipOver ||= m.hipOver;
    if (this.takeoff === 'hop') r.hop = true;
  }

  repBlocks(r) {
    const out = [];
    if (r.minElbow < this.opts.bentBlock) out.push('bent');
    if (r.hop) out.push('hop');
    if (!r.hipOver) out.push('hips');
    return out;
  }
}

