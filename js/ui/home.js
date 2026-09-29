import { EXERCISES, GENERAL, exerciseById } from '../exercises/index.js';
import { DAYS, LADDERS, LADDER_ORDER, DAY_NAMES, resolve, todayKey, levelOf } from '../program.js';
import { figure, icon } from './icons.js';
import { $, h } from './dom.js';

/**
 * Home screen: search, "My workouts" (your program by day, today first,
 * with alternates and skill-ladder steps resolved), "General exercises",
 * and the skill-level sheet. `onOpen(kind, meta)` starts a session.
 */

const DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const nameOf = (r) => r.name || exerciseById(r.id)?.name || r.id;
const figOf = (id) => {
  const e = exerciseById(id);
  return e?.fig || id;
};

/** One tappable exercise row. */
function row({ id, name, meta, onOpen, rx, badge }) {
  const e = exerciseById(id);
  return h('button', { type: 'button', class: 'ex-row', onclick: () => onOpen(`exercise:${id}`, { name, rx }) },
    h('span', { class: 'fig-wrap', html: figure(figOf(id)) }),
    h('span', { class: 'ex-row-text' },
      h('strong', {}, name || e?.name || id),
      h('span', { class: 'meta' }, meta ?? [rx, e?.view].filter(Boolean).join(' · ')),
    ),
    badge ? h('span', { class: 'badge' }, badge) : null,
    h('span', { class: 'chev', html: icon('chevron') }),
  );
}

export class Home {
  constructor(app, { onOpen }) {
    this.app = app;
    this.onOpen = onOpen;
    this.day = DAYS.some((d) => d.day === todayKey()) ? todayKey() : 'mon';
  }

  get prefs() {
    const s = this.app.settings;
    return { kit: s.kit, levels: s.levels };
  }

