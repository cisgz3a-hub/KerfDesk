import type { SceneGroup } from '../../core/scene';

/** Clone complete groups together and remap parents only within this copy. */
export function cloneSelectionGroups(
  groups: ReadonlyArray<SceneGroup>,
  selected: ReadonlySet<string>,
  copied: ReadonlyMap<string, string>,
  newId: () => string,
): SceneGroup[] {
  const complete = groups.filter(
    (group) =>
      group.objectIds.length >= 2 &&
      group.objectIds.every((id) => selected.has(id) && copied.has(id)),
  );
  const groupIds = new Map(complete.map((group) => [group.id, newId()]));
  return complete.map((group) => {
    const { parentId, ...withoutParent } = group;
    const mappedParent = parentId === undefined ? undefined : groupIds.get(parentId);
    return {
      ...withoutParent,
      id: groupIds.get(group.id) ?? newId(),
      objectIds: group.objectIds.flatMap((id) => {
        const mapped = copied.get(id);
        return mapped === undefined ? [] : [mapped];
      }),
      ...(mappedParent === undefined ? {} : { parentId: mappedParent }),
    };
  });
}
