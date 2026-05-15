/**
 * T2-6 Phase 3u: pure selection helpers extracted from App.tsx. Pre-
 * phase-3u these two helpers lived inside the 1961-line App
 * component:
 *
 *   - `filterValidIds(ids, scene)`: drop selection IDs that no longer
 *     exist in the scene's object list. Used by App's
 *     setSelectedIds wrapper to keep the selection set in sync with
 *     scene mutations (undo/redo, paste, delete) — without it,
 *     stale IDs survive scene replacements and cause "phantom
 *     selection" bugs where the panel claims an object is selected
 *     but no object matches.
 *
 *   - `selectAllSelectableIds(scene)`: build the set of IDs for
 *     `Ctrl+A` ("Select All"). Excludes invisible AND locked objects
 *     — invisible objects aren't on the canvas, locked objects must
 *     be explicitly unlocked before they can be moved/deleted, so
 *     including them in "Select All" makes the toolbar buttons
 *     misleading.
 *
 * Both are pure (input → output, no `this`, no React, no storage).
 * Hoisting them lets the rules be unit-tested without mounting App.
 */
import type { Scene } from '../../../core/scene/Scene';

/**
 * Filter a set of selection IDs down to those that still exist in
 * `scene.objects`. Returns a NEW set (never mutates input). Cheap
 * fast-path: empty input returns a new empty set.
 */
export function filterValidIds(ids: ReadonlySet<string>, scene: Scene): Set<string> {
  if (ids.size === 0) return new Set();
  const sceneIds = new Set(scene.objects.map((o) => o.id));
  const valid = new Set<string>();
  for (const id of ids) {
    if (sceneIds.has(id)) valid.add(id);
  }
  return valid;
}

/**
 * Build the IDs for `Ctrl+A` Select All. Includes every object that
 * is BOTH visible AND not locked — locked objects must be unlocked
 * first before they participate in selection-based operations, and
 * invisible objects aren't on the canvas to be operated on.
 */
export function selectAllSelectableIds(scene: Scene): Set<string> {
  return new Set(
    scene.objects.filter((o) => o.visible && !o.locked).map((o) => o.id),
  );
}

/**
 * T2-6 Phase 3ao: quick-action selected-text predicate. App.tsx still owns
 * rendering; this helper owns the pure selected-object scan.
 */
export function hasSelectedTextObject(scene: Scene, selectedIds: ReadonlySet<string>): boolean {
  return scene.objects.some((o) => selectedIds.has(o.id) && o.geometry.type === 'text');
}
