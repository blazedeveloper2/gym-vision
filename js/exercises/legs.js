import { SidePicker, FacingTracker, Ema } from '../geometry.js';
import { RepCounter } from './base.js';
import { Frame, nearSide, ChestSide, Baseline, LEFT, RIGHT, sub, dot, unit, upNormal, fromUp, elevation, partial, setup, seg, dash, arc, dots, deg, DEG, sideSwitched, bigEnough } from './kit.js';

/** A low-water mark that creeps up slowly while `resting` (for "back to the bottom" references). */
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

/**
 * Bulgarian split squats: back foot up on a bench, filmed side-on (or from
 * the front to watch the knee). The front leg is the one whose foot is on
 * the floor. Progress is its knee bending from standing to about 95°, and
 * the hips have to come down too, so bending a knee on the spot doesn't count.
 */
export class SplitSquatAnalyzer extends RepCounter {
  static defaults = {
    standAngle: 170,
    targetAngle: 95,
    minDrop: 0.2, // hips must drop this share of their standing height
    maxLean: 45,
    heelLift: 20, // front heel above the toes (deg) at the bottom
    caveBy: 0.12, // front view: knee inside the hip–ankle line (thigh lengths)
    minRepMs: 500,
  };
  static statLabels = ['Front knee', 'Lean'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Stand side-on to the camera, back foot up on the bench',
    toStart: 'Stand tall on the front leg to start',
    ready: 'Ready — drop straight down',
    going: (pct) => `Lower… ${pct}%`,
    reached: 'Depth reached — drive up through your front foot',
    notCounted: 'Not counted — lower until your back knee nearly touches the floor',
    notCountedVoice: 'Go lower',
    incomplete: { rep: 'stand all the way up between reps', voice: 'Stand tall', miss: 'Not counted — stand all the way up between reps', missVoice: 'Stand tall' },
    faults: {
      drop: { rep: 'hips didn’t go down', miss: 'Not counted — lower your hips, don’t just bend your knee', missVoice: 'Hips down' },
      lean: { live: 'Chest up — you’re folding forward', rep: 'torso folded forward', voice: 'Chest up', cue: 'Chest up' },
      heel: { live: 'Front heel is lifting — step further from the bench', rep: 'front heel lifted', voice: 'Heel down', cue: 'Front heel down' },
      knee: { live: 'Push your front knee out over your toes', rep: 'front knee caved in', voice: 'Knee out', cue: 'Knee out' },
    },
  };

  reset() {
    this.facingT = new FacingTracker();
    this.standH = new Baseline(0.2);
    super.reset();
  }

