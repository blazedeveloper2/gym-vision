import { clamp } from '../geometry.js';

/**
 * Shared rep-counting engine. Each exercise maps a frame to `progress`:
 * 0 at the start position, 1 at the target (e.g. push-up depth). The engine
 * turns that into reps, checks form faults and builds the HUD and messages.
 */
export const REP_DEFAULTS = {
  startAt: 0.3, // progress beyond this starts a rep
  finishAt: 0.15, // back below this finishes it
  countAt: 0.95, // deepest progress needed for the rep to count
  bounce: 0.45, // came back this far from the deepest point...
  rebound: 0.2, // ...then went deeper again: a rep without a full return
  holdMs: 350, // a form fault must last this long before it's flagged
  minRepMs: 400, // anything faster is treated as tracking noise
  lostMs: 1500, // tracking lost this long abandons the rep in progress
};

const TEXT_DEFAULTS = {
  noPerson: 'Step into view so I can see your whole body',
  ready: 'Ready — start your first rep',
  next: 'Ready for the next rep',
  going: (pct) => `Keep going… ${pct}%`,
  reached: 'Target reached — now back!',
  good: (n) => `Good rep! ${n}`,
  notCounted: 'Not counted — use the full range of motion',
  notCountedVoice: 'Full range',
  incomplete: { rep: 'return all the way to the start', voice: 'All the way back' },
  // key: { live: banner while it happens, rep: after the rep, voice: with the count, cue: spoken live,
  //        miss / missVoice: why a rep didn't count, when this issue blocked it }
  faults: {},
};

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

  constructor(options = {}) {
    this.opts = { ...REP_DEFAULTS, ...this.constructor.defaults, ...options };
    this.text = { ...TEXT_DEFAULTS, ...this.constructor.text };
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
    this.log = [];
    this.phase = 'setup'; // 'setup' | 'up' (at start) | 'down' (in a rep)
    this.rep = null;
    this.lastRep = null;
    this.lastRepAt = -Infinity;
    this.lastSeen = -Infinity;
    this.faultSince = new Map();
    this.resetFilters();
  }

  /** Abandon the rep in progress (tracking lost, video seeked, ...). */
  interrupt() {
    this.rep = null;
    if (this.phase === 'down') this.phase = 'up';
    this.lastRepAt = -Infinity;
    this.faultSince.clear();
    this.resetFilters();
  }

  get summary() {
    return { count: this.count, clean: this.clean, partials: this.partials, log: this.log };
  }

  summaryText() {
    return `${this.count} reps (${this.clean} clean, ${this.partials} not counted)`;
  }

  // ---- hooks for subclasses ----
  /** @returns {{status, message?, progress?, faults?, stats?, overlay?}} */
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

    const m = this.measure(frame, source);
    view.overlay = m.overlay || null;
    if (m.status !== 'active') {
      if (m.status === 'setup' && this.phase !== 'setup') {
        this.interrupt();
        this.phase = 'setup';
      }
      view.status = m.status;
      view.message = m.message;
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
      this.phase = 'up';
      view.events.push({ type: 'ready' });
    }
    if (this.phase === 'up' && p > o.startAt) {
      this.phase = 'down';
      this.rep = this.newRep(t, p, m, null);
    }
    if (this.phase === 'down') {
      const r = this.rep;
      if (p > r.max) {
        Object.assign(r, { max: p, maxAt: t, back: p, backAt: t, backM: m });
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
      if (p < o.finishAt && this.canFinish(m, r)) {
        this.complete(t, true, view);
      } else if (r.max - r.back > o.bounce && p > r.back + o.rebound && this.canFinish(r.backM, r)) {
        // Came most of the way back, then went again without returning fully.
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
    if (fault) say(this.text.faults[fault].live, 'warn');
    else if (this.phase === 'down' && reached) say(this.text.reached, 'good');
    else if (this.phase === 'down') say(this.text.going(Math.round(clamp(p, 0, 1) * 100)), 'info');
    else if (recent) say(...this.repText(this.lastRep));
    else say(this.count === 0 ? this.text.ready : this.text.next, 'info');

    return this.finish(view, held);
  }

  newRep(t, p, m, prev) {
    return {
      start: t,
      max: p,
      maxAt: t,
      back: p,
      backAt: t,
      backM: m,
      faults: new Set(),
      cued: new Set(),
      ...this.repState(m, prev),
    };
  }

  complete(tEnd, fullReturn, view) {
    const r = this.rep;
    this.rep = null;
    this.phase = 'up';
    if (tEnd - r.start < this.opts.minRepMs) return;

    const deep = r.max >= this.countAt;
    const blocks = this.repBlocks(r);
    const counted = deep && blocks.length === 0;
    const issues = [];
    if (!deep) issues.push('depth');
    for (const key of blocks) issues.push(key);
    for (const key of Object.keys(this.text.faults)) if (r.faults.has(key) && !issues.includes(key)) issues.push(key);
    for (const key of this.repIssues(r)) if (!issues.includes(key)) issues.push(key);
    if (!fullReturn) issues.push('incomplete');

    const rep = {
      counted,
      n: counted ? ++this.count : null,
      max: r.max,
      detail: this.repDetail(r),
      downMs: Math.max(0, r.maxAt - r.start),
      upMs: Math.max(0, tEnd - r.maxAt),
      issues,
    };
    if (!counted) this.partials++;
    else if (issues.length === 0) this.clean++;

    this.log.push(rep);
    if (this.log.length > 200) this.log.shift();
    this.lastRep = rep;
    this.lastRepAt = tEnd;
    view.events.push({ type: 'rep', rep });
  }

  issueText(key, field) {
    return key === 'incomplete' ? this.text.incomplete[field] : this.text.faults[key]?.[field];
  }

  /** The issue that best explains a rep not counting, if it has its own message. */
  missKey(rep) {
    return rep.issues.find((k) => this.text.faults[k]?.miss) || null;
  }

  repText(rep) {
    if (!rep.counted) {
      const key = this.missKey(rep);
      return [key ? this.text.faults[key].miss : this.text.notCounted, 'bad'];
    }
    const issue = rep.issues.find((k) => k !== 'depth');
    if (issue) return [`Rep ${rep.n} — ${this.issueText(issue, 'rep')}`, 'warn'];
    return [this.text.good(rep.n), 'good'];
  }

  voiceLine(event) {
    if (event.type === 'cue') return this.text.faults[event.key]?.cue || '';
    if (event.type !== 'rep') return '';
    const { rep } = event;
    if (!rep.counted) {
      const key = this.missKey(rep);
      return (key && this.text.faults[key].missVoice) || this.text.notCountedVoice;
    }
    const issue = rep.issues.find((k) => k !== 'depth');
    return issue ? `${rep.n}. ${this.issueText(issue, 'voice')}` : String(rep.n);
  }

  finish(view, held) {
    resolveTones(view.overlay, view.reached, held);
    view.heldFaults = held;
    const active = view.status === 'active';
    const stats = active && view.stats ? resolveStats(view.stats, held) : this.constructor.statLabels.map((label) => ({ label, value: '–' }));
    const last = this.log[this.log.length - 1];
    const [a, b] = this.constructor.tempo;
    view.hud = {
      big: String(this.count),
      bigLabel: 'reps',
      sub: `${this.clean} clean · ${this.partials} not counted`,
      meter: active ? clamp(view.progress, 0, 1.2) / 1.2 : 0,
      meterText: active ? `${Math.round(clamp(view.progress, 0, 1) * 100)}%` : '–',
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
 * Timed holds (plank). The timer runs while the exercise reports being in
 * position; time with a held form fault doesn't count toward form %.
 */
export const HOLD_DEFAULTS = { holdMs: 400, graceMs: 800, minSetMs: 3000, milestoneMs: 10000 };

export class HoldTimer {
  static defaults = {};
  static text = {};
  static statLabels = ['–'];
  static meterLabel = 'body line';

  constructor(options = {}) {
    this.opts = { ...HOLD_DEFAULTS, ...this.constructor.defaults, ...options };
    this.text = { noPerson: TEXT_DEFAULTS.noPerson, faults: {}, ...this.constructor.text };
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
    return `${this.sets.length} holds, best ${fmtClock(this.best)}`;
  }

  update(frame, source = 'auto') {
    const o = this.opts;
    const t = frame.t;
    const view = { status: 'none', message: this.text.noPerson, tone: 'info', events: [], overlay: null };
    const m = frame.lm ? this.measure(frame, source) : { status: 'none', message: this.text.noPerson };
    view.overlay = m.overlay || null;
    const held = new Set();

    if (m.status === 'active') {
      if (!this.current) {
        this.current = { start: t, last: t, total: 0, good: 0, faults: new Set(), cued: new Set(), next: o.milestoneMs };
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
        if (!c.cued.has(key)) {
          c.cued.add(key);
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
      Object.assign(view, { status: m.status, message: m.message || this.text.noPerson });
    }

    resolveTones(view.overlay, false, held);
    const c = this.current;
    const last = this.sets[this.sets.length - 1];
    const active = view.status === 'active';
    const stats = active && view.stats ? resolveStats(view.stats, held) : this.constructor.statLabels.map((label) => ({ label, value: '–' }));
    const form = c && c.total > 0 ? c.good / c.total : last ? last.form : null;
    view.hud = {
      big: fmtClock(c ? c.total : last ? last.ms : 0),
      bigLabel: c ? 'holding' : 'hold time',
      sub: `Best ${fmtClock(this.best)} · ${this.sets.length} ${this.sets.length === 1 ? 'set' : 'sets'}`,
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
    if (event.type === 'milestone') return `${event.seconds} seconds`;
    if (event.type === 'set') return `Nice! ${Math.round(event.set.ms / 1000)} seconds`;
    return '';
  }
}
