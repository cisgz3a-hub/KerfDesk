import type { ArrayPlacement, SceneGroup, SceneObject } from '../../core/scene';
import {
  copyObjectsAtArrayPlacement,
  isIdentityArrayPlacement,
  placedObject,
} from './array-selection-copies';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyDependencyId,
} from './scene-object-copy-dependencies';

export type ArrayFirstPlacementPlan = {
  readonly movedById: ReadonlyMap<string, SceneObject>;
  readonly copiedObjects: ReadonlyArray<SceneObject>;
  readonly copiedIds: ReadonlyMap<string, string>;
  readonly protectedSourceIds: ReadonlySet<string>;
  readonly selectedObjectIds: ReadonlyArray<string>;
};

export function planArrayFirstPlacement(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
  selected: ReadonlyArray<SceneObject>,
  copySources: ReadonlyArray<SceneObject>,
  placement: ArrayPlacement,
  idFactory: () => string,
): ArrayFirstPlacementPlan {
  const selectedIds = new Set(selected.map((object) => object.id));
  const copySourceIds = new Set(copySources.map((object) => object.id));
  const protectedSourceIds = protectedFirstPlacementSourceIds(
    objects,
    groups,
    selectedIds,
    copySourceIds,
    placement,
  );
  const protectedCopies = copyObjectsAtArrayPlacement(
    copySources.filter((object) => protectedSourceIds.has(object.id)),
    placement,
    idFactory,
  );
  return {
    movedById: new Map(
      copySources
        .filter((object) => !protectedSourceIds.has(object.id))
        .map((object) => [
          object.id,
          remapSceneObjectCopyDependencies(placedObject(object, placement), protectedCopies.ids),
        ]),
    ),
    copiedObjects: protectedCopies.objects,
    copiedIds: protectedCopies.ids,
    protectedSourceIds,
    selectedObjectIds: selected.map((object) => protectedCopies.ids.get(object.id) ?? object.id),
  };
}

function protectedFirstPlacementSourceIds(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
  selectedIds: ReadonlySet<string>,
  copySourceIds: ReadonlySet<string>,
  placement: ArrayPlacement,
): ReadonlySet<string> {
  if (isIdentityArrayPlacement(placement)) return new Set();
  const referencedOutsideClosure = dependencyIdsReferencedOutsideClosure(objects, copySourceIds);
  const groupBoundaryIds = copySourceIdsOnGroupBoundaries(groups, copySourceIds);
  const protectedIds = new Set(
    objects
      .filter(
        (object) =>
          copySourceIds.has(object.id) &&
          ((object.locked === true && !selectedIds.has(object.id)) ||
            referencedOutsideClosure.has(object.id) ||
            groupBoundaryIds.has(object.id)),
      )
      .map((object) => object.id),
  );
  expandProtectedIds(protectedIds, objects, groups, copySourceIds);
  return protectedIds;
}

function dependencyIdsReferencedOutsideClosure(
  objects: ReadonlyArray<SceneObject>,
  copySourceIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const object of objects) {
    if (copySourceIds.has(object.id)) continue;
    const dependencyId = sceneObjectCopyDependencyId(object);
    if (dependencyId !== undefined) referenced.add(dependencyId);
  }
  return referenced;
}

function copySourceIdsOnGroupBoundaries(
  groups: ReadonlyArray<SceneGroup>,
  copySourceIds: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    groups.flatMap((group) =>
      group.objectIds.every((id) => copySourceIds.has(id))
        ? []
        : group.objectIds.filter((id) => copySourceIds.has(id)),
    ),
  );
}

function expandProtectedIds(
  protectedIds: Set<string>,
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
  copySourceIds: ReadonlySet<string>,
): void {
  const objectsById = new Map(objects.map((object) => [object.id, object] as const));
  const groupsByMember = groupMembershipIndex(groups);
  const expandedGroups = new Set<SceneGroup>();
  const pending = [...protectedIds];
  for (const id of pending) {
    const object = objectsById.get(id);
    if (object === undefined) continue;
    addProtectedId(sceneObjectCopyDependencyId(object), protectedIds, pending, copySourceIds);
    for (const group of groupsByMember.get(id) ?? []) {
      if (expandedGroups.has(group)) continue;
      expandedGroups.add(group);
      for (const memberId of group.objectIds) {
        addProtectedId(memberId, protectedIds, pending, copySourceIds);
      }
    }
  }
}

function groupMembershipIndex(
  groups: ReadonlyArray<SceneGroup>,
): ReadonlyMap<string, ReadonlyArray<SceneGroup>> {
  const groupsByMember = new Map<string, SceneGroup[]>();
  for (const group of groups) {
    for (const memberId of group.objectIds) {
      const memberships = groupsByMember.get(memberId) ?? [];
      memberships.push(group);
      groupsByMember.set(memberId, memberships);
    }
  }
  return groupsByMember;
}

function addProtectedId(
  id: string | undefined,
  protectedIds: Set<string>,
  pending: string[],
  copySourceIds: ReadonlySet<string>,
): void {
  if (id === undefined || !copySourceIds.has(id) || protectedIds.has(id)) return;
  protectedIds.add(id);
  pending.push(id);
}
