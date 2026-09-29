/**
 * Your program, as the Bartleby workout app has it (apps/workout/data.js,
 * Edrin's program): the days, what's in each, the alternates for missing
 * equipment and the skill ladders. Exercise ids point into the catalog
 * (js/exercises/index.js). Keep this in step with Bartleby when the
 * program changes.
 *
 * A slot is one of:
 *   { id, s }                    an exercise and its prescription
 *   { ..., req, alt }            `alt` replaces it without that equipment
 *   { line, dose }               whichever step of that ladder you're on;
 *                                dose 'p' / 'l' = the practice / lighter dose
 */

export const DAYS = [
  { day: 'mon', label: 'Upper · Push Focus', sections: [
    { tag: null, ex: [
      { id: 'incline-press', s: '3×F', b: '30° bench' },
      { id: 'bench-press', s: '3×F', b: 'Flat bench' },
      { id: 'press', name: 'Dumbbell Shoulder Press', s: '2×F', b: '85° bench' },
    ] },
    { tag: 'Isolation', ex: [
      { id: 'flyes', s: '2×F', b: 'Flat bench' },
      { id: 'oh-extension', s: '2×F', b: '85° bench' },
      { id: 'preacher-curl', s: '2×F', b: '45° bench' },
      { id: 'lateral', name: 'Lateral Raises', s: '4×F' },
    ] },
  ] },
  { day: 'tue', label: 'Lower · Quad Focus', sections: [
    { tag: 'Warm-Up', ex: [{ id: 'dead-bug', s: '1× easy /side' }] },
    { tag: null, ex: [
      { id: 'bss', s: '2×F /leg', b: 'Flat bench' },
      { id: 'front-squat', s: '3×F', req: 'barbell', alt: { id: 'goblet-squat', s: '3×F' } },
      { id: 'bb-rdl', s: '2×F', req: 'barbell', alt: { id: 'rdl', s: '2×F' } },
      { id: 'calf-raise', s: '2×F' },
    ] },
    { tag: 'Core', ex: [
      { line: 'rollout', req: 'wheel', alt: { id: 'db-crunch', s: '2×8-15', b: 'Flat bench' } },
      { id: 'hanging-leg-raise', s: '2×10-20', req: 'bar', alt: { id: 'reverse-crunch', s: '2×10-20', b: 'Flat bench' } },
      { id: 'side-plank-reach', s: '2×F /side' },
    ] },
  ] },
  { day: 'wed', label: 'Skill Practice', sections: [
    { tag: 'Skill', ex: [{ id: 'wrist-rocks', s: '2× easy' }, { line: 'handstand', dose: 'p' }, { line: 'planche', dose: 'p' }] },
    { tag: 'Body Line', ex: [{ line: 'hollow', dose: 'p' }] },
  ] },
  { day: 'thu', label: 'Upper · Pull Focus', sections: [
    { tag: null, ex: [
      { id: 'pull-up', s: '3×F', req: 'bar', alt: { id: 'single-arm-row', s: '3×F /arm', b: 'Flat bench' } },
      { id: 'cs-row', s: '3×F', b: '30–45° bench' },
      { id: 'pullover', s: '2×F', b: 'Flat bench' },
    ] },
    { tag: 'Isolation', ex: [
      { id: 'reverse-fly', s: '4×F', b: '30° bench' },
      { id: 'hammer-curl', s: '2×F' },
      { id: 'incline-curl', s: '2×F', b: '55° bench' },
      { id: 'lateral', name: 'Lateral Raises', s: '4×F' },
    ] },
  ] },
  { day: 'fri', label: 'Lower · Ham & Glute Focus', sections: [
    { tag: null, ex: [
      { id: 'bb-rdl', s: '3×F', req: 'barbell', alt: { id: 'rdl', s: '3×F' } },
      { id: 'bb-hip-thrust', s: '2×F', b: 'Flat bench', req: 'barbell', alt: { id: 'b-stance-thrust', s: '2×F /leg', b: 'Flat bench' } },
      { id: 'bss', s: '2×F /leg', b: 'Flat bench' },
      { id: 'leg-curl', s: '2×F', b: 'Flat bench' },
    ] },
    { tag: 'Accessories', ex: [
      { id: 'calf-raise', s: '2×F' },
      { id: 'wrist-curl', s: '2×12-20', b: 'Flat bench' },
      { id: 'reverse-wrist-curl', s: '2×12-20', b: 'Flat bench' },
    ] },
    { tag: 'Core', ex: [
      { id: 'db-crunch', s: '2×F', b: 'Flat bench' },
      { id: 'hanging-leg-raise', s: '2×10-20', req: 'bar', alt: { id: 'reverse-crunch', s: '2×10-20', b: 'Flat bench' } },
      { id: 'side-plank-reach', s: '2×F /side' },
    ] },
  ] },
  { day: 'sat', label: 'Upper · Calisthenics', sections: [
    { tag: 'Skill', ex: [
      { id: 'wrist-rocks', s: '2× easy' },
      { line: 'handstand' },
      { line: 'planche' },
      { line: 'lever', req: 'bar', alt: { id: 'scap-pushup', s: '3×8-12' } },
    ] },
    { tag: null, ex: [
      { id: 'chin-up', s: '3×5-8', req: 'bar', alt: { id: 'snow-angel', s: '3×10-15', b: 'Flat bench' } },
      { line: 'pushup' },
      { line: 'hspu' },
    ] },
    { tag: 'Core', ex: [{ line: 'rollout', req: 'wheel', alt: { line: 'hollow' } }, { line: 'arch' }] },
  ] },
  { day: 'sun', label: 'Skill Practice', sections: [
    { tag: 'Skill', ex: [{ id: 'wrist-rocks', s: '2× easy' }, { line: 'planche', dose: 'l' }, { line: 'handstand', dose: 'l' }] },
  ] },
];

