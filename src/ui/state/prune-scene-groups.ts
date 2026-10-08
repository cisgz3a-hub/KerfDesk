import type { SceneGroup } from '../../core/scene';

/** Retain live artwork, promote children past removed parents, and detach missing parents. */
export function groupsForObjectIds(
  groups: ReadonlyArray<SceneGroup>,
  live: ReadonlySet<string>,
): ReadonlyArray<SceneGroup> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const kept = groups
    .map((group) => ({ ...group, objectIds: group.objectIds.filter((id) => live.has(id)) }))
    .filter((group) => group.objectIds.length >= 2);
  return promoteGroupParents(kept, byId);
}

export function promoteGroupParents(
  kept: ReadonlyArray<SceneGroup>,
  originals: ReadonlyMap<string, SceneGroup>,
): ReadonlyArray<SceneGroup> {
  const liveGroups = new Set(kept.map((group) => group.id));
  return kept.map((group) => {
    const { parentId, ...root } = group;
    let parent = parentId;
    const seen = new Set<string>();
    while (parent !== undefined && !liveGroups.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = originals.get(parent)?.parentId;
    }
    return parent === undefined || seen.has(parent) ? root : { ...root, parentId: parent };
  });
}

/** Compatibility name for existing scene-deletion callers. */
export const pruneSceneGroups = groupsForObjectIds;
