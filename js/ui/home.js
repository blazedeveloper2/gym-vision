import { EXERCISES } from '../exercises/index.js';
import { figure, icon } from './icons.js';
import { $, h } from './dom.js';

/** Fills the home screen's cards and the static icon placeholders. */
export function buildHome({ onOpen }) {
  document.querySelectorAll('[data-fig]').forEach((el) => (el.innerHTML = figure(el.dataset.fig)));
  document.querySelectorAll('[data-ico]').forEach((el) => (el.innerHTML = icon(el.dataset.ico)));
  document.querySelectorAll('[data-action="settings"]').forEach((el) => (el.innerHTML = icon('settings')));
  $('btnBack').innerHTML = icon('back');
  $('btnFlip').innerHTML = icon('flip');
  $('btnUpload').innerHTML = icon('upload');
  $('btnReset').innerHTML = icon('reset');

  $('exCount').textContent = String(EXERCISES.length);
  $('exGrid').replaceChildren(
    ...EXERCISES.map((ex) =>
      h('button', { type: 'button', class: 'ex-card', onclick: () => onOpen(`exercise:${ex.id}`) },
        h('span', { class: 'fig-wrap', html: figure(ex.id) }),
        h('strong', {}, ex.name),
        h('span', { class: 'blurb' }, ex.blurb),
        h('span', { class: 'badge' }, ex.view),
      ),
    ),
  );
  document.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => onOpen(el.dataset.open)));
}

/** "What's in the video?" picker for the Analyze video card. */
export function buildPicker({ onPick }) {
  const items = [
    { kind: 'scan', name: 'Body Scan', blurb: 'Skeleton, outline and body parts', fig: 'scan' },
    ...EXERCISES.map((ex) => ({ kind: `exercise:${ex.id}`, name: ex.name, blurb: ex.blurb, fig: ex.id })),
  ];
  $('pickList').replaceChildren(
    ...items.map((it) =>
      h('button', { type: 'button', class: 'pick', onclick: () => onPick(it.kind) },
        h('span', { class: 'fig-wrap', html: figure(it.fig) }),
        h('div', {}, h('strong', {}, it.name), h('br'), h('span', {}, it.blurb)),
      ),
    ),
  );
}
