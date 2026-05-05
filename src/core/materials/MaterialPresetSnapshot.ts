/**
 * T2-72: per-layer material preset snapshot — companion to T2-71's
 * device-profile snapshot. Pre-T2-72 a layer kept only
 * `materialPresetId`; the preset itself was looked up from the
 * material library at compile time. If the user updated the preset
 * library after save (changed power/speed values), reloading
 * silently compiled with the NEW values without any user signal —
 * a reproducibility failure of the same shape as T2-71's profile
 * case (audit 4D Critical 3 material variant).
 *
 * The snapshot captures the compile-relevant fields at apply time.
 * Load-time `checkPresetSnapshot` compares the per-layer snapshot to
 * the current library entry and surfaces drift so the user can
 * choose to keep saved values or accept the new preset.
 */

import type { MaterialPreset } from './MaterialPreset';

/**
 * Compile-relevant subset of `MaterialPreset` captured at the moment
 * the preset was applied to a layer. Fields here are the ones that
 * meaningfully change compile output; cosmetic preset metadata
 * (e.g. brand notes, library categorization) is excluded.
 */
export interface MaterialPresetSnapshot {
  id: string;
  name: string;
  /**
   * The full per-operation table at apply time. Stored as a
   * shallow clone of `MaterialPreset.operations` so future preset
   * shape changes only affect the source of truth, not historic
   * snapshots.
   */
  operations: MaterialPreset['operations'];
  /** Kerf offset in mm at apply time. */
  kerf?: number;
  /** Lead-in distance in mm at apply time. */
  leadIn?: number;
  /** Z-axis offset in mm at apply time. */
  zOffset?: number;
  /** Tabs/bridges config at apply time. */
  tabs?: MaterialPreset['tabs'];
  /** D.13 response curve at apply time. */
  responseCurve?: MaterialPreset['responseCurve'];
  /** ISO timestamp of when the preset was applied to the layer. */
  appliedAt: string;
}

export type PresetSnapshotResult =
  | { kind: 'no-snapshot' }
  | { kind: 'no-current-preset'; layerId: string }
  | { kind: 'preset-deleted'; layerId: string; snapshot: MaterialPresetSnapshot }
  | { kind: 'match'; layerId: string; snapshot: MaterialPresetSnapshot; current: MaterialPreset }
  | { kind: 'mismatch'; layerId: string; snapshot: MaterialPresetSnapshot; current: MaterialPreset; changed: PresetChange[] };

export interface PresetChange {
  field: string;
  saved: unknown;
  current: unknown;
}

/**
 * Returns a `MaterialPresetSnapshot` populated from the current
 * preset's compile-relevant fields, with `appliedAt` set to now.
 */
export function buildPresetSnapshot(preset: MaterialPreset): MaterialPresetSnapshot {
  return {
    id: preset.id,
    name: preset.name,
    operations: preset.operations,
    kerf: preset.kerf,
    leadIn: preset.leadIn,
    zOffset: preset.zOffset,
    tabs: preset.tabs,
    responseCurve: preset.responseCurve,
    appliedAt: new Date().toISOString(),
  };
}

/**
 * Field-by-field comparison between snapshot and current preset.
 * Operations table is JSON-compared (small + JSON-stable).
 */
export function diffPreset(
  saved: MaterialPresetSnapshot,
  current: MaterialPreset,
): PresetChange[] {
  const changes: PresetChange[] = [];
  if (saved.name !== current.name) {
    changes.push({ field: 'name', saved: saved.name, current: current.name });
  }
  if (JSON.stringify(saved.operations) !== JSON.stringify(current.operations)) {
    changes.push({
      field: 'operations',
      saved: saved.operations,
      current: current.operations,
    });
  }
  if (saved.kerf !== current.kerf) {
    changes.push({ field: 'kerf', saved: saved.kerf, current: current.kerf });
  }
  if (saved.leadIn !== current.leadIn) {
    changes.push({ field: 'leadIn', saved: saved.leadIn, current: current.leadIn });
  }
  if (saved.zOffset !== current.zOffset) {
    changes.push({ field: 'zOffset', saved: saved.zOffset, current: current.zOffset });
  }
  if (JSON.stringify(saved.tabs) !== JSON.stringify(current.tabs)) {
    changes.push({ field: 'tabs', saved: saved.tabs, current: current.tabs });
  }
  if (JSON.stringify(saved.responseCurve) !== JSON.stringify(current.responseCurve)) {
    changes.push({
      field: 'responseCurve',
      saved: saved.responseCurve,
      current: current.responseCurve,
    });
  }
  return changes;
}

/**
 * Classify the relationship between a layer's saved preset
 * snapshot and the current material library entry.
 */
export function checkPresetSnapshot(
  layerId: string,
  presetId: string | undefined,
  snapshot: MaterialPresetSnapshot | undefined,
  getPresetById: (id: string) => MaterialPreset | null,
): PresetSnapshotResult {
  if (!snapshot) return { kind: 'no-snapshot' };
  if (!presetId) return { kind: 'no-current-preset', layerId };
  const current = getPresetById(presetId);
  if (!current) return { kind: 'preset-deleted', layerId, snapshot };
  const changed = diffPreset(snapshot, current);
  if (changed.length === 0) return { kind: 'match', layerId, snapshot, current };
  return { kind: 'mismatch', layerId, snapshot, current, changed };
}