  measure(frame, source) {
    const o = this.opts;
    const f = new Frame(frame);
    const legs = [LEFT, RIGHT];
    // The far leg is often partly hidden side-on; a rough position is enough to tell front from back.
    if (legs.some((L) => !f.seen([L.hip, L.knee, L.ank], 0.25)) || Math.max(f.v(LEFT.sh), f.v(RIGHT.sh)) < 0.5) {
      return partial('Move back so I can see you from shoulders to feet', 'Move back');
    }
    const front = this.facingT.update(frame) === 'front';
    // Front leg: its foot is on the floor, lower than the one on the bench.
    const F = f.p(LEFT.ank).y >= f.p(RIGHT.ank).y ? LEFT : RIGHT;
    const B = F === LEFT ? RIGHT : LEFT;
    const shin = f.d(F.knee, F.ank) || 1;
    if (f.p(F.ank).y - f.p(B.ank).y < 0.25 * shin) return setup('Put the laces of your back foot up on the bench', 'Back foot on the bench');
    const Sh = f.v(F.sh) >= 0.5 ? F.sh : B.sh;
    const hip = f.mid(LEFT.hip, RIGHT.hip);
    const lean = fromUp(sub(f.p(Sh), hip));
    if (lean > (this.phase === 'down' ? 75 : 60)) return setup('Stand up tall to start', 'Stand tall');
    const knee = front && source !== '2d' && f.world ? f.ang3(F.hip, F.knee, F.ank) : f.ang(F.hip, F.knee, F.ank);
    const progress = (o.standAngle - knee) / (o.standAngle - o.targetAngle);
    const hipH = f.p(F.ank).y - hip.y;
    if (this.phase !== 'down' && knee > o.standAngle - 15) this.standH.learn(hipH);
    const drop = this.standH.value ? 1 - hipH / this.standH.value : null;

    const faults = [];
    if (!front) {
      if (progress > 0.4 && lean > o.maxLean) faults.push('lean');
      if (progress > 0.6 && f.seen([F.heel, F.toe], 0.4)) {
        const heel = f.p(F.heel), toe = f.p(F.toe);
        if (Math.atan2(toe.y - heel.y, Math.abs(toe.x - heel.x)) * DEG > o.heelLift) faults.push('heel');
      }
    } else if (progress > 0.4) {
      // Knee inside the hip–ankle line, toward the other leg.
      const h = f.p(F.hip), k = f.p(F.knee), a = f.p(F.ank);
      const along = (k.y - h.y) / ((a.y - h.y) || 1);
      const lineX = h.x + (a.x - h.x) * along;
      const inward = Math.sign(f.p(B.hip).x - h.x) * (k.x - lineX);
      if (inward / (f.d(F.hip, F.knee) || 1) > o.caveBy) faults.push('knee');
    }
    const kv = Math.round(knee);
    return {
      status: 'active',
      progress,
      faults,
      drop,
      knee,
      side: F.key,
      stats: [
        { label: 'Front knee', value: `${kv}°` },
        { label: 'Lean', value: deg(lean), fault: 'lean' },
      ],
      overlay: [
        seg(B.hip, B.knee, 'neutral', 5),
        seg(B.knee, B.ank, 'neutral', 5),
        seg(F.hip, F.knee, 'fault:knee'),
        seg(F.knee, F.ank, 'fault:knee'),
        arc(F.hip, F.knee, F.ank, `${kv}°`),
        dots([F.hip, F.knee, F.ank]),
      ],
    };
  }

  repState(m) {
    return { maxDrop: m.drop, minKnee: m.knee };
  }

  trackRep(r, m) {
    if (m.drop != null) r.maxDrop = Math.max(r.maxDrop ?? -Infinity, m.drop);
    r.minKnee = Math.min(r.minKnee, m.knee);
  }

  repBlocks(r) {
    return r.maxDrop != null && r.maxDrop < this.opts.minDrop ? ['drop'] : [];
  }

  repDetail(r) {
    return `front knee ${Math.round(r.minKnee)}°`;
  }
}

/**
 * Romanian deadlifts (dumbbell or barbell), side-on. Progress is the weight
 * travelling down the legs, from where it hangs standing to the knees. It
 * must be a hinge: the hips go back and the torso tips forward while the
 * knees stay soft; squatting the weight down doesn't count.
 */
