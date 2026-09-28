import { STEPS, MEASURES, checkPose, measureFrame, StepCapture, combine } from '../body/measure.js';
import { loadHistory, addSession, deleteSession, seriesById, toCsv } from '../body/history.js';
import { COLORS } from '../render/overlay.js';
import { $, h, setText, banner, toast, fmtLen } from './dom.js';

const ORDER = ['front', 'flex', 'side'];
const CAPTURE_FRAMES = 20; // done after this many good frames...
const MIN_FRAMES = 8; // ...or this many once MIN_CAPTURE_MS has passed
const MIN_CAPTURE_MS = 1500;
const STALL_MS = 5000; // no usable frames this long: explain and start over
const HOLD_MS = 400; // pose must be right this long before the countdown
const COUNTDOWN_MS = 2000;

/**
 * Measure: guided captures (front, optional flex and side), each averaged
 * over up to 20 frames (about 1.5 s), then results and a history to track
 * growth.
 */
export class MeasureTool {
  constructor(app) {
    this.app = app;
    this.kind = 'measure';
    this.title = 'Measure';
    this.hint = 'Tight clothing · phone at chest height, 2–3 m away';
    this.lastLines = null;
    $('btnCapture').addEventListener('click', () => this.manualCapture());
    $('btnSkip').addEventListener('click', () => this.skip());
    $('btnHistory').addEventListener('click', () => this.showHistory());
    $('btnSaveResult').addEventListener('click', () => this.saveResult());
    $('btnRetake').addEventListener('click', () => {
      $('resultsDialog').close();
      this.restart();
    });
    $('btnExport').addEventListener('click', () => this.exportCsv());
  }

  get needsMasks() {
    return true;
  }

  get wantsHands() {
    return false;
  }

  /** Measurements need the more precise model. */
  get model() {
    return this.app.settings.model === 'heavy' ? 'heavy' : 'full';
  }

  enter() {
    this.restart();
  }

  exit() {
    this.phase = 'idle';
  }

  restart() {
    this.stepIndex = 0;
    this.captures = {};
    this.snapshot = null;
    this.startStep();
  }

  get step() {
    return ORDER[this.stepIndex];
  }

  startStep() {
    this.phase = 'align'; // align → countdown → capturing
    this.manual = false;
    this.okSince = null;
    this.countdownStart = 0;
    this.lastSpoken = null;
    this.capture = new StepCapture(this.step, this.app.settings.heightCm);
    this.lastLines = null;
    const s = STEPS[this.step];
    setText($('mStep'), `Step ${this.stepIndex + 1} of ${ORDER.length}${this.stepIndex > 0 ? ' · optional' : ''}`);
    setText($('mTitle'), s.title);
    setText($('mInstruction'), s.instruction);
    $('btnSkip').hidden = this.stepIndex === 0;
    $('mProgress').style.width = '0%';
    this.setStatus('Get into position', 'info');
  }

  setStatus(text, tone) {
    const el = $('mStatus');
    setText(el, text);
    if (el.dataset.tone !== tone) el.dataset.tone = tone;
  }

  manualCapture() {
    if (this.phase === 'align') {
      this.manual = true;
      this.phase = 'countdown';
      this.countdownStart = performance.now();
    }
  }

  skip() {
    if (this.stepIndex === 0) return;
    this.nextStep();
  }

  nextStep() {
    if (this.stepIndex < ORDER.length - 1) {
      this.stepIndex++;
      this.startStep();
      this.app.voice.say(STEPS[this.step].title === 'Flex' ? 'Now flex your biceps' : 'Now turn to your side');
    } else {
      this.showResults();
    }
  }

