import type { Scene, SceneGroup } from './scene';
import { isRegistrationBox } from './registration-layer';
import { designNodeOrder, nodeOrderKey, type DesignNodeRef } from './design-hierarchy-order';
import {
  designNodeChildren,
  designNodeParent,
  groupAncestors,
  hierarchyShapeProblem,
} from './design-hierarchy-membership';

export type DesignHierarchyMove = {
  readonly node: DesignNodeRef;
  readonly parentId: string | null;
  /** Omit or null to append; an anchor must be a direct sibling in the destination. */
  readonly before?: DesignNodeRef | null;
};
export type DesignHierarchyMoveResult =
  | { readonly kind: 'ok'; readonly scene: Scene }
  | { readonly kind: 'error'; readonly message: string };

export function moveDesignNode(scene: Scene, move: DesignHierarchyMove): DesignHierarchyMoveResult {
  const problem = moveProblem(scene, move);
  if (problem !== null) return { kind: 'error', message: problem };
  const oldParent = designNodeParent(scene, move.node) ?? null;
  const next = oldParent === move.parentId ? scene : transferMembership(scene, move, oldParent);
  if (typeof next === 'string') return { kind: 'error', message: next };
  return positionNode(scene, next, move, oldParent);
}
function positionNode(
  scene: Scene,
  next: Scene,
  move: DesignHierarchyMove,
  oldParent: string | null,
): DesignHierarchyMoveResult {
  const siblings = designNodeChildren(next, move.parentId);
  if (move.before != null && !siblings.some((ref) => same(ref, move.before)))
    return {
      kind: 'error',
      message: 'The insertion target is no longer a direct child of the destination.',
    };
  if (same(move.node, move.before)) return { kind: 'ok', scene };
  const oldSiblings = designNodeChildren(scene, oldParent).map(nodeOrderKey);
  const reordered = siblings.filter((ref) => !same(ref, move.node));
  const siblingIndex =
    move.before == null ? reordered.length : reordered.findIndex((ref) => same(ref, move.before));
  reordered.splice(siblingIndex, 0, move.node);
  if (
    oldParent === move.parentId &&
    oldSiblings.length === reordered.length &&
    oldSiblings.every((key, index) => {
      const ref = reordered[index];
      return ref !== undefined && key === nodeOrderKey(ref);
    })
  )
    return { kind: 'ok', scene };
  const order = designNodeOrder(next).filter((ref) => !same(ref, move.node));
  const index =
    move.before == null ? order.length : order.findIndex((ref) => same(ref, move.before));
  order.splice(index, 0, move.node);
  return { kind: 'ok', scene: { ...next, designTreeOrder: order } };
}
function same(a: DesignNodeRef, b: DesignNodeRef | null | undefined): boolean {
  return b !== undefined && b !== null && a.kind === b.kind && a.id === b.id;
}
function moveProblem(scene: Scene, move: DesignHierarchyMove): string | null {
  const nodeProblem = movingNodeProblem(scene, move.node);
  if (nodeProblem !== null) return nodeProblem;
  if (move.parentId !== null && !scene.groups?.some((item) => item.id === move.parentId))
    return 'The destination group no longer exists.';
  if (move.node.kind === 'group' && groupAncestors(scene, move.parentId).includes(move.node.id))
    return 'A group cannot be moved into itself or one of its descendants.';
  if (designNodeParent(scene, move.node) === undefined)
    return 'This artwork belongs to overlapping legacy groups. Resolve those memberships explicitly before transferring it.';
  return hierarchyShapeProblem(scene);
}
function movingNodeProblem(scene: Scene, node: DesignNodeRef): string | null {
  const group = scene.groups?.find((item) => item.id === node.id);
  const object = scene.objects.find((item) => item.id === node.id);
  if (node.kind === 'group' ? group === undefined : object === undefined)
    return 'The artwork or group no longer exists.';
  if (node.kind === 'object' && object !== undefined && isRegistrationBox(object))
    return 'Registration artwork cannot be moved in the design hierarchy.';
  const ids = new Set(node.kind === 'group' ? (group?.objectIds ?? []) : [node.id]);
  if (scene.objects.some((item) => ids.has(item.id) && item.locked === true))
    return 'Unlock the moving artwork before changing its hierarchy.';
  return null;
}
function transferMembership(
  scene: Scene,
  move: DesignHierarchyMove,
  oldParent: string | null,
): Scene | string {
  const groups = scene.groups ?? [];
  const movedGroup = groups.find((group) => group.id === move.node.id);
  const movedIds = new Set(
    move.node.kind === 'group' ? (movedGroup?.objectIds ?? []) : [move.node.id],
  );
  const oldAncestors = new Set(groupAncestors(scene, oldParent));
  const newAncestors = new Set(groupAncestors(scene, move.parentId));
  const allowed = new Set([...oldAncestors, ...newAncestors]);
  if (move.node.kind === 'group') {
    for (const group of groups)
      if (groupAncestors(scene, group.id).includes(move.node.id)) allowed.add(group.id);
  }
  const overlap = groups.find(
    (group) => !allowed.has(group.id) && group.objectIds.some((id) => movedIds.has(id)),
  );
  if (overlap !== undefined)
    return `Shared artwork also belongs to “${overlap.name}”. This transfer is ambiguous; resolve overlapping memberships explicitly first.`;
  const nextGroups = groups.map((group) =>
    updateGroup(group, move, movedIds, oldAncestors, newAncestors),
  );
  const small = nextGroups.find((group) => group.objectIds.length < 2);
  if (small !== undefined)
    return `This move would leave “${small.name}” with ${small.objectIds.length} artwork${small.objectIds.length === 1 ? '' : 's'}. Groups require at least two; ungroup it explicitly first.`;
  return { ...scene, groups: nextGroups };
}
function updateGroup(
  group: SceneGroup,
  move: DesignHierarchyMove,
  movedIds: ReadonlySet<string>,
  oldAncestors: ReadonlySet<string>,
  newAncestors: ReadonlySet<string>,
): SceneGroup {
  let next = group;
  if (oldAncestors.has(group.id) && !newAncestors.has(group.id))
    next = { ...next, objectIds: next.objectIds.filter((id) => !movedIds.has(id)) };
  if (newAncestors.has(group.id) && !oldAncestors.has(group.id))
    next = {
      ...next,
      objectIds: [...next.objectIds, ...[...movedIds].filter((id) => !next.objectIds.includes(id))],
    };
  if (move.node.kind === 'group' && group.id === move.node.id) {
    const { parentId: _old, ...unparented } = next;
    next = move.parentId === null ? unparented : { ...unparented, parentId: move.parentId };
  }
  return next;
}
