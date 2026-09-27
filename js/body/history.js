// Saved measurement sessions, kept on this device.
const KEY = 'gymvision.measurements.v1';

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Adds a session: {date, heightCm, values: {id: {value, plusMinus}}}. */
export function addSession(session) {
  const list = loadHistory();
  list.push(session);
  list.sort((a, b) => a.date.localeCompare(b.date));
  return save(list);
}

export function deleteSession(date) {
  return save(loadHistory().filter((s) => s.date !== date));
}

/** Per-measure series over time: {id: [{date, value}]}. */
export function seriesById(list = loadHistory()) {
  const out = {};
  for (const s of list) for (const [id, v] of Object.entries(s.values)) (out[id] ??= []).push({ date: s.date, value: v.value });
  return out;
}

export function toCsv(list, names) {
  const ids = [...new Set(list.flatMap((s) => Object.keys(s.values)))];
  const rows = [['date', 'height_cm', ...ids.map((id) => `${names[id] || id} (cm)`)]];
  for (const s of list) rows.push([s.date, s.heightCm, ...ids.map((id) => (s.values[id] ? s.values[id].value.toFixed(1) : ''))]);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}
