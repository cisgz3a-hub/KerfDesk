import type { Scene, SceneGroup } from './scene';
import { isRegistrationBox } from './registration-layer';
import { sortDesignNodes, type DesignNodeRef } from './design-hierarchy-order';

export function groupAncestors(scene: Scene, parentId: string | null): ReadonlyArray<string> {
  const byId = new Map((scene.groups ?? []).map((group) => [group.id, group]));
  const result: string[] = [],
    seen = new Set<string>();
  let next = parentId;
  while (next !== null && !seen.has(next)) {
    seen.add(next);
    result.push(next);
    next = byId.get(next)?.parentId ?? null;
  }
  return result;
}
export function objectDirectGroups(scene: Scene, objectId: string): ReadonlyArray<SceneGroup> {
  const members = (scene.groups ?? []).filter((group) => group.objectIds.includes(objectId));
  const indirect = new Set(
    members.flatMap((group) => groupAncestors(scene, group.parentId ?? null)),
  );
  return members.filter((group) => !indirect.has(group.id));
}
export function designNodeParent(scene: Scene, node: DesignNodeRef): string | null | undefined {
  if (node.kind === 'group') {
    const found = scene.groups?.find((group) => group.id === node.id);
    return found === undefined ? undefined : (found.parentId ?? null);
  }
  const direct = objectDirectGroups(scene, node.id);
  return direct.length > 1 ? undefined : (direct[0]?.id ?? null);
}
/** Direct candidates; rendering deduplicates legacy overlapping memberships separately. */
export function designNodeChildren(
  scene: Scene,
  parentId: string | null,
): ReadonlyArray<DesignNodeRef> {
  const groups = scene.groups ?? [];
  const nested = groups.filter((group) => (group.parentId ?? null) === parentId);
  const nestedIds = new Set(nested.flatMap((group) => group.objectIds));
  const parent = groups.find((group) => group.id === parentId);
  const grouped = new Set(groups.flatMap((group) => group.objectIds));
  const direct = scene.objects.filter((object) => {
    if (isRegistrationBox(object)) return false;
    return parentId === null
      ? !grouped.has(object.id)
      : parent?.objectIds.includes(object.id) === true && !nestedIds.has(object.id);
  });
  return sortDesignNodes(
    scene,
    [
      ...nested.map((group): DesignNodeRef => ({ kind: 'group', id: group.id })),
      ...direct.map((object): DesignNodeRef => ({ kind: 'object', id: object.id })),
    ],
    (ref) => ref,
  );
}
export function hierarchyShapeProblem(scene: Scene): string | null {
  const groups = scene.groups ?? [];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const objects = new Set(scene.objects.map((object) => object.id));
  for (const group of groups) {
    if (group.objectIds.length < 2)
      return `Group “${group.name}” must contain at least two artworks.`;
    if (group.objectIds.some((id) => !objects.has(id)))
      return `Group “${group.name}” contains missing artwork.`;
    const parent = group.parentId === undefined ? undefined : byId.get(group.parentId);
    if (group.parentId !== undefined && parent === undefined)
      return `Group “${group.name}” has a missing parent.`;
    if (parent !== undefined && group.objectIds.some((id) => !parent.objectIds.includes(id)))
      return `Group “${group.name}” is outside its parent membership.`;
    if (groupAncestors(scene, group.parentId ?? null).includes(group.id))
      return `Group “${group.name}” has a parent cycle.`;
  }
  return null;
}