  update(frame, { mask }) {
    banner('', 'info');
    if (this.phase === 'idle' || this.phase === 'done') return { outline: true };
    const { lm, w, h } = frame;
    const now = performance.now();
    if (!lm) {
      this.phase = this.phase === 'capturing' ? 'capturing' : 'align';
      this.okSince = null;
      this.setStatus('Step into view', 'warn');
      return { outline: true };
    }
    // While capturing, only problems that would spoil the numbers pause it.
    const problems = checkPose(this.step, lm, w, h, { lenient: this.phase === 'capturing' });

    if (this.phase === 'align') {
      if (problems.length) {
        this.okSince = null;
        this.setStatus(problems[0], 'warn');
      } else {
        this.okSince ??= now;
        this.setStatus('Perfect — hold still', 'good');
        if (now - this.okSince > HOLD_MS) {
          this.phase = 'countdown';
          this.countdownStart = now;
        }
      }
    }
    if (this.phase === 'countdown') {
      const left = Math.ceil((COUNTDOWN_MS - (now - this.countdownStart)) / 1000);
      if (problems.length && !this.manual) {
        // Pose broke during an automatic countdown: back to aligning.
        this.phase = 'align';
        this.okSince = null;
        this.setStatus(problems[0], 'warn');
        return { outline: true };
      }
      if (left !== this.lastSpoken && left > 0) {
        this.lastSpoken = left;
        this.app.voice.say(String(left), { key: 'count' });
      }
      this.setStatus(left > 0 ? `Capturing in ${left}…` : 'Hold still', 'good');
      if (now - this.countdownStart >= COUNTDOWN_MS) {
        this.phase = 'capturing';
        this.captured = 0;
        this.captureStart = now;
        this.lastGood = now;
      }
    }
    if (this.phase === 'capturing' && mask) {
      let data = null;
      try {
        data = mask.getAsFloat32Array();
      } catch (err) {
        console.error('mask readback failed', err);
      }
      let why = problems[0] || null;
      if (data && !problems.length) {
        const result = measureFrame(this.step, { data, w: mask.width, h: mask.height }, lm);
        if (this.capture.add(result)) {
          this.captured++;
          this.lastGood = now;
          this.lastLines = { widths: result.widths, sx: w / mask.width, sy: h / mask.height };
          if (this.step === 'front' && this.captured === MIN_FRAMES) this.takeSnapshot(frame);
        } else {
          why = 'Can’t see your outline from head to feet — try more light or a plainer background';
        }
      }
      const elapsed = now - this.captureStart;
      const target = elapsed >= MIN_CAPTURE_MS ? MIN_FRAMES : CAPTURE_FRAMES;
      $('mProgress').style.width = `${Math.min(1, this.captured / target) * 100}%`;
      this.setStatus(why || 'Measuring — hold still', why ? 'warn' : 'good');
      if (now - this.lastGood > STALL_MS) {
        this.phase = 'align';
        this.okSince = null;
        this.capture = new StepCapture(this.step, this.app.settings.heightCm);
        this.setStatus(why || 'Couldn’t measure — step back into position', 'warn');
        return { outline: true };
      }
      if (this.captured >= target) {
        this.captures[this.step] = this.capture;
        this.app.voice.say('Got it');
        this.nextStep();
      }
    }
    return { outline: true, fill: this.phase === 'capturing' };
  }

  draw(overlay, frame) {
    const { lm } = frame;
    if (lm) overlay.skeleton(lm, { alpha: 0.45, width: 3 });
    if (this.phase === 'capturing' && this.lastLines) {
      const { widths, sx, sy } = this.lastLines;
      for (const r of Object.values(widths)) {
        overlay.measureLine({ x: r.p1.x * sx, y: r.p1.y * sy }, { x: r.p2.x * sx, y: r.p2.y * sy }, '', COLORS.accent);
      }
    }
  }

