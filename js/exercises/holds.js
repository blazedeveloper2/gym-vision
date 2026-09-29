import { P, SidePicker } from '../geometry.js';
import { HoldTimer } from './base.js';
import { Frame, nearSide, ChestSide, LEFT, RIGHT, sub, dot, unit, perp, fromUp, elevation, partial, setup, seg, dash, dots, deg, DEG, sideSwitched } from './kit.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Static holds, side-on. The timer only runs while you're really in the
 * position (upside down for a handstand, feet off the floor for a planche,
 * body level for a lever, shoulders and legs up for a hollow hold), and time
 * with a form fault held doesn't count toward form %.
 */
class ShapeHold extends HoldTimer {
  static sideOnly = true;
  static statLabels = ['Line'];

  reset() {
    this.sides = new SidePicker();
    this.chest = new ChestSide();
    super.reset();
  }

  /** Near-side joints plus the lowest leg point we can see (ankle, else knee). */
  body(frame, keys = ['sh', 'hip', 'wr', 'el']) {
    const f = new Frame(frame);
    const S = nearSide(this.sides, f, keys);
    const foot = f.v(S.ank) >= 0.4 ? S.ank : f.v(S.knee) >= 0.4 ? S.knee : null;
    return { f, S, foot };
  }

  /** Signed hip offset from the shoulder–foot line: + toward the chest (an arch), − toward the back (a pike). */
  hipOffset(f, S, foot) {
    const sh = f.p(S.sh), hip = f.p(S.hip), ft = f.p(foot);
    const axis = unit(sub(ft, sh));
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const n = unit(perp(axis));
    const off = dot(sub(hip, sh), n) / (f.d(S.sh, S.hip) || 1);
    if (!chest) return 0;
    return dot(n, chest) >= 0 ? off : -off;
  }
}

/**
 * Handstands: chest to the wall, toe pulls, freestanding, one arm; and
 * freestanding kick-ups, where every time you get upside down is an attempt
 * and the time you catch is what's scored.
 */
