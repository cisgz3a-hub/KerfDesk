import type { Layer } from '../../core/scene';
import type { LayerDefaultsState } from '../state/layer-default-actions';

export type LayerDefaultSettings = Partial<Omit<Layer, 'id' | 'color'>>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function captureLayerDefaultSettings(layer: Layer): LayerDefaultSettings {
  const { id: _id, color: _color, ...settings } = layer;
  return settings;
}

export function applyLayerDefaultSettings(layer: Layer, settings: LayerDefaultSettings): Layer {
  return { ...layer, ...settings, id: layer.id, color: layer.color };
}

export function layerDefaultsStorageKey(deviceProfileName: string): string {
  return `laserforge.layer-defaults.v1.${deviceProfileName.trim() || 'default'}`;
}

export function persistLayerDefaults(
  storage: StorageLike,
  deviceProfileName: string,
  defaults: LayerDefaultsState,
): boolean {
  try {
    const key = layerDefaultsStorageKey(deviceProfileName);
    if (isEmptyLayerDefaults(defaults)) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify(defaults));
    return true;
  } catch {
    return false;
  }
}

export function restoreLayerDefaults(
  storage: StorageLike,
  deviceProfileName: string,
): LayerDefaultsState | null {
  const key = layerDefaultsStorageKey(deviceProfileName);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const parsed = parseLayerDefaults(raw);
  if (parsed === null) {
    clearSlot(storage, key);
    return null;
  }
  return parsed;
}

function isEmptyLayerDefaults(defaults: LayerDefaultsState): boolean {
  return Object.keys(defaults.byColor).length === 0 && defaults.allColors === null;
}

function parseLayerDefaults(raw: string): LayerDefaultsState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const byColor = (parsed as Record<string, unknown>)['byColor'];
  const allColors = (parsed as Record<string, unknown>)['allColors'];
  if (!isLayerDefaultRecord(byColor)) return null;
  if (allColors !== null && !isLayerDefaultSettings(allColors)) return null;
  return { byColor, allColors };
}

function isLayerDefaultRecord(value: unknown): value is Record<string, LayerDefaultSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([color, settings]) => /^#[0-9a-f]{6}$/.test(color) && isLayerDefaultSettings(settings),
  );
}

function isLayerDefaultSettings(value: unknown): value is LayerDefaultSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return !('id' in value) && !('color' in value);
}

function clearSlot(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Restore already returns null; clearing is best-effort.
  }
}