  takeSnapshot(frame) {
    const v = this.app.video;
    const c = document.createElement('canvas');
    const scale = Math.min(1, 960 / Math.max(frame.w, frame.h));
    c.width = Math.round(frame.w * scale);
    c.height = Math.round(frame.h * scale);
    const ctx = c.getContext('2d');
    const mirror = this.app.overlay.mirror;
    ctx.save();
    if (mirror) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const { widths, sx, sy } = this.lastLines;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const r of Object.values(widths)) {
      ctx.beginPath();
      ctx.moveTo(r.p1.x * sx * scale, r.p1.y * sy * scale);
      ctx.lineTo(r.p2.x * sx * scale, r.p2.y * sy * scale);
      ctx.stroke();
    }
    ctx.restore();
    try {
      this.snapshot = c.toDataURL('image/jpeg', 0.82);
    } catch {
      this.snapshot = null;
    }
  }

  showResults() {
    this.phase = 'done';
    this.results = combine(this.captures);
    const units = this.app.settings.units;
    const hist = seriesById();
    const rows = this.results.map((r) => {
      const prev = hist[r.id]?.at(-1);
      const delta = prev ? r.value - prev.value : null;
      return h('tr', {},
        h('td', {}, r.name, r.note ? h('span', { class: 'note' }, r.note) : null),
        h('td', { class: 'num' }, fmtLen(r.value, units), h('small', {}, `± ${fmtLen(r.plusMinus, units)}`)),
        h('td', { class: 'num' }, delta == null ? '' : h('span', { class: `delta ${delta > 0 ? 'up' : 'down'}` }, `${delta > 0 ? '+' : ''}${fmtLen(delta, units)}`)),
      );
    });
    $('resultTable').replaceChildren(
      h('tr', {}, h('th', {}, 'Measurement'), h('th', { class: 'num' }, 'Size'), h('th', { class: 'num' }, 'vs last')),
      ...rows,
    );
    const shot = $('resultShot');
    shot.hidden = !this.snapshot;
    if (this.snapshot) shot.src = this.snapshot;
    $('btnSaveResult').disabled = this.results.length === 0;
    if (!this.results.length) toast('Couldn’t measure — make sure your whole body is visible and try again.', 5000);
    $('resultsDialog').showModal();
    this.setStatus('Done — see your results', 'good');
  }

  saveResult() {
    const values = {};
    for (const r of this.results) values[r.id] = { value: +r.value.toFixed(2), plusMinus: +r.plusMinus.toFixed(2) };
    if (addSession({ date: new Date().toISOString(), heightCm: this.app.settings.heightCm, values })) {
      toast('Saved to your measurement history');
      $('btnSaveResult').disabled = true;
    } else {
      toast('Couldn’t save — storage is full or blocked');
    }
  }

  showHistory() {
    const list = loadHistory();
    const units = this.app.settings.units;
    const body = $('historyBody');
    if (!list.length) {
      body.replaceChildren(h('p', { class: 'hint' }, 'No saved measurements yet. Capture and save one to start tracking.'));
    } else {
      const series = seriesById(list);
      const rows = Object.entries(MEASURES)
        .filter(([id]) => series[id]?.length)
        .map(([id, m]) => {
          const s = series[id];
          const first = s[0].value;
          const last = s.at(-1).value;
          const d = last - first;
          return h('tr', {},
            h('td', {}, m.name, h('span', { class: 'note' }, `${s.length} ${s.length === 1 ? 'entry' : 'entries'} since ${new Date(s[0].date).toLocaleDateString()}`)),
            h('td', {}, sparkline(s.map((p) => p.value))),
            h('td', { class: 'num' }, fmtLen(last, units), s.length > 1 ? h('small', { class: `delta ${d >= 0 ? 'up' : 'down'}` }, `${d >= 0 ? '+' : ''}${fmtLen(d, units)}`) : null),
          );
        });
      const sessions = [...list].reverse().map((s) =>
        h('div', { class: 'hist-session' },
          h('span', {}, new Date(s.date).toLocaleString()),
          h('button', {
            type: 'button',
            class: 'chip',
            onclick: () => {
              if (confirm('Delete this measurement session?')) {
                deleteSession(s.date);
                this.showHistory();
              }
            },
          }, 'Delete'),
        ),
      );
      body.replaceChildren(h('table', { class: 'results' }, ...rows), h('h3', { class: 'group-title' }, 'Sessions'), ...sessions);
    }
    if (!$('historyDialog').open) $('historyDialog').showModal();
  }

  exportCsv() {
    const list = loadHistory();
    if (!list.length) return toast('Nothing to export yet');
    const names = Object.fromEntries(Object.entries(MEASURES).map(([id, m]) => [id, m.name]));
    const blob = new Blob([toCsv(list, names)], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `gym-vision-measurements-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function sparkline(values) {
  const w = 72, hgt = 24;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2},${hgt - 3 - ((v - min) / span) * (hgt - 6)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'spark');
  svg.innerHTML = `<polyline points="${pts}" stroke="${COLORS.accent}" stroke-width="2"/>`;
  return svg;
}