export class HingeAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    kneeWarn: 145,
    kneeBlock: 125,
    minLean: 40, // torso must tip at least this far forward (deg)
    standLean: 20, // ...and come back to within this of upright
    drift: 0.35, // weight hanging this far in front of the knee (thigh lengths)
    minEccMs: 800,
  };
  static statLabels = ['Hinge', 'Knees'];
  static meterLabel = 'depth';
  static text = {
    noPerson: 'Stand side-on to the camera holding the weight',
    toStart: 'Stand tall with the weight at your thighs to start',
    ready: 'Ready — push your hips back',
    going: (pct) => `Hips back… ${pct}%`,
    reached: 'Stretched — drive your hips forward to stand',
    notCounted: 'Not counted — lower the weight at least to your knees',
    notCountedVoice: 'Lower',
    incomplete: { rep: 'stand all the way up and squeeze your glutes', voice: 'Stand tall', miss: 'Not counted — stand all the way up between reps', missVoice: 'Stand tall' },
    faults: {
      squat: { rep: 'squatted the weight down', miss: 'Not counted — push your hips back; don’t squat it down', missVoice: 'Hips back' },
      hinge: { rep: 'torso stayed upright', miss: 'Not counted — hinge: push your hips back and tip your chest forward', missVoice: 'Hinge' },
      knees: { live: 'Keep your knees soft, not bent — push your hips back', rep: 'knees bent too much', voice: 'Hips back', cue: 'Hips back' },
      drift: { live: 'Keep the weight close to your legs', rep: 'weight drifted away from your legs', voice: 'Keep it close', cue: 'Keep it close' },
      fast: { rep: 'dropped into the bottom — lower with control', voice: 'Slower' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.uStand = new Baseline(0.15);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee', 'ank', 'wr']);
    if (!f.seen([S.sh, S.hip, S.knee, S.ank, S.wr], 0.45)) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    if (sideSwitched(this, S)) this.uStand.reset();
    const sh = f.p(S.sh), hip = f.p(S.hip), knee = f.p(S.knee), wr = f.p(S.wr);
    const lean = fromUp(sub(sh, hip));
    if (lean > 120) return setup('Stand up to start', 'Stand up');
    const kneeAng = f.ang(S.hip, S.knee, S.ank);
    const thigh = f.d(S.hip, S.knee) || 1;
    if (this.phase !== 'down' && knee.y - hip.y < 0.3 * thigh) return setup('Stand up to start', 'Stand up');
    // How far the weight hangs above the knees, in thigh lengths: from where it hangs standing to 0.
    const above = (knee.y - wr.y) / thigh;
    if (this.phase !== 'down' && lean < 15) this.uStand.learn(above);
    const start = Math.max(0.2, this.uStand.value ?? 0.6);
    const progress = (start - above) / start;
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const faults = [];
    if (progress > 0.3 && kneeAng < o.kneeWarn) faults.push('knees');
    if (progress > 0.4 && chest) {
      const fwd = Math.sign(chest.x) || 1;
      if (((wr.x - knee.x) * fwd) / (f.d(S.hip, S.knee) || 1) > o.drift) faults.push('drift');
    }
    return {
      status: 'active',
      progress,
      faults,
      lean,
      kneeAng,
      stats: [
        { label: 'Hinge', value: deg(lean) },
        { label: 'Knees', value: deg(kneeAng), fault: 'knees' },
      ],
      overlay: [
        dash({ x: f.lm[S.knee].x - 0.1, y: f.lm[S.knee].y }, { x: f.lm[S.knee].x + 0.1, y: f.lm[S.knee].y }),
        seg(S.sh, S.hip, 'go', 6),
        seg(S.hip, S.knee, 'fault:knees'),
        seg(S.knee, S.ank, 'fault:knees'),
        seg(S.sh, S.wr, 'fault:drift', 4),
        dots([S.sh, S.hip, S.knee, S.wr]),
      ],
    };
  }

  repState(m) {
    return { minKnee: m.kneeAng, maxLean: m.lean };
  }

  trackRep(r, m) {
    r.minKnee = Math.min(r.minKnee, m.kneeAng);
    r.maxLean = Math.max(r.maxLean, m.lean);
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.minKnee < o.kneeBlock) out.push('squat');
    else if (r.maxLean < o.minLean) out.push('hinge');
    return out;
  }

  canFinish(m) {
    return m.lean <= this.opts.standLean;
  }

  repDetail(r) {
    return `hinge ${Math.round(r.maxLean)}°, knees ${Math.round(r.minKnee)}°`;
  }
}

/**
 * Hip thrusts (barbell or B-stance), upper back on the bench, side-on.
 * Progress is the hip opening from the bottom to flat from shoulders to
 * knees. Arching the lower back to get higher is called out, and so is
 * where the feet are (shins should be vertical at the top).
 */
