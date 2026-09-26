import { LAYER_DEFAULTS, type Layer, type MachineKind } from '../../core/scene';
import { normalizeLayer } from '../../io/project/normalize-layer';
import { validateProjectLayer } from '../../io/project/project-layer-shape-validator';
import type { LayerDefaultsState } from '../state/layer-default-actions';

// Make Default is a laser setting: it lives in the laser Cut Settings dialog
// and never carries a CNC block. New CNC operations take their bit, feeds and
// depth from Startup Setup and the stock material instead, so a laser default
// can never turn every new router cut into the last CNC operation it saw.
export type LayerDefaultSettings = Partial<Omit<Layer, 'id' | 'color' | 'cnc' | 'parkedOutput'>>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// A calibration-coupon marker and a runtime binding id describe one layer, not
// a reusable setting. A saved 'baseline' marker would let every new layer skip
// the verified-offset rule for bidirectional scanning (scan-direction-policy.ts),
// so neither is captured, and neither is applied from an older saved default.
// Its Output value is the laser Output switch: `output` in Laser mode,
// `parkedOutput` in CNC mode (ADR-416), so CNC's switch is never saved or set.
export function captureLayerDefaultSettings(
  layer: Layer,
  machineKind: MachineKind = 'laser',
): LayerDefaultSettings {
  const {
    id: _id,
    color: _color,
    scanOffsetCalibrationMode: _calibrationMode,
    bindingOperationId: _bindingOperationId,
    cnc: _cnc,
    output,
    parkedOutput,
    ...settings
  } = layer;
  return { ...settings, output: machineKind === 'cnc' ? (parkedOutput ?? output) : output };
}

export function applyLayerDefaultSettings(
  layer: Layer,
  settings: LayerDefaultSettings,
  machineKind: MachineKind = 'laser',
): Layer {
  const {
    scanOffsetCalibrationMode: _calibrationMode,
    bindingOperationId: _bindingOperationId,
    output,
    ...artwork
  } = settings;
  const laserOutput =
    output === undefined ? {} : machineKind === 'cnc' ? { parkedOutput: output } : { output };
  return {
    ...layer,
    ...withoutCncBlock(artwork),
    ...laserOutput,
    id: layer.id,
    color: layer.color,
  };
}

// Defaults saved before the split may still hold a CNC block. It is validated
// with the rest (a corrupt slot is still discarded) and then dropped.
function withoutCncBlock<T extends object>(settings: T): T {
  if (!('cnc' in settings)) return settings;
  const { cnc: _cnc, ...laserOnly } = settings as T & { readonly cnc?: unknown };
  return laserOnly as T;
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
  return {
    byColor: Object.fromEntries(
      Object.entries(byColor).map(([color, settings]) => [color, withoutCncBlock(settings)]),
    ),
    allColors: allColors === null ? null : withoutCncBlock(allColors),
  };
}

function isLayerDefaultRecord(value: unknown): value is Record<string, LayerDefaultSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([color, settings]) => /^#[0-9a-f]{6}$/.test(color) && isLayerDefaultSettings(settings),
  );
}

function isLayerDefaultSettings(value: unknown): value is LayerDefaultSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if ('id' in value || 'color' in value) return false;
  // Defaults are partial layer records. Supply only the missing required fields
  // for validation, retaining every persisted value and the project's ranges.
  const layer = { ...LAYER_DEFAULTS, id: '', name: '', color: '', ...value };
  if (validateProjectLayer(layer, 'defaults') !== null) return false;
  // Project import normalizes CNC settings instead of validating that block.
  // A saved default must already satisfy those rules; do not silently repair a
  // corrupted recipe that would otherwise be applied to every new operation.
  const normalized = normalizeLayer(layer) as Record<string, unknown>;
  return sameJsonValue((value as Record<string, unknown>)['cnc'], normalized['cnc']);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return (
    Object.keys(leftRecord).length === Object.keys(rightRecord).length &&
    Object.entries(leftRecord).every(
      ([key, value]) => Object.hasOwn(rightRecord, key) && sameJsonValue(value, rightRecord[key]),
    )
  );
}

function clearSlot(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Restore already returns null; clearing is best-effort.
  }
}
