/**
 * T1-133: pure grouping helper extracted from `LayerPanel.tsx`. Pre-T1-133
 * the LayerPanel had a `useMemo` block (`materialPresetsByMaterial` at
 * lines 106-118) that grouped the loaded material-preset list by the
 * `material` field, sub-sorted each group by name, and then sorted the
 * groups by material name. Pure data transform, but it was inline and
 * not testable without mounting the whole panel with a fixture for
 * `getPresets()` and re-rendering on `materialPresetRevision`.
 *
 * Hoisting to a sibling module:
 *   - lets the grouping rule be unit-tested in isolation
 *   - clarifies the panel's render-time computation (one call instead
 *     of 13 lines of inline reduce-then-sort)
 *   - makes the next preset surface (e.g. a future preset picker
 *     dialog) reuse the same sort order without copy-paste
 *
 * No behavioral change — `LayerPanel`'s useMemo still passes the same
 * presets in and the panel still iterates the returned tuple list.
 */
import type { MaterialPreset } from '../../../core/materials/MaterialPreset';

/**
 * Group material presets by the `material` field, with each group's
 * presets sorted by `name`, and the groups themselves sorted by
 * material name. Presets whose `material` field is empty land in an
 * "Other" bucket so the picker still surfaces them.
 *
 * Sort is `String.prototype.localeCompare` (locale-aware, like the
 * pre-T1-133 inline code). Returns an array of `[material, presets]`
 * tuples so callers can iterate in stable order.
 */
export function groupMaterialPresetsByMaterial(
  presets: ReadonlyArray<MaterialPreset>,
): Array<[string, MaterialPreset[]]> {
  const map = new Map<string, MaterialPreset[]>();
  for (const p of presets) {
    const key = p.material || 'Other';
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
