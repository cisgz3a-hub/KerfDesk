import type { Scene } from '../../core/scene';

type Neighbours = Map<string, Set<string>>;
export type RigidNestDependencies =
  | { readonly ok: true; readonly neighbours: ReadonlyMap<string, ReadonlySet<string>> }
  | { readonly ok: false; readonly reason: string };

/** Keep groups and external image-mask dependencies rigid. Analysis owns only
 * its new graph; source objects, groups and the selection are never mutated. */
export function rigidNestDependencies(
  scene: Scene,
  movableIds: ReadonlySet<string>,
): RigidNestDependencies {
  const neighbours: Neighbours = new Map();
  const error =
    connectRigidGroups(scene, movableIds, neighbours) ??
    connectImageMasks(scene, movableIds, neighbours);
  return error === null ? { ok: true, neighbours } : { ok: false, reason: error };
}
function connectRigidGroups(
  scene: Scene,
  movableIds: ReadonlySet<string>,
  neighbours: Neighbours,
): string | null {
  for (const group of scene.groups ?? []) {
    if (group.objectIds.length < 2 || !group.objectIds.some((id) => movableIds.has(id))) continue;
    if (!group.objectIds.every((id) => movableIds.has(id)))
      return 'Select every member of each group and unlock/show it before nesting. Groups must stay rigid.';
    const first = group.objectIds[0];
    if (first !== undefined) for (const id of group.objectIds) connect(first, id, neighbours);
  }
  return null;
}
function connectImageMasks(
  scene: Scene,
  movableIds: ReadonlySet<string>,
  neighbours: Neighbours,
): string | null {
  const objectIds = new Set(scene.objects.map((object) => object.id));
  for (const object of scene.objects) {
    if (object.kind !== 'raster-image' || object.imageMaskId === undefined) continue;
    const imageMoves = movableIds.has(object.id),
      maskMoves = movableIds.has(object.imageMaskId);
    if (!imageMoves && !maskMoves) continue;
    if (!objectIds.has(object.imageMaskId))
      return 'Restore the missing image mask before nesting this artwork.';
    if (!imageMoves || !maskMoves)
      return 'Select every image and its mask and unlock/show them before nesting. Shared masks must stay rigid.';
    connect(object.id, object.imageMaskId, neighbours);
  }
  return null;
}
function connect(first: string, second: string, neighbours: Neighbours): void {
  const from = neighbours.get(first) ?? new Set<string>();
  from.add(second);
  neighbours.set(first, from);
  const to = neighbours.get(second) ?? new Set<string>();
  to.add(first);
  neighbours.set(second, to);
}
/** Iterative traversal also joins overlapping legacy groups and shared masks. */
export function rigidNestMembers(
  first: string,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const members = new Set<string>(),
    pending = [first];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || members.has(id)) continue;
    members.add(id);
    for (const other of neighbours.get(id) ?? []) if (!members.has(other)) pending.push(other);
  }
  return members;
}