export class HipThrustAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    bottom: 115,
    top: 170,
    countAt: 0.93,
    archBy: 0.1, // hips above the shoulder–knee line (torso lengths)
    shinMax: 22, // shin tilt from vertical at the top (deg)
    minTopMs: 250,
    minDrop: 0.15, // at the bottom the hips sit at least this far below the knees (torso lengths)
  };
  static statLabels = ['Hips', 'Shins'];
  static meterLabel = 'lockout';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Set up side-on: upper back on the bench, feet flat',
    toStart: 'Lower your hips to start',
    ready: 'Ready — drive your hips up',
    going: (pct) => `Drive… ${pct}%`,
    reached: 'Flat — squeeze your glutes',
    notCounted: 'Not counted — drive up until you’re flat from shoulders to knees',
    notCountedVoice: 'Hips higher',
    incomplete: { rep: 'lower your hips all the way down', voice: 'All the way down', miss: 'Not counted — lower your hips all the way between reps', missVoice: 'All the way down' },
    faults: {
      arch: { live: 'Don’t arch — ribs down, squeeze your glutes', rep: 'arched the lower back', voice: 'Ribs down', cue: 'Ribs down' },
      shins: { rep: 'feet too far out or too close — shins should be vertical at the top', voice: 'Check your feet' },
      squeeze: { rep: 'no squeeze at the top', voice: 'Squeeze at the top' },
      low: { rep: 'hips didn’t go down', miss: 'Not counted — lower your hips toward the floor between reps', missVoice: 'Hips down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee', 'ank']);
    if (!f.seen([S.sh, S.hip, S.knee, S.ank], 0.45)) return partial('Turn side-on so I can see your shoulders, hips, knees and feet', 'Turn side on');
    const kneeAng = f.ang(S.hip, S.knee, S.ank);
    const sh = f.p(S.sh), hip = f.p(S.hip), knee = f.p(S.knee), ank = f.p(S.ank);
    const upright = fromUp(sub(sh, hip)) < 35;
    if (upright || kneeAng < 40 || kneeAng > 145 || knee.y > ank.y) return setup('Upper back on the bench, knees bent, feet flat on the floor', 'Back on the bench, feet flat');
    const hipAng = f.ang(S.sh, S.hip, S.knee);
    const torso = f.d(S.sh, S.hip) || 1;
    const arch = dot(sub(hip, sh), upNormal(sub(knee, sh))) / torso;
    // Lowest the hips got while resting at the bottom (for "did they really go down").
    if (this.phase !== 'down') this.restDrop = Math.max(this.phase === 'up' ? this.restDrop ?? -Infinity : -Infinity, (hip.y - knee.y) / torso);
    const shinTilt = 180 - fromUp(sub(ank, knee));
    const progress = (hipAng - o.bottom) / (o.top - o.bottom);
    const faults = progress > 0.7 && arch > o.archBy ? ['arch'] : [];
    return {
      status: 'active',
      progress,
      faults,
      shinTilt,
      hipDrop: (hip.y - knee.y) / torso,
      stats: [
        { label: 'Hips', value: deg(hipAng), fault: 'arch' },
        { label: 'Shins', value: deg(shinTilt), fault: 'shins' },
      ],
      overlay: [dash(S.sh, S.knee), seg(S.sh, S.hip, 'fault:arch'), seg(S.hip, S.knee, 'fault:arch'), seg(S.knee, S.ank, 'neutral', 5), arc(S.sh, S.hip, S.knee, deg(hipAng)), dots([S.sh, S.hip, S.knee])],
    };
  }

  repState(m, prev) {
    const start = prev ? prev.backM : m;
    return { topMs: 0, lastT: null, topShin: null, hipDrop: Math.max(start.hipDrop, this.restDrop ?? -Infinity) };
  }

  trackRep(r, m, p) {
    const t = this.lastSeen;
    if (p >= 0.9) {
      if (r.lastT != null) r.topMs += t - r.lastT;
      r.topShin = Math.max(r.topShin ?? 0, m.shinTilt);
    }
    r.lastT = t;
  }

  repBlocks(r) {
    return r.hipDrop < this.opts.minDrop ? ['low'] : [];
  }

  repIssues(r) {
    const out = [];
    if (r.topShin != null && r.topShin > this.opts.shinMax) out.push('shins');
    if (r.max >= this.countAt && r.topMs < this.opts.minTopMs) out.push('squeeze');
    return out;
  }
}

/**
 * Prone dumbbell leg curls, face down on the bench, side-on. Progress is the
 * knee bending from straight to the shin upright; the hips have to stay down.
 */
