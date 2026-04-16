import type { MaterialPreset, MaterialOperation } from './MaterialPreset';
import { getDefaultMaterialPresets, isDefaultMaterialPresetId } from './defaultPresets';
import { type Layer, type LayerMode } from '../scene/Layer';
import { MAX_LASER_SPEED } from '../types';

const STORAGE_KEY = 'laserforge-material-presets';

function readUserPresets(): MaterialPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRoughlyValidPreset) as MaterialPreset[];
  } catch {
    return [];
  }
}

function isRoughlyValidPreset(x: unknown): x is MaterialPreset {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.material === 'string' &&
    typeof o.thickness === 'string' &&
    typeof o.laserWattage === 'string' &&
    o.operations !== null &&
    typeof o.operations === 'object'
  );
}

function writeUserPresets(presets: MaterialPreset[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/** Defaults plus user presets from localStorage (user entries with same id as a default are ignored). */
export function getPresets(): MaterialPreset[] {
  const defaults = getDefaultMaterialPresets();
  const defaultIds = new Set(defaults.map(p => p.id));
  const user = readUserPresets().filter(p => !defaultIds.has(p.id));
  return [...defaults, ...user];
}

export function getPresetById(id: string): MaterialPreset | undefined {
  return getPresets().find(p => p.id === id);
}

export function savePreset(preset: MaterialPreset): void {
  let toStore = preset;
  if (isDefaultMaterialPresetId(preset.id)) {
    toStore = { ...preset, id: `preset-user-${Date.now()}` };
  }
  const user = readUserPresets().filter(p => p.id !== toStore.id);
  user.push(toStore);
  writeUserPresets(user);
}

export function deletePreset(id: string): void {
  if (isDefaultMaterialPresetId(id)) return;
  const user = readUserPresets().filter(p => p.id !== id);
  writeUserPresets(user);
}

export function exportPresets(): string {
  return JSON.stringify(readUserPresets(), null, 2);
}

function operationForMode(preset: MaterialPreset, mode: LayerMode): MaterialOperation | undefined {
  switch (mode) {
    case 'cut':
      return preset.operations.cut;
    case 'engrave':
      return preset.operations.engrave;
    case 'score':
      return preset.operations.score;
    default:
      return undefined;
  }
}

/**
 * Apply preset power/speed/passes (and optional image dither/resolution) to a layer.
 * Returns null if the preset has no operation for the layer's current mode.
 */
export function applyMaterialPresetToLayer(layer: Layer, preset: MaterialPreset): Layer | null {
  const mode = layer.settings.mode;
  const op = operationForMode(preset, mode);
  if (!op) return null;

  const powerMax = Math.max(0, Math.min(100, Number(op.power) || 0));
  const speed = Math.max(1, Math.min(MAX_LASER_SPEED, Number(op.speed) || 1));
  const passes = Math.max(1, Math.min(99, Math.round(Number(op.passes) || 1)));

  return {
    ...layer,
    settings: {
      ...layer.settings,
      power: { ...layer.settings.power, min: Math.min(layer.settings.power.min, powerMax), max: powerMax },
      speed,
      passes,
    },
  };
}

export function importPresets(json: string): MaterialPreset[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array of presets');
  }
  const incoming = parsed.filter(isRoughlyValidPreset) as MaterialPreset[];
  const merged = readUserPresets().slice();
  for (const p of incoming) {
    if (isDefaultMaterialPresetId(p.id)) continue;
    const idx = merged.findIndex(x => x.id === p.id);
    if (idx >= 0) merged[idx] = p;
    else merged.push(p);
  }
  writeUserPresets(merged);
  return incoming.filter(p => !isDefaultMaterialPresetId(p.id));
}
