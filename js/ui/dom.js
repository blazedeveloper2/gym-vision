// Small DOM helpers shared by the views.
export const $ = (id) => document.getElementById(id);

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

let toastTimer = 0;
export function toast(text, ms = 2800) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function banner(text, tone = 'info') {
  const el = $('banner');
  if (!text) {
    el.hidden = true;
    return;
  }
  setText(el, text);
  if (el.dataset.tone !== tone) el.dataset.tone = tone;
  el.hidden = false;
}

export function loading(text) {
  $('loading').hidden = !text;
  if (text) $('loadingText').textContent = text;
}

export const fmtLen = (cm, units, digits = 1) =>
  units === 'in' ? `${(cm / 2.54).toFixed(digits)} in` : `${cm.toFixed(digits)} cm`;