export class LegCurlAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    rest: 165,
    top: 90,
    countAt: 0.93,
    hipWarn: 0.1, // hips rising off the bench (torso lengths)
    hipBlock: 0.2,
    eccentric: 'up',
    minEccMs: 900,
  };
  static statLabels = ['Knee', 'Hips'];
  static meterLabel = 'curl';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Lie face down on the bench, side-on to the camera',
    toStart: 'Straighten your legs to start',
    ready: 'Ready — curl your heels toward your glutes',
    going: (pct) => `Curl… ${pct}%`,
    reached: 'Top — lower slowly',
    notCounted: 'Not counted — curl until your shins are upright',
    notCountedVoice: 'Curl higher',
    incomplete: { rep: 'lower until your knees are nearly straight', voice: 'All the way down' },
    faults: {
      hips: { live: 'Keep your hips down on the bench', rep: 'hips lifted', voice: 'Hips down', cue: 'Hips down', miss: 'Not counted — keep your hips down; don’t swing the weight up', missVoice: 'Hips down' },
      fast: { rep: 'dropped the dumbbell — lower slowly', voice: 'Slower down' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    this.hipBase = new Baseline(0.1);
    super.reset();
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['sh', 'hip', 'knee', 'ank']);
    if (!f.seen([S.sh, S.hip, S.knee, S.ank], 0.45)) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), knee = f.p(S.knee);
    const tilt = elevation(sub(sh, hip));
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    if (Math.abs(tilt) > (this.phase === 'down' ? 45 : 30)) return setup('Lie face down on the bench', 'Lie face down');
    if (chest && chest.y < -0.2) return setup('Turn over — lie face down', 'Face down');
    const kneeAng = f.ang(S.hip, S.knee, S.ank);
    const torso = f.d(S.sh, S.hip) || 1;
    const hipUp = dot(sub(hip, sh), upNormal(sub(knee, sh))) / torso;
    if (this.phase !== 'down') this.hipBase.learn(hipUp);
    const lift = hipUp - (this.hipBase.value ?? hipUp);
    const faults = lift > o.hipWarn ? ['hips'] : [];
    const kv = Math.round(kneeAng);
    return {
      status: 'active',
      progress: (o.rest - kneeAng) / (o.rest - o.top),
      faults,
      lift,
      stats: [
        { label: 'Knee', value: `${kv}°` },
        { label: 'Hips', value: lift > o.hipWarn ? 'up' : 'down', fault: 'hips' },
      ],
      overlay: [dash(S.sh, S.knee, 'fault:hips'), seg(S.hip, S.knee), seg(S.knee, S.ank), arc(S.hip, S.knee, S.ank, `${kv}°`), dots([S.hip, S.knee, S.ank])],
    };
  }

  repState(m) {
    return { maxLift: m.lift };
  }

  trackRep(r, m) {
    r.maxLift = Math.max(r.maxLift, m.lift);
  }

  repBlocks(r) {
    return r.maxLift > this.opts.hipBlock ? ['hips'] : [];
  }
}

/**
 * Standing calf raises, side-on with the legs in view. Progress is the ankles
 * rising from the bottom of the set (in shin lengths), and the knees have to
 * rise with them — the whole straight leg goes up. Standing up out of a squat
 * lifts the hips but not the knees, and foot landmarks alone are too jumpy
 * to count on, so neither can fake a rep. Knees stay straight.
 */
export class CalfRaiseAnalyzer extends RepCounter {
  static sideOnly = true;
  static defaults = {
    range: 0.15, // ankle rise from the bottom to the top (shin lengths, ~6 cm)
    countAt: 0.9,
    kneeBlock: 150,
    kneeShare: 0.7, // the knees must rise at least this share of what the ankles did
    minTopMs: 250, // held at the top at least this long
    eccentric: 'up',
    minEccMs: 1000,
    minPauseMs: 600,
    minRepMs: 600,
  };
  static statLabels = ['Heel', 'Knees'];
  static meterLabel = 'height';
  static tempo = ['↑', '↓'];
  static text = {
    noPerson: 'Stand side-on to the camera with your feet in view',
    toStart: 'Lower your heels to start',
    ready: 'Ready — rise onto your toes',
    going: (pct) => `Up… ${pct}%`,
    reached: 'Top — hold, then lower slowly',
    notCounted: 'Not counted — rise as high as you can onto your toes',
    notCountedVoice: 'Higher',
    incomplete: { rep: 'lower your heels all the way down', voice: 'All the way down', miss: 'Not counted — lower all the way into the stretch between reps', missVoice: 'All the way down' },
    faults: {
      knees: { rep: 'knees bent', miss: 'Not counted — keep your knees straight; don’t push with your legs', missVoice: 'Straight legs' },
      rise: { rep: 'legs didn’t rise', miss: 'Not counted — rise straight up onto your toes', missVoice: 'Rise up' },
      hold: { rep: 'bounced off the top', miss: 'Not counted — rise all the way and hold the top for a moment', missVoice: 'Hold the top' },
      fast: { rep: 'dropped down — lower over 2 to 3 seconds', voice: 'Slower down' },
      pause: { rep: 'no pause in the bottom stretch', voice: 'Pause at the bottom' },
    },
  };

