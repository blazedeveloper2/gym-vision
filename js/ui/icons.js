// Stick-figure pictograms (48×48, stroke = currentColor).
const head = (x, y, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" class="fill"/>`;
const floor = (y) => `<path d="M4 ${y}H44" class="faint"/>`;

const FIGURES = {
  pushup: `${floor(40)}<path d="M13 24L27 29L41 34L43 38M13 24L14 31L14 38"/>${head(8, 20)}`,
  squat: `${floor(42)}<path d="M19 14L26 26L15 28L18 40L12 41M19 16L8 18"/>${head(18, 9)}`,
  lunge: `${floor(42)}<path d="M22 12V24M22 24L32 26L33 40M22 24L15 37L5 38M22 14L19 22"/>${head(22, 7)}`,
  curl: `${floor(44)}<path d="M20 12V28M20 28L17 43M20 28L23 43M21 14L22 23L29 16"/>${head(20, 7)}<circle cx="30" cy="14" r="2.6" class="fill"/>`,
  press: `${floor(44)}<path d="M17 15H31M24 15V29M24 29L20 43M24 29L28 43M17 15L16 4M31 15L32 4M10 4H38"/>${head(24, 9, 3.5)}`,
  lateral: `${floor(44)}<path d="M17 15H31M24 15V29M24 29L20 43M24 29L28 43M17 15L6 16M31 15L42 16"/>${head(24, 9, 3.5)}<circle cx="5" cy="16" r="2.2" class="fill"/><circle cx="43" cy="16" r="2.2" class="fill"/>`,
  jacks: `<path d="M24 13V28M24 15L13 5M24 15L35 5M24 28L14 43M24 28L34 43"/>${head(24, 8, 3.5)}`,
  plank: `${floor(40)}<path d="M13 30L27 31.5L41 34L43 39M13 30L14 39L6 39"/>${head(8, 26)}`,
  scan: `<path d="M5 14V5H14M34 5H43V14M43 34V43H34M14 43H5V34" class="faint-strong"/><path d="M24 17V29M24 29L20 38M24 29L28 38M17 24L24 19L31 24"/>${head(24, 13, 3)}`,
  measure: `<path d="M24 12V27M24 27L20 40M24 27L28 40M18 20L24 15L30 20"/>${head(24, 8, 3)}<path d="M7 22H41M10 19L7 22L10 25M38 19L41 22L38 25" class="accent"/>`,
  video: `<rect x="6" y="9" width="36" height="30" rx="4"/><path d="M6 17H42M15 9V17M33 9V17"/><path d="M21 23V33L30 28Z" class="fill"/>`,
};

export function figure(name, cls = '') {
  return `<svg viewBox="0 0 48 48" class="fig ${cls}" aria-hidden="true">${FIGURES[name] || ''}</svg>`;
}

// Small UI icons (24×24).
const UI = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  flip: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l1.6-2h6.8L17 6h1.5A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M8.8 12.2a3.3 3.3 0 0 1 5.9-1.7M15.2 13.3a3.3 3.3 0 0 1-5.9 1.7"/><path d="M15 8.4v2.3h-2.3M9 17.1v-2.3h2.3"/>',
  upload: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 4v5M16 4v5"/><path d="M10.5 12.5v4.5l4-2.25z" class="fill"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.2"/><path d="M3.5 3.5v4.7h4.7"/>',
  play: '<path d="M7 5l12 7-12 7z" class="fill"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l1.6-2h6.8L17 6h1.5A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.2"/><path d="M3.5 3.5v4.7h4.7M12 7.5V12l3 2"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M6 10.5H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 10.5h-1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="ico ${cls}" aria-hidden="true">${UI[name] || ''}</svg>`;
}
