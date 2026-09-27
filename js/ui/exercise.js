import { $, setText, banner } from './dom.js';
import { figure } from './icons.js';

/** An exercise session: runs the analyzer and drives the stats dock. */
export class ExerciseTool {
  constructor(app, entry) {
    this.app = app;
    this.kind = 'exercise';
    this.entry = entry;
    this.title = entry.name;
    this.hint = `${entry.view} · ${entry.blurb}`;
    this.analyzer = entry.create(app.settings);
    this.view = null;
    this.notReadySince = null;
    this.dotsKey = -1;
  }

  get needsMasks() {
    return false;
  }

  get wantsHands() {
    return false;
  }

  enter() {
    $('guideArt').innerHTML = figure(this.entry.id);
    $('guideSteps').replaceChildren(...this.entry.setup.map((s) => Object.assign(document.createElement('li'), { textContent: s })));
    this.notReadySince = null;
    this.dotsKey = -1;
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
    this.render(this.analyzer.update({ lm: null, t: 0 }).hud);
  }

  interrupt() {
    this.analyzer.interrupt();
  }

  update(frame) {
    const view = this.analyzer.update(frame, this.app.angleSource());
    this.view = view;
    for (const ev of view.events) {
      if (ev.type === 'rep' && ev.rep.counted) this.bump();
      if (ev.type === 'set') this.bump();
      const line = this.analyzer.voiceLine(ev);
      if (line) this.app.voice.say(line, ev.type === 'cue' ? { key: ev.key, gapMs: 2500 } : {});
    }
    banner(view.message, view.tone);
    this.render(view.hud);

    const notReady = view.status !== 'active';
    if (notReady) this.notReadySince ??= frame.t;
    else this.notReadySince = null;
    const seen = this.app.settings.guidesSeen[this.entry.id];
    $('guide').hidden = !(notReady && !seen && this.analyzer.count === 0 && frame.t - this.notReadySince > 1200);
    return { outline: false };
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
