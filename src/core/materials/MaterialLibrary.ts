import type { MaterialPreset, MaterialOperation } from './MaterialPreset';
import { getDefaultMaterialPresets, isDefaultMaterialPresetId } from './defaultPresets';
import { type Layer, type LaserSettings, type LayerMode } from '../scene/Layer';
import { MAX_LASER_SPEED } from '../types';
import { getDeviceProfiles, saveDeviceProfile, type DeviceProfile } from '../devices/DeviceProfile';
import type { ResponseCurve } from './ResponseCurve';

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
 * Apply preset power/speed/passes (and optional image/cut/tabs fields) to a layer,
 * and stamp `materialPresetId` so JobCompiler can look up compile-time fields
 * (kerf, zOffset, responseCurve) from the preset later.
 *
 * Returns null if the preset has no operation for the layer's current mode.
 *
 * NOTE: kerf, zOffset, and responseCurve are NOT written onto the layer — they
 * stay on the preset and are read at compile time via the preset id. This keeps
 * a single source of truth and avoids stale layer copies of calibration data.
 */
export function applyMaterialPresetToLayer(layer: Layer, preset: MaterialPreset): Layer | null {
  const mode = layer.settings.mode;
  const op = operationForMode(preset, mode);
  if (!op) return null;

  const powerMax = Math.max(0, Math.min(100, Number(op.power) || 0));
  const speed = Math.max(1, Math.min(MAX_LASER_SPEED, Number(op.speed) || 1));
  const passes = Math.max(1, Math.min(99, Math.round(Number(op.passes) || 1)));

  const nextSettings: LaserSettings = {
    ...layer.settings,
    power: { ...layer.settings.power, min: Math.min(layer.settings.power.min, powerMax), max: powerMax },
    speed,
    passes,
    materialPresetId: preset.id,
  };

  // Image-mode fields from operation (each applied only when the preset specifies it)
  if (op.dithering !== undefined) {
    nextSettings.image = { ...nextSettings.image, dithering: op.dithering };
  }
  if (op.dpi !== undefined) {
    nextSettings.image = { ...nextSettings.image, resolution: op.dpi };
  }
  if (op.threshold !== undefined) {
    nextSettings.image = { ...nextSettings.image, imageThreshold: op.threshold };
  }
  if (op.airAssist !== undefined) {
    nextSettings.airAssist = op.airAssist;
  }

  // Preset-level fields that DO get mirrored onto the layer
  if (preset.leadIn !== undefined) {
    nextSettings.cut = { ...nextSettings.cut, leadIn: preset.leadIn };
  }
  if (preset.tabs !== undefined) {
    nextSettings.tabs = { ...preset.tabs };
  }

  // kerf, zOffset, responseCurve: consumed at compile time via materialPresetId
  // lookup; intentionally NOT copied to the layer.

  return { ...layer, settings: nextSettings };
}

/**
 * One-time migration: move any DeviceProfile.responseCurves entries onto
 * matching MaterialPresets (via the new `responseCurve` field). Entries
 * that were migrated are cleared from the device profile; entries that
 * couldn't be safely migrated stay put as a fallback read path.
 *
 * Idempotent: running twice has no additional effect once all migratable
 * entries have moved. Safe to call on every app mount.
 *
 * Matching rules (applied per curve key):
 *   1. Candidates = presets whose `material` equals the curve key,
 *      case-insensitively.
 *   2. If ANY candidate already has a `responseCurve` set, skip migration
 *      for this entry and keep it on the device profile. This protects
 *      fresher user calibration data from being clobbered by older data
 *      left on the profile.
 *   3. Otherwise, pick the first user-owned candidate (non-default id).
 *      This avoids cloning a default preset just because it happens to
 *      share a material name.
 *   4. Only if there are no user candidates do we fall back to the first
 *      default-id candidate — saving it as a new user preset (via
 *      savePreset's default-id rewrite) so the calibration is preserved.
 *   5. Anything unmatched remains on the device profile.
 */
export function migrateDeviceProfileResponseCurves(): void {
  const profiles = getDeviceProfiles();
  let profilesChanged = false;

  for (const profile of profiles) {
    const curves = profile.responseCurves;
    if (!curves || Object.keys(curves).length === 0) continue;

    const allPresets = getPresets();
    const remainingCurves: Record<string, ResponseCurve> = {};
    let profileHadAnyMigrated = false;

    for (const [materialName, curve] of Object.entries(curves)) {
      const candidates = allPresets.filter(
        p => p.material.toLowerCase() === materialName.toLowerCase(),
      );

      const anyAlreadyCalibrated = candidates.some(p => p.responseCurve !== undefined);
      if (anyAlreadyCalibrated) {
        remainingCurves[materialName] = curve;
        continue;
      }

      const userMatch = candidates.find(p => !isDefaultMaterialPresetId(p.id));
      const match = userMatch ?? candidates[0];
      if (match) {
        savePreset({ ...match, responseCurve: curve });
        profileHadAnyMigrated = true;
      } else {
        remainingCurves[materialName] = curve;
      }
    }

    if (profileHadAnyMigrated) {
      const updated: DeviceProfile = {
        ...profile,
        responseCurves: remainingCurves,
      };
      saveDeviceProfile(updated);
      profilesChanged = true;
    }
  }

  if (profilesChanged) {
    // eslint-disable-next-line no-console
    console.log('[MaterialLibrary] Migrated response curves to presets');
  }
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