export class HandstandHold extends ShapeHold {
  static defaults = {
    variant: 'wall', // 'wall' | 'free' | 'oneArm'
    maxTilt: 35, // body within this of vertical (deg)
    elbowMin: 155,
    shoulderMin: 155, // hip–shoulder–elbow: arms in line with the body
    archBy: 0.08,
    pikeBy: 0.12,
  };
  static meterLabel = 'line';
  static text = {
    noPerson: 'Set up side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      bent: { live: 'Lock your elbows', cue: 'Lock your arms' },
      shoulders: { live: 'Push tall — shoulders by your ears', cue: 'Push tall' },
      banana: { live: 'Ribs in, squeeze your glutes — straight line', cue: 'Ribs in' },
      pike: { live: 'Open your hips — straight line', cue: 'Open your hips' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const { f, S, foot } = this.body(frame);
    if (!f.seen([S.sh, S.wr, S.hip]) || foot == null) return partial('Turn side-on so I can see you from hands to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), ft = f.p(foot), torso = f.d(S.sh, S.hip) || 1;
    const inverted = hip.y < sh.y - 0.3 * torso && ft.y < hip.y && fromUp(sub(ft, sh)) <= o.maxTilt;
    const handsDown = f.p(S.wr).y > sh.y;
    if (!inverted || !handsDown) {
      const msg = o.variant === 'wall' ? 'Walk up the wall into your handstand — timer starts when you’re upside down' : 'Kick up into your handstand — timer starts when you’re upside down';
      return setup(msg, o.variant === 'wall' ? 'Walk up the wall' : 'Kick up');
    }
    let elbow = f.v(S.el) >= 0.4 ? f.ang(S.sh, S.el, S.wr) : 180;
    if (o.variant === 'oneArm') {
      if (!f.seen([LEFT.wr, RIGHT.wr], 0.25)) return partial('Turn so I can see both hands', 'Show both hands');
      const [a, b] = [f.p(LEFT.wr).y, f.p(RIGHT.wr).y];
      if (Math.abs(a - b) < 0.35 * torso) return setup('Shift onto one hand and lift the other — timer starts on one arm', 'Lift one hand');
      const support = a > b ? LEFT : RIGHT; // lower hand is on the floor
      elbow = f.v(support.el) >= 0.4 ? f.ang(support.sh, support.el, support.wr) : 180;
    }
    const line = f.ang(S.sh, S.hip, foot);
    const off = this.hipOffset(f, S, foot);
    const shoulders = f.v(S.el) >= 0.4 ? f.ang(S.hip, S.sh, S.el) : 180;
    const faults = [];
    if (elbow < o.elbowMin) faults.push('bent');
    if (shoulders < o.shoulderMin) faults.push('shoulders');
    if (line < 165) faults.push(off >= 0 ? (off > o.archBy ? 'banana' : null) : -off > o.pikeBy ? 'pike' : null);
    return {
      status: 'active',
      progress: clamp01(1 - (180 - line) / 30),
      faults: faults.filter(Boolean),
      stats: [{ label: 'Line', value: deg(line), fault: 'banana|pike' }],
      overlay: [dash(S.wr, foot), seg(S.wr, S.sh, 'fault:bent|shoulders'), seg(S.sh, S.hip, 'fault:banana|pike', 6), seg(S.hip, foot, 'fault:banana|pike', 6), dots([S.wr, S.sh, S.hip, foot])],
    };
  }
}

/** Planche ladder, side-on: frog stand → full planche. The feet have to be off the floor. */
const PLANCHE = {
  frog: { straight: false },
  saFrog: { straight: true },
  tuck: { straight: true, hips: true },
  advTuck: { straight: true, hips: true, open: 75 },
  straddle: { straight: true, hips: true, legs: true },
  halfLay: { straight: true, hips: true, halfLay: true },
  full: { straight: true, hips: true, legs: true, line: true },
};

// Leg shape each step needs before the timer runs (knee angle, hip angle), so a plank or a push-up isn't a planche.
const PLANCHE_LEGS = {
  frog: { kneeMax: 115 },
  saFrog: { kneeMax: 115 },
  tuck: { kneeMax: 115 },
  advTuck: { kneeMax: 135, hipMin: 50, hipMax: 145 },
  straddle: { kneeMin: 130 },
  halfLay: { kneeMax: 140, hipMin: 130 },
  full: { kneeMin: 130 },
};

export class PlancheHold extends ShapeHold {
  static defaults = { step: 'frog', elbowMin: 155, lift: 0.06, hipsLow: 0.15, hipsGate: 0.4, hipsGateLong: 0.25, legsLow: 0.25 };
  static meterLabel = 'level';
  static text = {
    noPerson: 'Set up side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      bent: { live: 'Lock your elbows — straight arms', cue: 'Lock your arms' },
      hipsLow: { live: 'Hips up — level with your shoulders', cue: 'Hips up' },
      tucked: { live: 'Push your knees back — thighs square to your body', cue: 'Knees back' },
      knees: { live: 'Straighten your legs — lock your knees', cue: 'Lock your knees' },
      legsLow: { live: 'Lift your legs up to hip height', cue: 'Legs up' },
      pike: { live: 'Open your hips — one straight line', cue: 'Open your hips' },
    },
  };

  resetFilters() {
    this.floors = {};
    this.lastT = null;
  }

  measure(frame) {
    const o = this.opts;
    const spec = PLANCHE[o.step] || PLANCHE.frog;
    const legs = PLANCHE_LEGS[o.step] || PLANCHE_LEGS.frog;
    const { f, S, foot } = this.body(frame);
    if (!f.seen([S.sh, S.el, S.wr, S.hip, S.knee]) || foot == null) return partial('Turn side-on so I can see your hands, hips and feet', 'Turn side on');
    if (sideSwitched(this, S)) this.floors = {};
    const sh = f.p(S.sh), hip = f.p(S.hip), wr = f.p(S.wr), torso = f.d(S.sh, S.hip) || 1;
    if (wr.y < sh.y || wr.y < hip.y) return setup('Hands on the floor, shoulder-width, fingers spread', 'Hands on the floor');
    // Held up on the arms: hands on the floor under the elbows, shoulders well above them.
    // (Lying face down, or at the bottom of a push-up, the shoulders are nearly down on the hands.)
    if (f.p(S.el).y > wr.y || (wr.y - sh.y) / torso < 0.5) return setup('Press up onto your hands', 'Up on your hands');
    // Feet: their lowest visible point (toe or heel), against where it rests between holds.
    const pts = [S.toe, S.heel].filter((i) => f.v(i) >= 0.4);
    if (!pts.length) return partial('Move back so I can see your feet', 'Show your feet');
    const toeY = Math.max(...pts.map((i) => f.p(i).y));
    const dt = this.lastT == null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    // The floor follows the feet down at once, and creeps up only between holds (it stays put during one).
    const cur = this.floors.foot;
    if (cur == null || toeY > cur) this.floors.foot = toeY;
    else if (!this.current) this.floors.foot = cur - Math.min(cur - toeY, 0.03 * torso * dt);
    if ((this.floors.foot - toeY) / torso < o.lift) return setup('Lean forward until your feet float off the floor — the timer starts then', 'Lean until your feet float');
    // A plank has the hips sloping down to the feet; the planche keeps them up (level, for the straight-leg steps).
    const hipsGate = legs.kneeMin != null || o.step === 'halfLay' ? o.hipsGateLong : o.hipsGate;
    if ((hip.y - sh.y) / torso > hipsGate) return setup('Hips up — level with your shoulders', 'Hips up');
    const knee = f.v(S.ank) >= 0.4 ? f.ang(S.hip, S.knee, S.ank) : 180;
    const hipAng = f.ang(S.sh, S.hip, S.knee);
    const shape = (legs.kneeMax == null || knee <= legs.kneeMax) && (legs.kneeMin == null || knee >= legs.kneeMin) && (legs.hipMin == null || hipAng >= legs.hipMin) && (legs.hipMax == null || hipAng <= legs.hipMax);
    if (!shape) {
      const say = { frog: 'Tuck your knees in', saFrog: 'Tuck your knees in', tuck: 'Tuck your knees in', halfLay: 'Knees bent, hips open', advTuck: 'Thighs square to your body, knees bent' }[o.step] || 'Straighten your legs';
      return setup(say, say);
    }
    const elbow = f.ang(S.sh, S.el, S.wr);
    const faults = [];
    if (spec.straight && elbow < o.elbowMin) faults.push('bent');
    if (spec.hips && (hip.y - sh.y) / torso > o.hipsLow) faults.push('hipsLow');
    const hipKnee = f.v(S.knee) >= 0.4 ? f.ang(S.sh, S.hip, S.knee) : 180;
    if (spec.open && hipKnee < spec.open) faults.push('tucked');
    if (spec.legs) {
      if (f.v(S.knee) >= 0.4 && f.v(S.ank) >= 0.4 && f.ang(S.hip, S.knee, S.ank) < 155) faults.push('knees');
      if ((f.p(foot).y - hip.y) / torso > o.legsLow) faults.push('legsLow');
    }
    if (spec.halfLay && hipKnee < 150) faults.push('pike');
    if (spec.line && f.ang(S.sh, S.hip, foot) < 160) faults.push('pike');
    const level = 1 - Math.min(1, Math.abs(elevation(sub(hip, sh))) / 30);
    return {
      status: 'active',
      progress: spec.hips ? level : 1,
      faults: [...new Set(faults)],
      stats: [{ label: 'Elbow', value: deg(elbow), fault: 'bent' }],
      overlay: [seg(S.wr, S.el, 'fault:bent'), seg(S.el, S.sh, 'fault:bent'), seg(S.sh, S.hip, 'fault:hipsLow|pike', 6), seg(S.hip, foot, 'fault:legsLow|knees|pike|tucked', 6), dots([S.wr, S.sh, S.hip, foot])],
    };
  }
}

/** Front lever ladder, side-on, hanging from a bar: tuck → full. */
const LEVER = {
  tuck: {},
  advTuck: { open: 75 },
  straddle: { legs: true },
  halfLay: { halfLay: true },
  full: { legs: true, line: true },
};

export class LeverHold extends ShapeHold {
  static defaults = { step: 'tuck', elbowMin: 160, maxTilt: 30, hipsLow: 0.15 };
  static meterLabel = 'level';
  static text = {
    noPerson: 'Hang from the bar, side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      bent: { live: 'Lock your elbows — straight arms', cue: 'Lock your arms' },
      hipsLow: { live: 'Hips up — level with your shoulders', cue: 'Hips up' },
      tucked: { live: 'Push your knees away — thighs square to your body', cue: 'Knees away' },
      knees: { live: 'Straighten your legs', cue: 'Lock your knees' },
      pike: { live: 'Open your hips — legs in line with your body', cue: 'Open your hips' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const spec = LEVER[o.step] || LEVER.tuck;
    const { f, S, foot } = this.body(frame);
    if (!f.seen([S.sh, S.el, S.wr, S.hip]) || foot == null) return partial('Turn side-on so I can see your arms, hips and legs', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), torso = f.d(S.sh, S.hip) || 1;
    if (f.p(S.wr).y > sh.y) return setup('Hang from the bar', 'Hang from the bar');
    const tilt = Math.abs(elevation(sub(hip, sh)));
    if (tilt > o.maxTilt + 15) return setup('Pull your body up level — the timer starts when your back is flat', 'Get your back level');
    const elbow = f.ang(S.sh, S.el, S.wr);
    const hipKnee = f.v(S.knee) >= 0.4 ? f.ang(S.sh, S.hip, S.knee) : 180;
    const faults = [];
    if (elbow < o.elbowMin) faults.push('bent');
    if ((hip.y - sh.y) / torso > o.hipsLow) faults.push('hipsLow');
    if (spec.open && hipKnee < spec.open) faults.push('tucked');
    if (spec.legs && f.v(S.knee) >= 0.4 && f.v(S.ank) >= 0.4 && f.ang(S.hip, S.knee, S.ank) < 155) faults.push('knees');
    if (spec.halfLay && hipKnee < 150) faults.push('pike');
    if (spec.line && f.ang(S.sh, S.hip, foot) < 160) faults.push('pike');
    if (spec.legs && !spec.line && f.ang(S.sh, S.hip, foot) < 150) faults.push('pike');
    return {
      status: 'active',
      progress: clamp01(1 - tilt / 30),
      faults: [...new Set(faults)],
      stats: [{ label: 'Body', value: deg(tilt), fault: 'hipsLow' }],
      overlay: [dash({ x: f.lm[S.sh].x - 0.15, y: f.lm[S.sh].y }, { x: f.lm[S.sh].x + 0.15, y: f.lm[S.sh].y }), seg(S.wr, S.sh, 'fault:bent'), seg(S.sh, S.hip, 'fault:hipsLow', 6), seg(S.hip, foot, 'fault:pike|knees|tucked', 6), dots([S.wr, S.sh, S.hip, foot])],
    };
  }
}

/** Hollow body holds on your back, side-on: tuck, one leg, full, arms overhead. */
export class HollowHold extends ShapeHold {
  static defaults = { step: 'full', liftGate: 6, shoulderMin: 9, legsGate: 0.12, crunchMax: 40, legsMin: 8, armsMin: 140, switchLegs: false };
  static meterLabel = 'hollow';
  static text = {
    noPerson: 'Lie on your back, side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      shoulders: { live: 'Lift your shoulder blades off the floor', cue: 'Shoulders up' },
      crunch: { live: 'Don’t crunch up — just lift your shoulder blades', cue: 'Lower your chest' },
      legsLow: { live: 'Raise your legs a little — keep your lower back flat', cue: 'Legs higher' },
      knees: { live: 'Straighten your legs', cue: 'Straight legs' },
      arms: { live: 'Arms overhead, biceps by your ears', cue: 'Arms back' },
      kneeAway: { live: 'Pull your bent knee in to your chest', cue: 'Knee in' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const { f, S } = this.body(frame, ['sh', 'hip', 'knee', 'ank']);
    if (!f.seen([S.sh, S.hip, S.knee]) || f.v(S.ank) < 0.4) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), torso = f.d(S.sh, S.hip) || 1;
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const lift = elevation(sub(sh, hip));
    if (Math.abs(lift) > 60 || (chest && chest.y > 0.2)) return setup('Lie on your back on the floor', 'Lie on your back');
    if (lift < o.liftGate) return setup('Lift your shoulder blades off the floor — the timer starts then', 'Shoulders up');
    const feetUp = Math.max(...[LEFT.ank, RIGHT.ank].filter((i) => f.v(i) >= 0.3).map((i) => (hip.y - f.p(i).y) / torso));
    if (!(feetUp >= o.legsGate)) return setup('Lift your feet off the floor — the timer starts then', 'Feet up');
    const legs = [LEFT, RIGHT].filter((L) => f.seen([L.hip, L.knee, L.ank], 0.3)).map((L) => ({
      L,
      knee: f.ang(L.hip, L.knee, L.ank),
      hipAng: f.ang(L.sh, L.hip, L.knee),
      up: Math.atan2(f.p(L.hip).y - f.p(L.ank).y, Math.abs(f.p(L.ank).x - f.p(L.hip).x)) * DEG,
    }));
    const near = legs.find((l) => l.L === S) || legs[0];
    const faults = [];
    if (o.step === 'tuck') {
      if (near.knee > 115 || near.hipAng > 115) return setup('Pull your knees in toward your chest', 'Knees in');
    } else if (o.step === 'oneLeg') {
      const straight = legs.filter((l) => l.knee >= 145);
      const bent = legs.filter((l) => l.knee < 115);
      if (!straight.length || !bent.length) return setup('One leg long and low, the other knee tucked in', 'One leg long, one knee in');
      if (straight[0].up < o.legsMin) faults.push('legsLow');
      if (bent[0].hipAng > 110) faults.push('kneeAway');
    } else {
      if (near.knee < 150) faults.push('knees');
      if (near.up < o.legsMin) faults.push('legsLow');
      if (o.step === 'overhead' && f.v(S.wr) >= 0.4 && f.ang(S.hip, S.sh, S.wr) < o.armsMin) faults.push('arms');
    }
    if (lift < o.shoulderMin) faults.push('shoulders');
    if (lift > o.crunchMax) faults.push('crunch');
    return {
      status: 'active',
      progress: clamp01(lift / 15),
      faults,
      stats: [{ label: 'Shoulders', value: deg(lift), fault: 'shoulders|crunch' }],
      overlay: [seg(S.sh, S.hip, 'fault:shoulders|crunch', 6), seg(S.hip, S.knee, 'fault:legsLow|knees|kneeAway'), seg(S.knee, S.ank, 'fault:legsLow|knees'), dots([S.sh, S.hip, S.knee, S.ank])],
    };
  }

