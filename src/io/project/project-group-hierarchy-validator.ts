import {
  firstError,
  isObject,
  optionalString,
  requireString,
  validateArray,
} from './project-shape-primitives';

type Group = {
  readonly id: string;
  readonly parentId?: string;
  readonly objectIds: ReadonlyArray<string>;
};

/** Flat overlapping legacy groups remain valid; explicit parent links must be coherent. */
export function validateGroupHierarchy(values: ReadonlyArray<unknown>): string | null {
  const groups = values
    .filter(isObject)
    .filter(
      (value) => typeof value['id'] === 'string' && Array.isArray(value['objectIds']),
    ) as unknown as ReadonlyArray<Group>;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const members = new Map(groups.map((group) => [group.id, new Set(group.objectIds)]));
  const done = new Set<string>();
  for (const [index, group] of groups.entries()) {
    const path = `scene.groups[${index}].parentId`;
    if (group.parentId !== undefined) {
      const parent = members.get(group.parentId);
      if (parent === undefined) return `invalid \`${path}\`: dangling parent`;
      if (!group.objectIds.every((id) => parent.has(id)))
        return `invalid \`${path}\`: child artwork must belong to parent`;
    }
    const trail = new Set<string>();
    let cursor: Group | undefined = group;
    while (cursor !== undefined && !done.has(cursor.id)) {
      if (trail.has(cursor.id)) return `invalid \`${path}\`: cyclic group hierarchy`;
      trail.add(cursor.id);
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
    for (const id of trail) done.add(id);
  }
  return null;
}

export function optionalSceneGroups(scene: Record<string, unknown>, path: string): string | null {
  const groups = scene['groups'];
  if (groups === undefined) return null;
  if (!Array.isArray(groups)) return `missing or invalid \`${path}\``;
  return validateArray(groups, path, validateSceneGroup) ?? validateGroupHierarchy(groups);
}

function validateSceneGroup(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const objectIds = value['objectIds'];
  const fieldError = firstError([
    requireString(value, `${path}.id`),
    requireString(value, `${path}.name`),
    optionalString(value, `${path}.parentId`),
    Array.isArray(objectIds)
      ? validateArray(objectIds, `${path}.objectIds`, validateSceneGroupObjectId)
      : `missing or invalid \`${path}.objectIds\``,
  ]);
  if (fieldError !== null) return fieldError;
  return Array.isArray(objectIds) && objectIds.length >= 2
    ? null
    : `missing or invalid \`${path}.objectIds\``;
}

function validateSceneGroupObjectId(value: unknown, path: string): string | null {
  return typeof value === 'string' ? null : `missing or invalid \`${path}\``;
}
