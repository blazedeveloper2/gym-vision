import { POSE_MODELS } from '../config.js';
import { $ } from './dom.js';

/**
 * Binds the settings sheet. `hooks` react to changes that need more than a
 * saved value (reloading the model, restarting the camera, ...).
 */
export function bindSettings(app, hooks) {
  const s = app.settings;

  const modelHint = () => {
    const m = POSE_MODELS[s.model];
    $('modelHint').textContent = `${m.note}. ${m.size} download, cached after the first time.`;
  };
  document.querySelectorAll('input[name="model"]').forEach((r) => {
    r.checked = r.value === s.model;
    r.addEventListener('change', () => {
      s.model = r.value;
      app.persist();
      modelHint();
      hooks.model();
    });
  });
  modelHint();

  const select = (id, key, after, parse = (v) => v) => {
    const el = $(id);
    el.value = String(s[key]);
    el.addEventListener('change', () => {
      s[key] = parse(el.value);
      app.persist();
      after?.(s[key]);
    });
  };
  const toggle = (id, key, after) => {
    const el = $(id);
    el.checked = !!s[key];
    el.addEventListener('change', () => {
      s[key] = el.checked;
      app.persist();
      after?.(s[key]);
    });
  };

  select('setFps', 'fps', hooks.camera, Number);
  select('setDelegate', 'delegate', hooks.model);
  select('setMirror', 'mirror', hooks.mirror);
  select('setSquatDepth', 'squatDepth', hooks.exercise);
  select('setAngle', 'angleSource');
  select('setSex', 'sex', hooks.profile);
  toggle('setLabels', 'labels');
  toggle('setVoice', 'voice', hooks.voice);

  const dim = $('setDim');
  const dimOut = $('setDimVal');
  const showDim = () => (dimOut.textContent = `${Math.round((1 - s.dim) * 100)}%`);
  dim.value = s.dim;
  showDim();
  dim.addEventListener('input', () => {
    s.dim = Number(dim.value);
    showDim();
    app.persist();
  });

  const depth = $('setDepth');
  const depthOut = $('setDepthVal');
  depth.value = s.depthTarget;
  depthOut.textContent = `${s.depthTarget}°`;
  depth.addEventListener('input', () => {
    s.depthTarget = Number(depth.value);
    depthOut.textContent = `${s.depthTarget}°`;
    app.persist();
    hooks.exercise();
  });

  // Height, shown in the chosen unit.
  const height = $('setHeight');
  const units = $('setUnits');
  const showHeight = () => {
    units.value = s.units;
    height.placeholder = s.units === 'in' ? 'inches' : 'cm';
    height.min = s.units === 'in' ? 40 : 100;
    height.max = s.units === 'in' ? 100 : 250;
    height.value = s.heightCm ? (s.units === 'in' ? (s.heightCm / 2.54).toFixed(1) : s.heightCm.toFixed(1)) : '';
  };
  const weight = $('setWeight');
  const showWeight = () => {
    const lb = s.units === 'in';
    $('setWeightUnit').textContent = lb ? 'lb' : 'kg';
    weight.placeholder = lb ? 'lb' : 'kg';
    weight.min = lb ? 45 : 20;
    weight.max = lb ? 660 : 300;
    weight.value = s.weightKg ? (lb ? s.weightKg / 0.45359237 : s.weightKg).toFixed(1) : '';
  };
  showHeight();
  showWeight();
  weight.addEventListener('change', () => {
    const v = Number(weight.value);
    s.weightKg = v > 0 ? (s.units === 'in' ? v * 0.45359237 : v) : null;
    app.persist();
  });
  height.addEventListener('change', () => {
    const v = Number(height.value);
    s.heightCm = v > 0 ? (s.units === 'in' ? v * 2.54 : v) : null;
    app.persist();
  });
  units.addEventListener('change', () => {
    s.units = units.value;
    app.persist();
    showHeight();
    showWeight();
  });

  return {
    refresh() {
      showHeight();
      showWeight();
      $('setSex').value = s.sex || '';
      document.querySelectorAll('input[name="model"]').forEach((r) => (r.checked = r.value === s.model));
    },
  };
}
