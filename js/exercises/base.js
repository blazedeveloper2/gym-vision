import { clamp, vis } from '../geometry.js';

const SIDE_ON = { status: 'partial', message: 'Turn so the camera sees you side-on', say: 'Turn side on to the camera' };

/**
 * Plainly facing the camera (or filmed end-on along the body): the shoulders
 * look wide next to the torso. Side-on they overlap. A 3/4 view passes.
 */
export function headOn(frame) {
  const { lm, w, h } = frame;
  if ([11, 12, 23, 24].some((i) => vis(lm[i]) < 0.6)) return false;
  const px = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const [ls, rs, lh, rh] = [11, 12, 23, 24].map(px);
  const shoulders = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const torso = Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2) || 1;
  return shoulders / torso > 0.6;
}

/**
 * Shared rep-counting engine. Each exercise maps a frame to `progress`:
 * 0 at the start position, 1 at the target (e.g. push-up depth). The engine
 * turns that into reps, checks form faults and builds the HUD and messages.
 *
 * What stops a rep from counting, besides the exercise's own checks
 * (`repBlocks`):
 * - it never reached the target (`countAt`);
 * - it started somewhere other than the start position (`armAtStart`): you
 *   can't jump to the top of a pull-up and lower down for a rep;
 * - it came back less than about two-thirds of the way before the next one
 *   (`strictBack`): half reps don't count;
 * - it was quicker than `minRepMs` (tracking noise), or, for negatives, the
 *   lowering was quicker than `negativeMs`.
 */
export const REP_DEFAULTS = {
  startAt: 0.3, // progress beyond this starts a rep
  finishAt: 0.15, // back below this finishes it
  countAt: 0.95, // deepest progress needed for the rep to count
  bounce: 0.45, // came back this far from the target (or the deepest point, if short of it)...
  rebound: 0.2, // ...then went deeper again: a rep without a full return
  strictBack: 0.35, // ...and if it came back less than this far, it doesn't count at all
  holdMs: 350, // a form fault must last this long before it's flagged
  minRepMs: 400, // anything faster is treated as tracking noise
  lostMs: 1500, // tracking lost this long abandons the rep in progress
  armAtStart: true, // reps only begin once you've been seen in the start position
  eccentric: 'down', // the lowering half: 'down' = start → target (press, squat), 'up' = target → start (curl, pull-up)
  minEccMs: 0, // lowering quicker than this is flagged as 'fast'
  minPauseMs: 0, // starting a rep with less of a pause than this at the start is flagged as 'pause'
  negativeMs: 0, // > 0: lowering-only reps, counted at the target if they took at least this long
};

// Issues any exercise can report; exercises override the wording.
const GENERIC_FAULTS = {
  fast: { rep: 'lowered too fast — control it', voice: 'Slower', miss: 'Not counted — lower slowly, with control', missVoice: 'Slower' },
  pause: { rep: 'no pause between reps', voice: 'Pause' },
};

const TEXT_DEFAULTS = {
  noPerson: 'Step into view so I can see your whole body',
  toStart: 'Get into the start position',
  ready: 'Ready — start your first rep',
  next: 'Ready for the next rep',
  going: (pct) => `Keep going… ${pct}%`,
  reached: 'Target reached — now back!',
  good: (n) => `Good rep! ${n}`,
  notCounted: 'Not counted — use the full range of motion',
  notCountedVoice: 'Full range',
  incomplete: { rep: 'return all the way to the start', voice: 'All the way back', miss: 'Not counted — come all the way back between reps', missVoice: 'All the way back' },
  // key: { live: banner while it happens, rep: after the rep, voice: with the count, cue: spoken live,
  //        miss / missVoice: why a rep didn't count, when this issue blocked it }
  faults: {},
};