  voiceLine(event) {
    if (event.type === 'milestone' && this.opts.switchLegs && event.seconds === 10) return '10 seconds. Switch legs';
    return super.voiceLine(event);
  }
}

/** Arch holds face down, side-on: arms by the sides, or overhead. */
export class ArchHold extends ShapeHold {
  static defaults = { step: 'hold', liftGate: 10, legsGate: 0.12, kneeMin: 150, neckMax: 35, armsMin: 140 };
  static meterLabel = 'arch';
  static text = {
    noPerson: 'Lie face down, side-on to the camera',
    holding: (clock) => `Hold it! ${clock}`,
    faults: {
      knees: { live: 'Keep your legs straight — lift from the hips', cue: 'Straight legs' },
      neck: { live: 'Keep your neck long — look at the floor', cue: 'Chin down' },
      arms: { live: 'Reach your arms overhead', cue: 'Arms overhead' },
      hands: { live: 'Lift your hands off the floor', cue: 'Hands up' },
    },
  };

  measure(frame) {
    const o = this.opts;
    const { f, S } = this.body(frame, ['sh', 'hip', 'knee', 'ank']);
    if (!f.seen([S.sh, S.hip, S.knee]) || f.v(S.ank) < 0.4) return partial('Turn side-on so I can see you from shoulders to feet', 'Turn side on');
    const sh = f.p(S.sh), hip = f.p(S.hip), torso = f.d(S.sh, S.hip) || 1;
    const chest = this.chest.update(f, S, unit(sub(sh, hip)));
    const lift = elevation(sub(sh, hip));
    if (Math.abs(lift) > 60 || (chest && chest.y < -0.2)) return setup('Lie face down on the floor', 'Lie face down');
    if (lift < o.liftGate) return setup('Lift your chest off the floor — the timer starts then', 'Chest up');
    if ((hip.y - f.p(S.ank).y) / torso < o.legsGate) return setup('Lift your legs off the floor too', 'Legs up');
    const faults = [];
    if (f.ang(S.hip, S.knee, S.ank) < o.kneeMin) faults.push('knees');
    const head = [P.nose, S.ear].find((i) => f.v(i) >= 0.5);
    if (head != null) {
      // Head tipped back from the line of the torso.
      const t = unit(sub(sh, hip));
      const h = unit(sub(f.p(head), sh));
      if (Math.acos(Math.max(-1, Math.min(1, dot(t, h)))) * DEG > o.neckMax && h.y < t.y) faults.push('neck');
    }
    if (o.step === 'overhead' && f.v(S.wr) >= 0.4) {
      if (f.ang(S.hip, S.sh, S.wr) < o.armsMin) faults.push('arms');
      else if (f.p(S.wr).y > sh.y + 0.05 * torso) faults.push('hands');
    }
    return {
      status: 'active',
      progress: clamp01(lift / 15),
      faults,
      stats: [{ label: 'Chest', value: deg(lift) }],
      overlay: [seg(S.sh, S.hip, 'go', 6), seg(S.hip, S.knee, 'fault:knees'), seg(S.knee, S.ank, 'fault:knees'), dots([S.sh, S.hip, S.ank])],
    };
  }
}
