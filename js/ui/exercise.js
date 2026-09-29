import { $, setText, banner, h } from './dom.js';
import { figure } from './icons.js';

/**
 * An exercise session: runs the analyzer, drives the stats dock and speaks.
 *
 * Voice: rep counts, why a rep didn't count, form cues as they happen, and
 * setup help ("Turn side-on…") when you're in view but not in position —
 * before your first rep, or when you lose position mid-set, never while
 * you're resting between sets.
 */
export class ExerciseTool {
  /** @param meta { name, rx } when opened from your program */
  constructor(app, entry, meta = null) {
    this.app = app;
    this.kind = 'exercise';
    this.entry = entry;
    this.meta = meta;
    this.title = meta?.name || entry.name;
    this.hint = [meta?.rx, entry.view, entry.blurb].filter(Boolean).join(' · ');
    this.analyzer = entry.create(app.settings);
    this.view = null;
    this.notReadySince = null;
    this.dotsKey = -1;
    this.resetVoice();
  }

  get needsMasks() {
    return false;
  }

  get wantsHands() {
    return false;
  }

  resetVoice() {
    this.setupMsg = null;
    this.setupSince = 0;
    this.setupSpoken = false;
    this.everActive = false;
    this.lastActive = -Infinity;
    this.lastDone = -Infinity;
  }

  enter() {
    const e = this.entry;
    $('guideArt').innerHTML = figure(e.fig || e.id);
    $('guideSteps').replaceChildren(...e.setup.map((s) => h('li', {}, s)));
    $('guideChecks').replaceChildren(...(e.checks || []).map((s) => h('li', {}, s)));
    this.notReadySince = null;
    this.dotsKey = -1;
    this.resetVoice();
    this.render(this.analyzer.update({ lm: null, t: 0 }).hud);
  }

  exit() {
    $('guide').hidden = true;
  }

  applySettings() {
    const opts = this.entry.options?.(this.app.settings);
    if (opts) this.analyzer.setOptions(opts);
  }

  reset() {
    this.analyzer.reset();
    this.dotsKey = -1;
    this.resetVoice();
    this.render(this.analyzer.update({ lm: null, t: 0 }).hud);
  }

  interrupt() {
    this.analyzer.interrupt();
  }

  update(frame) {
    const view = this.analyzer.update(frame, this.app.angleSource());
    this.view = view;
    for (const ev of view.events) {
      if ((ev.type === 'rep' && ev.rep.counted) || ev.type === 'set') this.bump();
      if (ev.type === 'rep' || ev.type === 'set') this.lastDone = frame.t;
      const line = this.analyzer.voiceLine(ev);
      if (line) this.app.voice.say(line, ev.type === 'cue' ? { key: ev.key, gapMs: 2500 } : {});
    }
    this.speakSetup(view, frame.t);
    banner(view.message, view.tone);
    this.render(view.hud);

    const notReady = view.status !== 'active';
    if (notReady) this.notReadySince ??= frame.t;
    else this.notReadySince = null;
    const seen = this.app.settings.guidesSeen[this.entry.id];
    $('guide').hidden = !(notReady && !seen && this.analyzer.count === 0 && frame.t - this.notReadySince > 1200);
    return { outline: false };
  }

  /** Say what to fix to get in position, once per message, if it's worth saying now. */
  speakSetup(view, t) {
    if (view.status === 'active') {
      this.everActive = true;
      this.lastActive = t;
      this.setupMsg = null;
      return;
    }
    if (view.status !== 'setup' && view.status !== 'partial') return;
    const say = view.say || view.message;
    if (!say) return;
    if (say !== this.setupMsg) {
      this.setupMsg = say;
      this.setupSince = t;
      this.setupSpoken = false;
    }
    // Before the first rep; or lost position mid-set (recently active, no rep/hold just finished).
    const worth = !this.everActive || (t - this.lastActive < 6000 && t - this.lastDone > 8000);
    if (!this.setupSpoken && worth && t - this.setupSince > 2500) {
      this.setupSpoken = true;
      this.app.voice.say(say, { key: `setup:${say}`, gapMs: 15000 });
    }
  }

  draw(overlay, frame) {
    const { lm } = frame;
    if (!lm) return;
    const v = this.view;
    overlay.skeleton(lm, { alpha: v?.status === 'active' ? 0.35 : 0.8 });
    if (v?.overlay) overlay.drawSpec(lm, v.overlay);
  }

  bump() {
    const el = $('repCount');
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  render(hud) {
    if (!hud) return;
    setText($('repCount'), hud.big);
    setText($('repLabel'), hud.bigLabel);
    setText($('repSub'), hud.sub);
    if (hud.dotsKey !== this.dotsKey) {
      this.dotsKey = hud.dotsKey;
      $('repLog').replaceChildren(...hud.dots.map((c) => Object.assign(document.createElement('i'), { className: c === 'good' ? '' : c })));
    }
    const fill = $('meterFill');
    fill.style.height = `${(hud.meter * 100).toFixed(1)}%`;
    fill.classList.toggle('reached', hud.reached);
    const val = $('meterVal');
    setText(val, hud.meterText);
    val.classList.toggle('reached', hud.reached);
    setText($('meterLabel'), hud.meterLabel);

    const list = $('statList');
    if (list.childElementCount !== hud.stats.length * 2) {
      list.replaceChildren(...hud.stats.flatMap(() => [document.createElement('dt'), document.createElement('dd')]));
    }
    hud.stats.forEach((s, i) => {
      setText(list.children[i * 2], s.label);
      const dd = list.children[i * 2 + 1];
      setText(dd, s.value);
      dd.classList.toggle('warn', !!s.warn);
    });
  }
}