  reset() {
    this.sides = new SidePicker();
    super.reset();
  }

  resetFilters() {
    this.ankLow = new LowWater(0.02); // shins/s
    this.kneeLow = new LowWater(0.02);
    this.ankEma = new Ema(0.35);
    this.kneeEma = new Ema(0.35);
    this.lastT = null;
  }

  measure(frame) {
    const o = this.opts;
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, ['hip', 'knee', 'ank']);
    if (!f.seen([S.hip, S.knee, S.ank], 0.45)) return partial('Turn side-on so I can see your legs and feet', 'Turn side on');
    if (sideSwitched(this, S)) this.resetFilters();
    // The movement is only a few centimetres: it needs a clear view of the shins.
    if (!bigEnough(f, S.knee, S.ank, 90)) return partial('Move the phone closer — I need a bigger view of your legs', 'Move closer');
    const kneeAng = f.ang(S.hip, S.knee, S.ank);
    if (f.v(S.sh) >= 0.5 && fromUp(sub(f.p(S.sh), f.p(S.hip))) > 30) return setup('Stand up tall', 'Stand tall');
    if (kneeAng < (this.phase === 'down' ? 110 : 140)) return setup('Stand tall with your knees straight', 'Straighten your legs');
    const dt = this.lastT == null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    const shin = f.d(S.knee, S.ank) || 1;
    // Heights in shin lengths (up is +). The bottom only moves while standing straight.
    const ankH = this.ankEma.next(-f.p(S.ank).y / shin);
    const kneeH = this.kneeEma.next(-f.p(S.knee).y / shin);
    const straight = kneeAng >= 150;
    const resting = this.phase !== 'down';
    const ankRise = ankH - (straight || this.ankLow.value == null ? this.ankLow.next(ankH, dt, resting) : this.ankLow.value);
    const kneeRise = kneeH - (straight || this.kneeLow.value == null ? this.kneeLow.next(kneeH, dt, resting) : this.kneeLow.value);
    const foot = f.seen([S.heel, S.toe], 0.4) ? Math.atan2(f.p(S.toe).y - f.p(S.heel).y, Math.abs(f.p(S.toe).x - f.p(S.heel).x)) * DEG : null;
    return {
      status: 'active',
      progress: ankRise / o.range,
      faults: [],
      kneeAng,
      ankRise,
      kneeRise,
      stats: [
        { label: 'Heel', value: foot == null ? '–' : deg(foot) },
        { label: 'Knees', value: deg(kneeAng), fault: 'knees' },
      ],
      overlay: [seg(S.hip, S.knee, 'neutral', 5), seg(S.knee, S.ank, 'go', 5), ...(foot == null ? [] : [seg(S.heel, S.toe)]), dots([S.knee, S.ank])],
    };
  }

  repState(m) {
    return { minKnee: m.kneeAng, maxAnk: m.ankRise, maxKnee: m.kneeRise, topMs: 0, lastT: null };
  }

  trackRep(r, m, p) {
    r.minKnee = Math.min(r.minKnee, m.kneeAng);
    r.maxAnk = Math.max(r.maxAnk, m.ankRise);
    r.maxKnee = Math.max(r.maxKnee, m.kneeRise);
    const t = this.lastSeen;
    if (p >= this.countAt && r.lastT != null) r.topMs += t - r.lastT;
    r.lastT = t;
  }

  repBlocks(r) {
    const o = this.opts;
    const out = [];
    if (r.minKnee < o.kneeBlock) out.push('knees');
    else if (r.maxKnee < o.kneeShare * r.maxAnk) out.push('rise');
    if (r.max >= this.countAt && r.topMs < o.minTopMs) out.push('hold');
    return out;
  }
}

