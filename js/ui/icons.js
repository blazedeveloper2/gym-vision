// Stick-figure pictograms (48×48, stroke = currentColor).
const head = (x, y, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" class="fill"/>`;
const floor = (y) => `<path d="M4 ${y}H44" class="faint"/>`;
const db = (x, y, r = 2.4) => `<circle cx="${x}" cy="${y}" r="${r}" class="fill"/>`;
/** Flat bench: top at y from x1 to x2, legs to the floor at 42. */
const bench = (x1, x2, y) => `<path d="M${x1} ${y}H${x2}M${x1 + 3} ${y}V42M${x2 - 3} ${y}V42" class="faint-strong"/>`;
const bar = (y = 5) => `<path d="M6 ${y}H42" class="faint-strong"/>`;
const wheel = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2"/>`;
const wall = (x) => `<path d="M${x} 4V44" class="faint"/>`;

const FIGURES = {
  // ---- general
  pushup: `${floor(40)}<path d="M13 24L27 29L41 34L43 38M13 24L14 31L14 38"/>${head(8, 20)}`,
  squat: `${floor(42)}<path d="M19 14L26 26L15 28L18 40L12 41M19 16L8 18"/>${head(18, 9)}`,
  lunge: `${floor(42)}<path d="M22 12V24M22 24L32 26L33 40M22 24L15 37L5 38M22 14L19 22"/>${head(22, 7)}`,
  curl: `${floor(44)}<path d="M20 12V28M20 28L17 43M20 28L23 43M21 14L22 23L29 16"/>${head(20, 7)}<circle cx="30" cy="14" r="2.6" class="fill"/>`,
  press: `${floor(44)}<path d="M17 15H31M24 15V29M24 29L20 43M24 29L28 43M17 15L16 4M31 15L32 4M10 4H38"/>${head(24, 9, 3.5)}`,
  lateral: `${floor(44)}<path d="M17 15H31M24 15V29M24 29L20 43M24 29L28 43M17 15L6 16M31 15L42 16"/>${head(24, 9, 3.5)}<circle cx="5" cy="16" r="2.2" class="fill"/><circle cx="43" cy="16" r="2.2" class="fill"/>`,
  jacks: `<path d="M24 13V28M24 15L13 5M24 15L35 5M24 28L14 43M24 28L34 43"/>${head(24, 8, 3.5)}`,
  plank: `${floor(40)}<path d="M13 30L27 31.5L41 34L43 39M13 30L14 39L6 39"/>${head(8, 26)}`,
  // ---- bench work
  bench: `${bench(6, 34, 32)}<path d="M12 29H28L36 24L39 41M15 29V12"/>${head(8, 27, 3.5)}${db(15, 10, 2.8)}`,
  'bench-incline': `<path d="M8 20L30 34M26 32V42M12 23V42" class="faint-strong"/><path d="M13 19L27 29L36 26L39 41M15 20V7"/>${head(9, 15, 3.5)}${db(15, 5, 2.8)}`,
  fly: `${bench(6, 34, 32)}<path d="M12 29H28L36 24L39 41M15 29Q7 22 6 14M15 29Q23 22 24 14"/>${head(8, 27, 3.5)}${db(6, 12)}${db(24, 12)}`,
  pullover: `${bench(10, 38, 32)}<path d="M18 29H32L38 24L41 41M20 29L9 17"/><path d="M20 12A14 14 0 0 0 6 24" class="faint"/>${head(13, 27, 3.5)}${db(8, 15, 2.8)}`,
  'oh-ext': `${floor(44)}<path d="M15 8V34" class="faint-strong"/><path d="M19 14V30H31V43M20 15L23 5L16 12"/>${head(19, 9, 3.5)}${db(15, 13)}`,
  preacher: `${floor(44)}<path d="M21 17L33 29M31 27V43" class="faint-strong"/><path d="M14 13L16 29L14 43M16 29L20 43M15 15L25 22L28 11"/>${head(13, 8, 3.5)}${db(28, 9)}`,
  'incline-curl': `<path d="M10 11L19 33M16 33V43" class="faint-strong"/><path d="M13 12L21 30H32V42M14 14L15 26L22 21"/>${head(11, 8, 3.5)}${db(23, 20)}`,
  'wrist-curl': `${bench(20, 44, 30)}<path d="M12 12L14 33L22 41M14 33L10 41M13 16L24 28H34L39 23"/>${head(11, 7, 3.5)}${db(40, 21)}`,
  // ---- back
  row: `${bench(6, 40, 30)}<path d="M13 19H31L33 30M31 19L42 42M15 19V30M19 20L26 14L26 23"/>${head(9, 17, 3.5)}${db(26, 25)}`,
  'row-cs': `<path d="M12 22L34 35M30 33V43M16 25V43" class="faint-strong"/><path d="M12 18L28 28L34 41M14 19L20 12L21 22"/>${head(8, 15, 3.5)}${db(21, 24)}`,
  'rear-fly': `<path d="M12 22L34 35M30 33V43M16 25V43" class="faint-strong"/><path d="M12 18L28 28L34 41M14 19L5 15M14 19L22 13"/>${head(8, 15, 3.5)}${db(4, 15)}${db(23, 12)}`,
  'snow-angel': `${bench(12, 40, 32)}<path d="M13 29H34L44 27M13 29L4 23M13 29L22 31"/><path d="M6 36A12 12 0 0 1 4 24" class="faint"/>${head(9, 27, 3.5)}`,
  'pull-up': `${bar()}<path d="M24 14V30M24 30L21 43M24 30L27 43M19 15H29M19 15L14 12L17 5M29 15L34 12L31 5"/>${head(24, 9, 3.5)}`,
  'arch-hang': `${bar()}<path d="M22 5L20 16Q26 26 23 32L29 43M20 16L18 5"/>${head(16, 18, 3.5)}`,
  'leg-raise': `${bar()}<path d="M20 5L22 15M28 5L26 15M22 15H26M24 15V30H42"/>${head(24, 20, 3)}`,
  // ---- legs
  bss: `${floor(42)}<path d="M34 32H46M37 32V42" class="faint-strong"/><path d="M21 13V26L13 31L13 41M21 26L27 39L39 31M21 15L16 23"/>${head(21, 8, 3.5)}`,
  'front-squat': `${floor(42)}<path d="M19 14L26 26L15 28L18 40L12 41M19 16L25 17L21 12M11 12H27"/>${head(18, 9)}`,
  goblet: `${floor(42)}<path d="M19 14L26 26L15 28L18 40L12 41M19 16L22 23L23 17"/>${head(18, 9)}${db(24, 16, 3)}`,
  rdl: `${floor(43)}<path d="M12 16L29 21L30 31L29 42M29 21L33 42M14 17L16 31"/><path d="M8 31H24" class="faint-strong"/>${head(8, 15, 3.5)}`,
  thrust: `${floor(42)}<path d="M3 26H12M6 26V42" class="faint-strong"/><path d="M11 22H34L35 42"/>${head(6, 19, 3.5)}${db(22, 18, 3)}`,
  'leg-curl': `${bench(6, 36, 32)}<path d="M9 29H38L38 16"/>${head(5, 26, 3.5)}${db(38, 14, 2.8)}`,
  calf: `<path d="M13 41H32M13 41V44" class="faint-strong"/><path d="M22 12V27M22 27V37L26 40M22 14L18 25M22 14L26 25"/><path d="M34 22V12M31 15L34 12L37 15" class="accent"/>${head(22, 7, 3.5)}`,
  // ---- core
  'dead-bug': `${floor(38)}<path d="M9 33H26M12 33V20M12 33L4 27M26 33L30 23L38 23M26 33L43 31"/>${head(6, 32, 3.5)}`,
  crunch: `${bench(14, 42, 34)}<path d="M36 31H22Q15 30 12 24M13 24L5 15M36 31L40 24L44 32"/>${head(10, 20, 3.5)}${db(4, 13, 2.8)}`,
  'rev-crunch': `${bench(4, 30, 34)}<path d="M8 31L24 28L27 18L36 16"/>${head(5, 29, 3.5)}${db(38, 16, 2.8)}`,
  'side-plank': `${floor(42)}<path d="M9 41L13 31L41 40M14 31L21 40"/><path d="M14 30L12 18" class="faint"/>${head(10, 26, 3.5)}${db(21, 40, 2.8)}`,
  rollout: `${floor(42)}<path d="M36 41L30 35L14 30L6 38"/>${head(10, 26, 3.5)}${wheel(6, 38)}`,
  'rollout-stand': `${floor(42)}<path d="M38 41L31 21L19 29L13 38"/>${head(16, 33, 3.5)}${wheel(12, 39)}`,
  hollow: `${floor(40)}<path d="M12 29Q24 39 42 29M12 29L2 26"/>${head(8, 26, 3.5)}`,
  arch: `${floor(40)}<path d="M10 28Q24 42 42 26M10 28L2 24"/>${head(7, 25, 3.5)}`,
  'rev-hyper': `${bench(4, 28, 32)}<path d="M8 29H26L44 27"/>${head(5, 27, 3.5)}`,
  rocks: `${floor(42)}<path d="M12 25H30L32 41M30 25L40 41M12 25L10 41"/><path d="M6 20H14M12 18L14 20L12 22" class="accent"/>${head(8, 23, 3.5)}`,
  // ---- skills
  handstand: `${floor(44)}<path d="M20 43L24 31L28 43M24 31V17L24 5"/>${head(24, 36, 3)}`,
  'handstand-wall': `${floor(44)}${wall(30)}<path d="M20 43L24 31L28 43M24 31V17L27 5"/>${head(24, 36, 3)}`,
  'handstand-one': `${floor(44)}<path d="M24 43L24 31M24 31L34 29M24 31V17L20 5M24 17L28 5"/>${head(21, 35, 3)}`,
  'press-hs': `${floor(44)}<path d="M20 43L24 31L28 43M24 31V19L12 8M24 19L36 8"/>${head(24, 36, 3)}`,
  frog: `${floor(42)}<path d="M14 41L16 31L13 22M16 31L26 26L34 32L40 34M16 31L22 28"/>${head(9, 21, 3.5)}`,
  planche: `${floor(42)}<path d="M14 41V27H30L34 33H38M14 27L18 40"/>${head(9, 25, 3.5)}`,
  'planche-full': `${floor(42)}<path d="M14 41V26H44M14 26L17 40"/>${head(9, 24, 3.5)}`,
  lever: `${bar()}<path d="M18 5L14 20H30L27 13L34 12"/>${head(9, 21, 3.5)}`,
  'lever-full': `${bar()}<path d="M22 5L16 20H44"/>${head(11, 21, 3.5)}`,
  // ---- push-up ladder
  decline: `${floor(42)}<path d="M36 30H46M39 30V42" class="faint-strong"/><path d="M13 28L26 29L40 27M13 28L14 35L14 41"/>${head(8, 26, 3.5)}`,
  archer: `${floor(42)}<path d="M16 30H32L42 41M16 30L10 35L12 41"/>${head(24, 25, 3.5)}`,
  'one-arm': `${floor(40)}<path d="M13 24L27 29L41 34L43 38M13 24L14 31L14 38M16 25L24 22L28 27"/>${head(8, 20)}`,
  pike: `${floor(42)}<path d="M14 41L18 29L27 13L36 41M18 29L15 41"/>${head(14, 32, 3.5)}`,
  'pike-elevated': `<path d="M32 22H46M35 22V42" class="faint-strong"/>${floor(42)}<path d="M16 41L20 29L23 12L40 20M20 29L17 41"/>${head(16, 32, 3.5)}`,
  hspu: `${floor(44)}${wall(30)}<path d="M18 43L20 36L25 33L28 43M25 33V19L27 6"/>${head(22, 39, 3)}`,
  // ---- tools
  scan: `<path d="M5 14V5H14M34 5H43V14M43 34V43H34M14 43H5V34" class="faint-strong"/><path d="M24 17V29M24 29L20 38M24 29L28 38M17 24L24 19L31 24"/>${head(24, 13, 3)}`,
  measure: `<path d="M24 12V27M24 27L20 40M24 27L28 40M18 20L24 15L30 20"/>${head(24, 8, 3)}<path d="M7 22H41M10 19L7 22L10 25M38 19L41 22L38 25" class="accent"/>`,
  video: `<rect x="6" y="9" width="36" height="30" rx="4"/><path d="M6 17H42M15 9V17M33 9V17"/><path d="M21 23V33L30 28Z" class="fill"/>`,
};

export function figure(name, cls = '') {
  return `<svg viewBox="0 0 48 48" class="fig ${cls}" aria-hidden="true">${FIGURES[name] || ''}</svg>`;
}

export const hasFigure = (name) => name in FIGURES;

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
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
  ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  voice: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
};

export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="ico ${cls}" aria-hidden="true">${UI[name] || ''}</svg>`;
}