/** Class text, then instance text; fault entries merge key by key. */
function mergeText(base, ...layers) {
  const out = { ...base, faults: { ...GENERIC_FAULTS, ...base.faults } };
  for (const t of layers) {
    if (!t) continue;
    const { faults, incomplete, ...rest } = t;
    Object.assign(out, rest);
    if (incomplete) out.incomplete = { ...out.incomplete, ...incomplete };
    for (const [k, v] of Object.entries(faults || {})) out.faults[k] = { ...out.faults[k], ...v };
  }
  return out;
}

/** A static property from every class in the chain, base class first (so subclasses add to their parents). */
function inherited(ctor, key) {
  const out = [];
  for (let c = ctor; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (Object.prototype.hasOwnProperty.call(c, key)) out.unshift(c[key]);
  }
  return out;
}

const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`;
export const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Resolve semantic tones ('go', 'fault:a|b') into drawing tones. */
function resolveTones(items, reached, held) {
  for (const item of items || []) {
    if (item.tone === 'go') item.tone = reached ? 'good' : 'active';
    else if (item.tone?.startsWith?.('fault:')) {
      item.tone = item.tone.slice(6).split('|').some((k) => held.has(k)) ? 'warn' : 'neutral';
    }
  }
}

function resolveStats(stats, held) {
  return stats.map((s) => ({ ...s, warn: s.warn ?? (s.fault ? s.fault.split('|').some((k) => held.has(k)) : false) }));
}

export class RepCounter {
  static defaults = {};
  static text = {};
  static statLabels = ['–', '–'];
  static meterLabel = 'depth';
  static tempo = ['↓', '↑'];
  static sideOnly = false; // only reads side-on: head-on, it asks you to turn

  /**
   * @param options  overrides for the defaults (REP_DEFAULTS, then the class's)
   * @param text     overrides for the class's wording (faults merge key by key)
   */
  constructor(options = {}, text = null) {
    this.opts = Object.assign({}, REP_DEFAULTS, ...inherited(this.constructor, 'defaults'), options);
    this.text = mergeText(TEXT_DEFAULTS, ...inherited(this.constructor, 'text'), text);
    this.reset();
  }

  setOptions(options) {
    Object.assign(this.opts, options);
  }

  get countAt() {
    return this.opts.countAt;
  }

  reset() {
    this.count = 0;
    this.clean = 0;
    this.partials = 0;
    this.sideCount = { L: 0, R: 0 };
    this.log = [];
    this.phase = 'setup'; // 'setup' (not yet at the start) | 'up' (at start) | 'down' (in a rep) | 'bottom' (negative done)
    this.rep = null;
    this.lastRep = null;
    this.lastRepAt = -Infinity;
    this.lastSeen = -Infinity;
    this.startSince = null; // when the current stay at the start position began
    this.lastStartAt = -Infinity; // last time at the start position
    this.faultSince = new Map();
    this.resetFilters();
  }

  /** Abandon the rep in progress (tracking lost, video seeked, ...). */
  interrupt() {
    this.rep = null;
    if (this.phase === 'down' || this.phase === 'bottom') this.phase = this.opts.armAtStart ? 'setup' : 'up';
    this.lastRepAt = -Infinity;
    this.startSince = null;
    this.faultSince.clear();
    this.resetFilters();
  }

  get summary() {
    return { count: this.count, clean: this.clean, partials: this.partials, sides: this.sideCount, log: this.log };
  }

  summaryText() {
    return `${this.count} reps (${this.clean} clean, ${this.partials} not counted)`;
  }

  // ---- hooks for subclasses ----
  /** @returns {{status, message?, say?, progress?, faults?, stats?, overlay?, side?}} */
  measure() {
    throw new Error('measure() not implemented');
  }
  resetFilters() {}
  repState() {
    return {};
  }
  trackRep() {}
  canFinish() {
    return true;
  }
  repIssues() {
    return [];
  }
  /** Anti-cheat checks: issue keys that stop an otherwise deep-enough rep from counting. */
  repBlocks() {
    return [];
  }
  repDetail(r) {
    return `${Math.round(r.max * 100)}% of target`;
  }

  update(frame, source = 'auto') {
    const o = this.opts;
    const t = frame.t;
    const view = { status: 'none', message: this.text.noPerson, tone: 'info', events: [], overlay: null };

    if (!frame.lm) {
      if (this.rep && t - this.lastSeen > o.lostMs) this.interrupt();
      return this.finish(view, new Set());
    }
    this.lastSeen = t;

    const m = this.constructor.sideOnly && headOn(frame) ? SIDE_ON : this.measure(frame, source);
    view.overlay = m.overlay || null;
    if (m.status !== 'active') {
      if (m.status === 'setup' && this.phase !== 'setup') {
        this.interrupt();
        this.phase = 'setup';
      }
      view.status = m.status;
      view.message = m.message;
      view.say = m.say;
      return this.finish(view, new Set());
    }

    // A fault only counts once it has lasted holdMs.
    const live = new Set(m.faults || []);
    const held = new Set();
    for (const key of Object.keys(this.text.faults)) {
      if (!live.has(key)) {
        this.faultSince.delete(key);
        continue;
      }
      if (!this.faultSince.has(key)) this.faultSince.set(key, t);
      if (t - this.faultSince.get(key) >= o.holdMs) held.add(key);
    }

    const p = m.progress;
    if (this.phase === 'setup') {
      if (o.armAtStart && p >= o.startAt) {
        // In position, but not at the start: a rep can't begin halfway through.
        Object.assign(view, { status: 'setup', message: this.text.toStart, progress: p, stats: m.stats });
        return this.finish(view, new Set());
      }
      this.phase = 'up';
      view.events.push({ type: 'ready' });
    }
    if (this.phase === 'bottom' && p < o.finishAt) this.phase = 'up';
    if (this.phase === 'up') {
      if (p < o.finishAt) {
        this.startSince ??= t;
        this.lastStartAt = t;
      } else if (p > o.startAt) {
        this.phase = 'down';
        this.rep = this.newRep(t, p, m, null);
        this.startSince = null;
      }
    }
    if (this.phase === 'down') {
      const r = this.rep;
      if (p > r.max) {
        Object.assign(r, { max: p, maxAt: t, back: p, backAt: t, backM: m, side: m.side ?? r.side });
      } else if (p < r.back) {
        Object.assign(r, { back: p, backAt: t, backM: m });
      }
      this.trackRep(r, m, p);
      for (const key of held) {
        r.faults.add(key);
        if (!r.cued.has(key)) {
          r.cued.add(key);
          view.events.push({ type: 'cue', key });
        }
      }
      if (o.negativeMs && p >= this.countAt) {
        // Lowering-only rep: it's done at the bottom; get back to the start however you like.
        this.complete(t, true, view, { negative: true });
        this.phase = 'bottom';
      } else if (p < o.finishAt && this.canFinish(m, r)) {
        this.complete(t, true, view);
        this.startSince = t;
        this.lastStartAt = t;
      } else if (Math.min(r.max, 1) - r.back > o.bounce && p > r.back + o.rebound && this.canFinish(r.backM, r)) {
        // Came most of the way back, then went again without returning fully. Measured from
        // the target, not an overshoot: 80% deep is still at the bottom, however deep it went.
        this.complete(r.backAt, false, view);
        this.phase = 'down';
        this.rep = this.newRep(t, p, m, r);
      }
    }

    const reached = this.phase === 'down' && p >= this.countAt;
    Object.assign(view, { status: 'active', progress: p, reached, stats: m.stats });

    const say = (message, tone) => Object.assign(view, { message, tone });
    const fault = [...held][0];
    const recent = this.lastRep && t >= this.lastRepAt && t - this.lastRepAt < 1800;
    if (fault && this.text.faults[fault].live) say(this.text.faults[fault].live, 'warn');
    else if (this.phase === 'down' && reached) say(this.text.reached, 'good');
    else if (this.phase === 'down') say(this.text.going(Math.round(clamp(p, 0, 1) * 100)), 'info');
    else if (recent) say(...this.repText(this.lastRep));
    else if (this.phase === 'bottom') say(this.text.toStart, 'info');
    else say(this.count === 0 ? this.text.ready : this.text.next, 'info');

    return this.finish(view, held);
  }

  newRep(t, p, m, prev) {
    return {
      start: t,
      // A rep straight after a full return starts from the moment it left the start position.
      from: prev ? prev.backAt : Math.max(this.lastStartAt, t - 3000),
      pause: prev ? 0 : this.startSince == null ? 0 : this.lastStartAt - this.startSince,
      max: p,
      maxAt: t,
      back: p,
      backAt: t,
      backM: m,
      side: m.side ?? null,
      faults: new Set(),
      cued: new Set(),
      ...this.repState(m, prev),
    };
  }

  complete(tEnd, fullReturn, view, { negative = false } = {}) {
    const o = this.opts;
    const r = this.rep;
    this.rep = null;
    this.phase = 'up';
    if (tEnd - r.start < o.minRepMs) return;

    const deep = r.max >= this.countAt;
    const blocks = [...this.repBlocks(r)];
    const downMs = Math.max(0, r.maxAt - r.from);
    const upMs = negative ? 0 : Math.max(0, tEnd - r.maxAt);
    const eccMs = o.eccentric === 'up' ? upMs : downMs;
    if (negative && downMs < o.negativeMs) blocks.push('fast');
    if (!fullReturn && r.back > o.strictBack) blocks.push('incomplete');
    const counted = deep && blocks.length === 0;
    const issues = [];
    if (!deep) issues.push('depth');
    for (const key of blocks) issues.push(key);
    for (const key of Object.keys(this.text.faults)) if (r.faults.has(key) && !issues.includes(key)) issues.push(key);
    for (const key of this.repIssues(r)) if (!issues.includes(key)) issues.push(key);
    if (!negative && o.minEccMs && eccMs < o.minEccMs && !issues.includes('fast')) issues.push('fast');
    if (o.minPauseMs && r.pause < o.minPauseMs && this.log.length && !issues.includes('pause')) issues.push('pause');
    if (!fullReturn && !issues.includes('incomplete')) issues.push('incomplete');

    const rep = {
      counted,
      n: counted ? ++this.count : null,
      max: r.max,
      side: r.side,
      detail: this.repDetail(r),
      downMs,
      upMs,
      issues,
      blocks,
    };
    if (!counted) this.partials++;
    else {
      if (issues.length === 0) this.clean++;
      if (r.side === 'L' || r.side === 'R') this.sideCount[r.side]++;
    }

    this.log.push(rep);
    if (this.log.length > 200) this.log.shift();
    this.lastRep = rep;
    this.lastRepAt = tEnd;
    view.events.push({ type: 'rep', rep });
  }

  issueText(key, field) {
    return key === 'incomplete' ? this.text.incomplete[field] : this.text.faults[key]?.[field];
  }

  /**
   * The issue that best explains a rep not counting, if it has its own
   * message: a check that blocked it, else a specific shortfall (e.g. "hands
   * didn't go overhead") rather than a generic tempo note.
   */
  missKey(rep) {
    const has = (k) => !!this.issueText(k, 'miss');
    return (
      (rep.blocks || []).find(has) ||
      rep.issues.find((k) => k !== 'depth' && k !== 'incomplete' && !(k in GENERIC_FAULTS) && has(k)) ||
      null
    );
  }

  repText(rep) {
    if (!rep.counted) {
      const key = this.missKey(rep);
      return [key ? this.issueText(key, 'miss') : this.text.notCounted, 'bad'];
    }
    const issue = rep.issues.find((k) => k !== 'depth' && this.issueText(k, 'rep'));
    if (issue) return [`Rep ${rep.n} — ${this.issueText(issue, 'rep')}`, 'warn'];
    return [this.text.good(rep.n), 'good'];
  }

  voiceLine(event) {
    if (event.type === 'cue') return this.text.faults[event.key]?.cue || '';
    if (event.type !== 'rep') return '';
    const { rep } = event;
    if (!rep.counted) {
      const key = this.missKey(rep);
      return (key && this.issueText(key, 'missVoice')) || this.text.notCountedVoice;
    }
    const issue = rep.issues.find((k) => k !== 'depth' && this.issueText(k, 'voice'));
    return issue ? `${rep.n}. ${this.issueText(issue, 'voice')}` : String(rep.n);
  }

  finish(view, held) {
    resolveTones(view.overlay, view.reached, held);
    view.heldFaults = held;
    const active = view.status === 'active';
    const stats = view.stats ? resolveStats(view.stats, held) : this.constructor.statLabels.map((label) => ({ label, value: '–' }));
    const last = this.log[this.log.length - 1];
    const [a, b] = this.constructor.tempo;
    const { L, R } = this.sideCount;
    const shown = active || view.progress != null;
    view.hud = {
      big: String(this.count),
      bigLabel: 'reps',
      sub: L + R > 0 ? `L ${L} · R ${R} · ${this.partials} not counted` : `${this.clean} clean · ${this.partials} not counted`,
      meter: shown ? clamp(view.progress, 0, 1.2) / 1.2 : 0,
      meterText: shown ? `${Math.round(clamp(view.progress, 0, 1) * 100)}%` : '–',
      meterLabel: this.constructor.meterLabel,
      reached: !!view.reached,
      stats: [...stats, { label: 'Tempo', value: last ? `${a}${fmtSec(last.downMs)} ${b}${fmtSec(last.upMs)}` : '–' }],
      dots: this.log.slice(-12).map((r) => (!r.counted ? 'bad' : r.issues.length ? 'warn' : 'good')),
      dotsKey: this.count + this.partials,
    };
    return view;
  }
}

/**
 * Timed holds (plank, handstand, levers...). The timer runs while the
 * exercise reports being in position; time with a held form fault doesn't
 * count toward form %. A fault is spoken when it starts, again if it comes
 * back after being fixed, and every few seconds while it lasts.
 */
export const HOLD_DEFAULTS = { holdMs: 400, graceMs: 800, minSetMs: 3000, milestoneMs: 10000, recueMs: 6000, attempts: false };

const HOLD_TEXT = {
  noPerson: TEXT_DEFAULTS.noPerson,
  holding: (clock) => `Hold it! ${clock}`,
  start: 'Hold',
  faults: {},
};

export class HoldTimer {
  static defaults = {};
  static text = {};
  static statLabels = ['–'];
  static meterLabel = 'body line';
  static sideOnly = false;

  constructor(options = {}, text = null) {
    this.opts = Object.assign({}, HOLD_DEFAULTS, ...inherited(this.constructor, 'defaults'), options);
    this.text = mergeText(HOLD_TEXT, ...inherited(this.constructor, 'text'), text);
    delete this.text.faults.fast;
    delete this.text.faults.pause;
    this.reset();
  }

  setOptions(options) {
    Object.assign(this.opts, options);
  }

  reset() {
    this.sets = [];
    this.best = 0;
    this.current = null;
    this.faultSince = new Map();
    this.resetFilters();
  }

  interrupt() {
    this.current = null;
    this.faultSince.clear();
    this.resetFilters();
  }

  resetFilters() {}

  get count() {
    return this.sets.length;
  }

  get summary() {
    return { count: this.sets.length, best: this.best, log: this.sets };
  }

  summaryText() {
    const what = this.opts.attempts ? 'attempts' : 'holds';
    return `${this.sets.length} ${what}, best ${fmtClock(this.best)}`;
  }

  update(frame, source = 'auto') {
    const o = this.opts;
    const t = frame.t;
    const view = { status: 'none', message: this.text.noPerson, tone: 'info', events: [], overlay: null };
    const m = !frame.lm ? { status: 'none', message: this.text.noPerson } : this.constructor.sideOnly && headOn(frame) ? SIDE_ON : this.measure(frame, source);
    view.overlay = m.overlay || null;
    const held = new Set();

    if (m.status === 'active') {
      if (!this.current) {
        this.current = { start: t, last: t, total: 0, good: 0, faults: new Set(), cued: new Map(), next: o.milestoneMs };
        view.events.push({ type: 'start' });
      }
      const c = this.current;
      const dt = clamp(t - c.last, 0, 250);
      c.last = t;
      c.total += dt;
      const live = new Set(m.faults || []);
      for (const key of Object.keys(this.text.faults)) {
        if (!live.has(key)) {
          this.faultSince.delete(key);
          continue;
        }
        if (!this.faultSince.has(key)) this.faultSince.set(key, t);
        if (t - this.faultSince.get(key) >= o.holdMs) held.add(key);
      }
      if (held.size === 0) c.good += dt;
      for (const key of held) {
        c.faults.add(key);
        const since = this.faultSince.get(key);
        const last = c.cued.get(key);
        // Cue when it starts (or starts again after a fix), then every recueMs while it lasts.
        if (last == null || last < since || t - last >= o.recueMs) {
          c.cued.set(key, t);
          view.events.push({ type: 'cue', key });
        }
      }
      if (c.total >= c.next) {
        view.events.push({ type: 'milestone', seconds: Math.round(c.next / 1000) });
        c.next += o.milestoneMs;
      }
      const fault = [...held][0];
      Object.assign(view, {
        status: 'active',
        progress: m.progress,
        stats: m.stats,
        message: fault ? this.text.faults[fault].live : this.text.holding(fmtClock(c.total)),
        tone: fault ? 'warn' : 'good',
      });
    } else {
      if (this.current && t - this.current.last > o.graceMs) this.endSet(view);
      Object.assign(view, { status: m.status, message: m.message || this.text.noPerson, say: m.say });
    }

    resolveTones(view.overlay, false, held);
    const c = this.current;
    const last = this.sets[this.sets.length - 1];
    const active = view.status === 'active';
    const stats = active && view.stats ? resolveStats(view.stats, held) : this.constructor.statLabels.map((label) => ({ label, value: '–' }));
    const form = c && c.total > 0 ? c.good / c.total : last ? last.form : null;
    const what = o.attempts ? (this.sets.length === 1 ? 'attempt' : 'attempts') : this.sets.length === 1 ? 'set' : 'sets';
    view.hud = {
      big: fmtClock(c ? c.total : last ? last.ms : 0),
      bigLabel: c ? 'holding' : 'hold time',
      sub: `Best ${fmtClock(this.best)} · ${this.sets.length} ${what}`,
      meter: active ? clamp(m.progress, 0, 1.2) / 1.2 : 0,
      meterText: active ? `${Math.round(clamp(m.progress, 0, 1) * 100)}%` : '–',
      meterLabel: this.constructor.meterLabel,
      reached: active && held.size === 0,
      stats: [...stats, { label: 'Form', value: form == null ? '–' : `${Math.round(form * 100)}%` }],
      dots: this.sets.slice(-12).map((s) => (s.form >= 0.9 ? 'good' : s.form >= 0.6 ? 'warn' : 'bad')),
      dotsKey: this.sets.length,
    };
    return view;
  }

  endSet(view) {
    const c = this.current;
    this.current = null;
    if (c.total < this.opts.minSetMs) return;
    const set = { ms: c.total, form: c.good / c.total, issues: [...c.faults] };
    this.sets.push(set);
    this.best = Math.max(this.best, c.total);
    view.events.push({ type: 'set', set });
  }

  voiceLine(event) {
    if (event.type === 'cue') return this.text.faults[event.key]?.cue || '';
    if (event.type === 'start') return this.text.start || '';
    if (event.type === 'milestone') return `${event.seconds} seconds`;
    if (event.type === 'set') {
      const s = Math.round(event.set.ms / 1000);
      return this.opts.attempts ? `${s} ${s === 1 ? 'second' : 'seconds'}` : `Nice! ${s} seconds`;
    }
    return '';
  }
}