  build() {
    document.querySelectorAll('[data-fig]').forEach((el) => (el.innerHTML = figure(el.dataset.fig)));
    document.querySelectorAll('[data-ico]').forEach((el) => (el.innerHTML = icon(el.dataset.ico)));
    document.querySelectorAll('[data-action="settings"]').forEach((el) => (el.innerHTML = icon('settings')));
    $('btnBack').innerHTML = icon('back');
    $('btnFlip').innerHTML = icon('flip');
    $('btnUpload').innerHTML = icon('upload');
    $('btnReset').innerHTML = icon('reset');

    this.renderGeneral();
    this.renderDays();
    this.renderDay();

    $('btnLadders').addEventListener('click', () => {
      this.renderLadders();
      $('ladderDialog').showModal();
    });
    const search = $('exSearch');
    search.addEventListener('input', () => this.renderSearch(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        this.renderSearch('');
      }
    });
    document.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => this.onOpen(el.dataset.open)));
  }

  /** Re-render whatever depends on settings (equipment, levels). */
  refresh() {
    this.renderDay();
    if ($('ladderDialog').open) this.renderLadders();
    this.renderSearch($('exSearch').value);
  }

  renderGeneral() {
    $('exCount').textContent = String(GENERAL.length);
    $('exGrid').replaceChildren(
      ...GENERAL.map((ex) =>
        h('button', { type: 'button', class: 'ex-card', onclick: () => this.onOpen(`exercise:${ex.id}`) },
          h('span', { class: 'fig-wrap', html: figure(ex.fig || ex.id) }),
          h('strong', {}, ex.name),
          h('span', { class: 'blurb' }, ex.blurb),
          h('span', { class: 'badge' }, ex.view),
        ),
      ),
    );
  }

  renderDays() {
    const today = todayKey();
    $('dayTabs').replaceChildren(
      ...WEEK_ORDER.filter((k) => DAYS.some((d) => d.day === k)).map((k) =>
        h('button', {
          type: 'button',
          role: 'tab',
          class: `day-tab${k === today ? ' today' : ''}`,
          'aria-selected': String(k === this.day),
          'data-day': k,
          onclick: () => {
            this.day = k;
            document.querySelectorAll('.day-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.day === k)));
            this.renderDay();
          },
        }, DAY_SHORT[k]),
      ),
    );
  }

  /** The chosen day's exercises, resolved for your equipment and skill levels. */
  renderDay() {
    const d = DAYS.find((x) => x.day === this.day);
    const today = this.day === todayKey();
    const head = h('div', { class: 'day-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, today ? `Today · ${DAY_NAMES[d.day]}` : DAY_NAMES[d.day]),
        h('h3', {}, d.label),
      ),
    );
    // Untagged = the main lifts; name them when the day has other blocks too.
    const body = d.sections.map((sec) =>
      h('div', { class: 'day-section' },
        sec.tag || d.sections.length > 1 ? h('div', { class: 'day-tag' }, sec.tag || 'Main') : null,
        ...sec.ex.map((slot) => this.slotItem(slot)),
      ),
    );
    $('dayCard').replaceChildren(head, ...body);
  }

  slotItem(slot) {
    const r = resolve(slot, this.prefs);
    const name = nameOf(r);
    const meta = [r.rx, r.bench, exerciseById(r.id)?.view].filter(Boolean).join(' · ');
    const extras = [];
    if (r.line) {
      const L = LADDERS[r.line];
      extras.push(
        h('button', { type: 'button', class: 'mini-chip', onclick: () => this.openLadders(r.line) },
          h('span', { html: icon('ladder') }), `${L.name} · ${r.tier} · ${r.level + 1}/${L.steps.length}`),
      );
      if (r.up) extras.push(h('span', { class: 'mini-note' }, `Next step at ${r.up}`));
    }
    if (r.other) {
      // The other option: the equipment version when you don't have it, or the stand-in when you do.
      const o = r.other;
      const why = r.swapped ? REQ[slot.req] : `No ${REQ[slot.req].toLowerCase()}`;
      extras.push(
        h('button', { type: 'button', class: 'mini-chip', onclick: () => this.onOpen(`exercise:${o.id}`, { name: nameOf(o), rx: o.rx }) },
          h('span', { html: icon('swap') }), `${why}: ${nameOf(o)}`),
      );
    }
    return h('div', { class: 'ex-item' },
      row({ id: r.id, name, meta, rx: r.rx, onOpen: this.onOpen }),
      extras.length ? h('div', { class: 'ex-sub' }, ...extras) : null,
    );
  }

  openLadders(line) {
    this.renderLadders();
    $('ladderDialog').showModal();
    requestAnimationFrame(() => document.getElementById(`ladder-${line}`)?.scrollIntoView({ block: 'start' }));
  }

  /** The skill-level sheet: every ladder, every step; pick your level or start any step. */
  renderLadders() {
    const { levels } = this.app.settings;
    $('ladderBody').replaceChildren(
      ...LADDER_ORDER.map((line) => {
        const L = LADDERS[line];
        const cur = levelOf(line, levels);
        return h('section', { class: 'ladder', id: `ladder-${line}` },
          h('h3', {}, L.name),
          h('div', { class: 'ex-list' },
            ...L.steps.map((st, i) => {
              const name = st.name || exerciseById(st.id)?.name || st.id;
              return h('div', { class: `ladder-step${i === cur ? ' current' : ''}` },
                h('button', {
                  type: 'button',
                  class: 'level-pick',
                  'aria-pressed': String(i === cur),
                  'aria-label': `Set ${L.name} level to ${name}`,
                  onclick: () => {
                    const st = this.app.settings;
                    st.levels = { ...st.levels, [line]: i };
                    st.levelSet = { ...st.levelSet, [line]: i };
                    this.app.persist();
                    this.refresh();
                  },
                  html: i === cur ? icon('check') : '',
                }),
                row({
                  id: st.id,
                  name,
                  rx: st.s,
                  meta: [st.tier, st.s, st.up ? `next at ${st.up}` : null].filter(Boolean).join(' · '),
                  onOpen: (kind, meta) => {
                    $('ladderDialog').close();
                    this.onOpen(kind, meta);
                  },
                }),
              );
            }),
          ),
        );
      }),
    );
  }

  /** Search every exercise by name, muscles or ladder. */
  renderSearch(q) {
    const query = q.trim().toLowerCase();
    $('searchSection').hidden = !query;
    $('browse').hidden = !!query;
    if (!query) return;
    const words = query.split(/\s+/);
    const ladderOf = new Map();
    for (const [line, L] of Object.entries(LADDERS)) L.steps.forEach((st) => ladderOf.set(st.id, L.name));
    const hits = EXERCISES.filter((e) => {
      const text = `${e.name} ${e.muscles || ''} ${e.blurb || ''} ${ladderOf.get(e.id) || ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    $('searchCount').textContent = String(hits.length);
    $('searchResults').replaceChildren(
      ...(hits.length
        ? hits.map((e) => row({ id: e.id, meta: [e.view, e.blurb].join(' · '), onOpen: this.onOpen }))
        : [h('p', { class: 'empty' }, 'No exercises match that.')]),
    );
  }
}

const REQ = { bar: 'Bar', wheel: 'Wheel', barbell: 'Barbell' };

/** "What's in the video?" picker for the Analyze video card, with search. */
export function buildPicker({ onPick }) {
  const groups = [
    { title: 'Body tools', items: [{ kind: 'scan', name: 'Body Scan', blurb: 'Skeleton, outline and body parts', fig: 'scan' }] },
    { title: 'My workouts', items: EXERCISES.filter((e) => !GENERAL.includes(e)) },
    { title: 'General exercises', items: GENERAL },
  ];
  const item = (it) =>
    h('button', { type: 'button', class: 'pick', 'data-text': `${it.name} ${it.muscles || ''}`.toLowerCase(), onclick: () => onPick(it.kind || `exercise:${it.id}`) },
      h('span', { class: 'fig-wrap', html: figure(it.fig || it.id) }),
      h('div', {}, h('strong', {}, it.name), h('br'), h('span', {}, it.blurb)),
    );
  const input = h('input', { type: 'search', class: 'pick-search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', autocomplete: 'off' });
  const lists = groups.map((g) => h('div', { class: 'pick-group' }, h('h3', { class: 'group-title' }, g.title), h('div', { class: 'pick-list' }, ...g.items.map(item))));
  input.addEventListener('input', () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const g of lists) {
      let any = false;
      for (const b of g.querySelectorAll('.pick')) {
        const show = words.every((w) => b.dataset.text.includes(w));
        b.hidden = !show;
        any ||= show;
      }
      g.hidden = !any;
    }
  });
  $('pickList').replaceChildren(input, ...lists);
}