/**
 * Skill ladders (Steven Low's Overcoming Gravity order, as in Bartleby).
 * s = Saturday's prescription; p, l = the practice and lighter doses;
 * up = what to hit before moving on. `start` = the step before you set one.
 */
export const LADDERS = {
  handstand: { name: 'Handstand', steps: [
    { id: 'wall-handstand', tier: 'Beginner', s: '3×15-30s', p: '5×10-20s', l: '3×10-15s', up: '3×30s in a straight line, chest to the wall' },
    { id: 'toe-pulls', tier: 'Novice', s: '5×5-15s off the wall', p: '5×5-10s off the wall', l: '3×5-10s off the wall', up: '15-20s off the wall' },
    { id: 'kick-ups', tier: 'Novice', s: '6×3 attempts', p: '5×3 attempts', l: '3×3 attempts', up: '30s freestanding, most sessions' },
    { id: 'handstand', tier: 'Intermediate', s: '6×15-45s', p: '5×10-30s', l: '3×10-30s', up: '60s, comfortably' },
    { id: 'straddle-press', tier: 'Advanced', s: '5×1-3', p: '4×1-2', l: '3×1-2', up: '3×3 slow presses' },
    { id: 'one-arm-handstand', tier: 'Elite', s: '6×5-15s /side', p: '4×5-10s /side', l: '3×5-10s /side' },
  ] },
  planche: { name: 'Planche', steps: [
    { id: 'frog-stand', tier: 'Beginner', s: '3×5-30s', p: '5×5-15s', l: '3×5-15s', up: '3×30s' },
    { id: 'sa-frog-stand', tier: 'Novice', s: '5×10-20s', p: '4×5-15s', l: '3×5-15s', up: '5×20s' },
    { id: 'tuck-planche', tier: 'Intermediate', s: '5×5-20s', p: '4×5-10s', l: '3×5-10s', up: '5×20s' },
    { id: 'adv-tuck-planche', tier: 'Intermediate', s: '5×5-20s', p: '4×5-10s', l: '3×5-10s', up: '5×20s, back flat' },
    { id: 'straddle-planche', tier: 'Advanced', s: '5×5-20s', p: '4×5-10s', l: '3×5-10s', up: '5×20s' },
    { id: 'halflay-planche', tier: 'Advanced', s: '5×5-20s', p: '4×5-10s', l: '3×5-10s', up: '5×20s' },
    { id: 'full-planche', tier: 'Elite', s: '5×3-15s', p: '4×3-8s', l: '3×3-8s' },
  ] },
  lever: { name: 'Front Lever', steps: [
    { id: 'scap-pulls', tier: 'Beginner', s: '3×5-8', up: '3×8' },
    { id: 'arch-hangs', tier: 'Beginner', s: '3×5-8', up: '3×8, with chin-ups at 3×8' },
    { id: 'tuck-lever', tier: 'Novice', s: '5×10-20s', up: '5×20s' },
    { id: 'adv-tuck-lever', tier: 'Intermediate', s: '5×10-20s', up: '5×20s, back flat' },
    { id: 'straddle-lever', tier: 'Advanced', s: '5×5-20s', up: '5×20s' },
    { id: 'halflay-lever', tier: 'Advanced', s: '5×5-20s', up: '5×20s' },
    { id: 'full-lever', tier: 'Elite', s: '5×3-15s' },
  ] },
  pushup: { name: 'Push-Up', steps: [
    { id: 'pushup', name: 'Push-Ups', tier: 'Beginner', s: '3×5-8', up: '3×8' },
    { id: 'diamond-pushup', tier: 'Novice', s: '3×5-8', up: '3×8' },
    { id: 'decline-pushup', tier: 'Novice', s: '3×5-8', b: 'Flat bench', up: '3×8' },
    { id: 'archer-pushup', tier: 'Intermediate', s: '3×5-8 /side', up: '3×8 /side' },
    { id: 'incline-oap', tier: 'Advanced', s: '3×3-5 /side', b: 'Flat bench', up: '3×5 /side' },
    { id: 'oap', tier: 'Advanced', s: '3×3-5 /side', up: '3×5 /side, wide stance' },
    { id: 'oap-feet', tier: 'Elite', s: '3×3-5 /side' },
  ] },
  hspu: { name: 'Handstand Push-Up', steps: [
    { id: 'pike-pushup', tier: 'Beginner', s: '3×5-8', up: '3×8' },
    { id: 'elevated-pike', tier: 'Novice', s: '3×5-8', b: 'Flat bench', up: '3×8' },
    { id: 'hspu-negative', tier: 'Novice', s: '3×3-5', up: '3×5, 3-5s down to the head' },
    { id: 'wall-hspu', tier: 'Intermediate', s: '3×5-8', up: '3×8, head to the floor' },
    { id: 'deficit-hspu', tier: 'Advanced', s: '3×5-8', up: '3×8, and a 30s freestanding handstand' },
    { id: 'fs-hspu', tier: 'Elite', s: '4×1-5' },
  ] },
  rollout: { name: 'Ab Wheel', start: 1, steps: [
    { id: 'rollout-wall-kneel', tier: 'Beginner', s: '3×5-8', up: '3×8' },
    { id: 'rollout', tier: 'Novice', s: '3×5-8', up: '3×8 to full extension, pelvis tucked' },
    { id: 'rollout-wall-stand', tier: 'Intermediate', s: '3×5-8', up: '3×8' },
    { id: 'rollout-negative', tier: 'Advanced', s: '3×3-5', up: '3×5 slow, pelvis tucked' },
    { id: 'rollout-stand', tier: 'Advanced', s: '3×5-8', up: '3×8' },
    { id: 'rollout-weighted', tier: 'Elite', s: '3×3-5' },
  ] },
  hollow: { name: 'Hollow Body', start: 2, steps: [
    { id: 'tuck-hollow', tier: 'Beginner', s: '3×15-30s', p: '2×15-20s', up: '3×30s, lower back flat' },
    { id: 'one-leg-hollow', tier: 'Beginner', s: '3×15-30s', p: '2×15-20s', up: '3×30s, lower back flat' },
    { id: 'hollow-hold', tier: 'Novice', s: '3×15-30s', p: '2×15-20s', up: '3×30s, lower back flat' },
    { id: 'overhead-hollow', tier: 'Intermediate', s: '3×20-60s', p: '2×15-30s', up: '60s, lower back flat' },
    { id: 'hollow-rocks', tier: 'Intermediate', s: '3×15-20', p: '2×10-15' },
  ] },
  arch: { name: 'Arch Body', steps: [
    { id: 'arch-hold', tier: 'Beginner', s: '3×15-30s', up: '3×30s' },
    { id: 'overhead-arch', tier: 'Novice', s: '3×20-60s', up: '60s' },
    { id: 'arch-rocks', tier: 'Intermediate', s: '3×10-20', up: '3×20' },
    { id: 'reverse-hyper', tier: 'Intermediate', s: '3×8-12', b: 'Flat bench', up: '3×12' },
    { id: 'weighted-reverse-hyper', tier: 'Advanced', s: '3×8-12', b: 'Flat bench' },
  ] },
};

