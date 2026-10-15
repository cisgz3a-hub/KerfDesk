import { sceneObjectHasVisibleLayer, type Scene, type SceneObject } from '../../core/scene';
import type { AppState } from '../state/store';
import { selectionFromIds } from '../state/scene-group-actions';
import { RemoteFault } from './fault';
import { publicIdentifier, selectedIds } from './projections';
import type { RemoteSelectionArgs } from './selection-validation';

/** Prepare one authoritative selection before committing; desktop group focus is local UI state. */
export function prepareRemoteSelection(state: AppState, args: RemoteSelectionArgs): string[] {
  const mode = args.mode ?? 'replace';
  if (mode === 'clear') return [];
  const scene = state.project.scene;
  const objects = new Map(scene.objects.map((object) => [object.id, object]));
  const unitFor = selectionUnits(state);
  const current = new Set(selectedIds(state));
  const next = new Set(mode === 'replace' || mode === 'all' ? [] : current);
  const processed = new Set<readonly string[]>();
  const requested =
    mode === 'all' ? scene.objects.map((object) => object.id) : (args.artworkIds ?? []);
  for (const id of requested) {
    validateTarget(id, mode, objects, current);
    const unit = unitFor(id);
    // Multiple requested siblings toggle their shared group exactly once.
    if (processed.has(unit)) continue;
    processed.add(unit);
    applySelectionUnit(unit, { mode, scene, objects, current, next });
  }
  // Target units are already expanded. Keep untouched partial selections from local group
  // focus intact, so removing one unit cannot accidentally add another unit's siblings.
  const selection = selectionFromIds(state, [...next], false, {
    scope: 'document',
    expandGroups: false,
    preserveExisting: true,
  });
  const ids = [
    ...(selection.selectedObjectId === null ? [] : [selection.selectedObjectId]),
    ...selection.additionalSelectedIds,
  ];
  if (ids.length > 200 || ids.some((id) => !publicIdentifier(id)))
    throw new RemoteFault('unsupported_operation');
  return ids;
}

type SelectionMode = NonNullable<RemoteSelectionArgs['mode']>;

function validateTarget(
  id: string,
  mode: SelectionMode,
  objects: ReadonlyMap<string, SceneObject>,
  current: ReadonlySet<string>,
): void {
  if (mode === 'all') return;
  if (!publicIdentifier(id)) throw new RemoteFault('unsupported_operation');
  if (!objects.has(id) && !(mode === 'remove' && current.has(id)))
    throw new RemoteFault('not_found');
}

function applySelectionUnit(
  unit: readonly string[],
  {
    mode,
    scene,
    objects,
    current,
    next,
  }: {
    mode: SelectionMode;
    scene: Scene;
    objects: ReadonlyMap<string, SceneObject>;
    current: ReadonlySet<string>;
    next: Set<string>;
  },
): void {
  const remove =
    mode === 'remove' || (mode === 'toggle' && unit.every((member) => current.has(member)));
  if (remove) {
    for (const member of unit) next.delete(member);
    return;
  }
  const fault = unitFault(scene, objects, unit);
  if (fault !== undefined) {
    if (mode === 'all') return;
    throw new RemoteFault(fault);
  }
  for (const member of unit) next.add(member);
}

function unitFault(
  scene: Scene,
  objects: ReadonlyMap<string, SceneObject>,
  unit: readonly string[],
) {
  for (const member of unit) {
    if (!publicIdentifier(member)) return 'unsupported_operation';
    const object = objects.get(member);
    if (object === undefined) return 'not_found';
    if (object.locked === true || !sceneObjectHasVisibleLayer(scene, object)) return 'not_editable';
  }
  return undefined;
}

/** Cache connected group units, including nested and overlapping memberships, without a cap.
 * A large existing group must still be removable; only the resulting selection is bounded.
 */
function selectionUnits(state: AppState): (id: string) => readonly string[] {
  const memberships = new Map<string, (readonly string[])[]>();
  for (const group of state.project.scene.groups ?? []) {
    for (const id of group.objectIds) {
      const groups = memberships.get(id) ?? [];
      groups.push(group.objectIds);
      memberships.set(id, groups);
    }
  }
  const cache = new Map<string, readonly string[]>();
  return (id) => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const pending = [id];
    const seen = new Set(pending);
    const expanded = new Set<readonly string[]>();
    for (const member of pending) {
      for (const group of memberships.get(member) ?? []) {
        if (expanded.has(group)) continue;
        expanded.add(group);
        for (const sibling of group) {
          if (seen.has(sibling)) continue;
          seen.add(sibling);
          pending.push(sibling);
        }
      }
    }
    for (const member of pending) cache.set(member, pending);
    return pending;
  };
}
