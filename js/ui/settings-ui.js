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

  // Height: centimetres, or feet + inches (e.g. 5 ft 8 in). Stored in cm.
  const units = $('setUnits');
  const cm = $('setHeight');
  const ft = $('setHeightFt');
  const inch = $('setHeightIn');
  const showHeight = () => {
    const imperial = s.units === 'in';
    units.value = s.units;
    $('heightCmBox').hidden = imperial;
    $('heightFtBox').hidden = !imperial;
    cm.value = s.heightCm ? s.heightCm.toFixed(1) : '';
    const totalIn = s.heightCm ? Math.round((s.heightCm / 2.54) * 2) / 2 : null; // nearest ½ inch
    ft.value = totalIn ? Math.floor(totalIn / 12) : '';
    inch.value = totalIn ? +(totalIn % 12).toFixed(1) : '';
  };
  const saveHeight = (value) => {
    s.heightCm = value >= 100 && value <= 250 ? value : null;
    app.persist();
  };
  cm.addEventListener('change', () => saveHeight(Number(cm.value)));
  const fromFeet = () => {
    if (ft.value === '') return;
    saveHeight((Number(ft.value) * 12 + Number(inch.value || 0)) * 2.54);
  };
  ft.addEventListener('change', fromFeet);
  inch.addEventListener('change', fromFeet);
  units.addEventListener('change', () => {
    s.units = units.value;
    app.persist();
    showHeight();
  });

  // Weight: kilograms or pounds. Stored in kg.
  const LB = 0.45359237;
  const weight = $('setWeight');
  const weightUnit = $('setWeightUnit');
  const showWeight = () => {
    const lb = s.weightUnit === 'lb';
    weightUnit.value = s.weightUnit;
    weight.placeholder = lb ? 'lb' : 'kg';
    weight.min = lb ? 45 : 20;
    weight.max = lb ? 660 : 300;
    weight.value = s.weightKg ? (lb ? s.weightKg / LB : s.weightKg).toFixed(1) : '';
  };
  weight.addEventListener('change', () => {
    const v = Number(weight.value);
    s.weightKg = v > 0 ? (s.weightUnit === 'lb' ? v * LB : v) : null;
    app.persist();
  });
  weightUnit.addEventListener('change', () => {
    s.weightUnit = weightUnit.value;
    app.persist();
    showWeight();
  });
  showHeight();
  showWeight();

  return {
    refresh() {
      showHeight();
      showWeight();
      $('setSex').value = s.sex || '';
      document.querySelectorAll('input[name="model"]').forEach((r) => (r.checked = r.value === s.model));
    },
  };
}