export const LADDER_ORDER = ['handstand', 'planche', 'lever', 'pushup', 'hspu', 'rollout', 'hollow', 'arch'];

export const KIT = [
  { key: 'bar', label: 'Pull-up bar', off: 'no-bar alternatives' },
  { key: 'wheel', label: 'Ab wheel', off: 'crunches and hollow holds instead' },
  { key: 'barbell', label: 'Barbell', off: 'the dumbbell versions' },
];
export const KIT_DEFAULTS = { bar: true, wheel: true, barbell: false };

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const todayKey = (d = new Date()) => WEEK[d.getDay()];
export const dayByKey = (key) => DAYS.find((d) => d.day === key) || null;

/** The step of a ladder you're on (your saved level, else where the ladder starts). */
export function levelOf(line, levels = {}) {
  const L = LADDERS[line];
  if (!L) return 0;
  const i = levels[line];
  return Number.isInteger(i) ? Math.max(0, Math.min(L.steps.length - 1, i)) : L.start || 0;
}

/**
 * What a slot means for you today: the exercise id, its prescription and,
 * for ladders, which step. `other` is the option not taken (the alternate,
 * or the main exercise when the alternate is showing).
 */
export function resolve(slot, { kit = KIT_DEFAULTS, levels = {} } = {}) {
  const owns = (k) => (k in kit ? !!kit[k] : KIT_DEFAULTS[k] ?? true);
  const swap = slot.alt && !owns(slot.req);
  const chosen = swap ? slot.alt : slot;
  const other = slot.alt ? (swap ? slot : slot.alt) : null;
  const step = (x) => {
    if (!x.line || !LADDERS[x.line]) return { id: x.id, name: x.name, rx: x.s, bench: x.b };
    const L = LADDERS[x.line];
    const i = levelOf(x.line, levels);
    const st = L.steps[i];
    const dose = { s: ['s'], p: ['p', 's'], l: ['l', 'p', 's'] }[slot.dose || 's'] || ['s'];
    const rx = st[dose.find((d) => st[d])];
    return { id: st.id, name: st.name, rx, bench: st.b, line: x.line, level: i, tier: st.tier, up: st.up, ladder: L.name };
  };
  return { ...step(chosen), req: slot.req || null, swapped: swap, other: other ? step(other) : null };
}

/** Every exercise id your program can use (all days, alternates and ladder steps). */
export function programIds() {
  const ids = new Set();
  const add = (x) => {
    if (x.id) ids.add(x.id);
    if (x.line) LADDERS[x.line].steps.forEach((st) => ids.add(st.id));
    if (x.alt) add(x.alt);
  };
  DAYS.forEach((d) => d.sections.forEach((s) => s.ex.forEach(add)));
  return ids;
}

/**
 * Bartleby keeps its equipment switches and ladder levels in this browser
 * too when both apps are opened from the same site. Read them once as a
 * starting point (never written back).
 */
export function fromBartleby() {
  const read = (k) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? undefined : JSON.parse(v);
    } catch {
      return undefined;
    }
  };
  const kit = {};
  for (const k of ['bar', 'wheel', 'barbell']) {
    const v = read(`bp_${k}`);
    if (typeof v === 'boolean') kit[k] = v;
  }
  const lvl = read('bp_lvl');
  const levels = lvl && typeof lvl === 'object' ? Object.fromEntries(Object.entries(lvl).filter(([k, v]) => LADDERS[k] && Number.isInteger(v))) : {};
  return { kit, levels };
}
