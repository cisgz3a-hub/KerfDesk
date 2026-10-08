import {
  artworkOperationName,
  isRegistrationBox,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import {
  designNodeRanks,
  nodeOrderKey,
  sortDesignNodes,
  type DesignNodeRef,
} from '../../core/scene/design-hierarchy-order';

export type DesignTreeRow =
  | {
      readonly kind: 'group';
      readonly group: SceneGroup;
      readonly depth: number;
      readonly parentId: string | null;
    }
  | {
      readonly kind: 'object';
      readonly object: SceneObject;
      readonly depth: number;
      readonly parentId: string | null;
    };

/** Iterate rather than recurse; legacy overlapping memberships show each leaf once. */
export function designTreeRows(scene: Scene, focusId: string | null): ReadonlyArray<DesignTreeRow> {
  const groups = scene.groups ?? [];
  const ranks = designNodeRanks(scene);
  const children = new Map<string | undefined, SceneGroup[]>();
  for (const group of groups) {
    const entries = children.get(group.parentId) ?? [];
    entries.push(group);
    children.set(group.parentId, entries);
  }
  const objects = scene.objects.filter((object) => !isRegistrationBox(object));
  const roots = children.get(focusId ?? undefined) ?? [];
  const scope = focusId === null ? null : groups.find((group) => group.id === focusId);
  const memberIds = new Set(roots.flatMap((group) => group.objectIds));
  const pending: DesignTreeRow[] = sortDesignNodes(
    scene,
    [
      ...roots.map(
        (group): DesignTreeRow => ({ kind: 'group', group, depth: 0, parentId: focusId }),
      ),
      ...objects
        .filter((object) => !memberIds.has(object.id) && insideScope(object.id, scope))
        .map((object): DesignTreeRow => ({ kind: 'object', object, depth: 0, parentId: focusId })),
    ],
    designRowRef,
    ranks,
  ).reverse();
  const rows: DesignTreeRow[] = [],
    seenObjects = new Set<string>(),
    seenGroups = new Set<string>();
  const byId = new Map(objects.map((object) => [object.id, object]));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) continue;
    if (entry.kind === 'object') {
      if (!seenObjects.has(entry.object.id)) {
        seenObjects.add(entry.object.id);
        rows.push(entry);
      }
      continue;
    }
    if (seenGroups.has(entry.group.id)) continue;
    seenGroups.add(entry.group.id);
    rows.push(entry);
    pending.push(
      ...sortDesignNodes(
        scene,
        groupTreeChildren(entry, children, byId),
        designRowRef,
        ranks,
      ).reverse(),
    );
  }
  return rows;
}

function groupTreeChildren(
  entry: Extract<DesignTreeRow, { readonly kind: 'group' }>,
  children: ReadonlyMap<string | undefined, ReadonlyArray<SceneGroup>>,
  byId: ReadonlyMap<string, SceneObject>,
): DesignTreeRow[] {
  const nested = children.get(entry.group.id) ?? [];
  const nestedIds = new Set(nested.flatMap((group) => group.objectIds));
  const direct = entry.group.objectIds.flatMap((id): DesignTreeRow[] => {
    const object = byId.get(id);
    return object === undefined || nestedIds.has(id)
      ? []
      : [{ kind: 'object', object, depth: entry.depth + 1, parentId: entry.group.id }];
  });
  return [
    ...nested.map(
      (group): DesignTreeRow => ({
        kind: 'group',
        group,
        depth: entry.depth + 1,
        parentId: entry.group.id,
      }),
    ),
    ...direct,
  ];
}

export function designRowName(row: DesignTreeRow): string {
  return row.kind === 'group' ? row.group.name : artworkOperationName(row.object);
}
export function designRowId(row: DesignTreeRow): string {
  return row.kind === 'group' ? row.group.id : row.object.id;
}
export function designRowRef(row: DesignTreeRow): DesignNodeRef {
  return { kind: row.kind, id: designRowId(row) };
}
/** Reuse the already reviewed row topology instead of rescanning the scene for every drop edge. */
export function designRowSuccessors(
  rows: ReadonlyArray<DesignTreeRow>,
): ReadonlyMap<string, DesignNodeRef> {
  const last = new Map<string | null, DesignNodeRef>();
  const successors = new Map<string, DesignNodeRef>();
  for (const row of rows) {
    const ref = designRowRef(row),
      previous = last.get(row.parentId);
    if (previous !== undefined) successors.set(nodeOrderKey(previous), ref);
    last.set(row.parentId, ref);
  }
  return successors;
}

function insideScope(id: string, scope: SceneGroup | null | undefined): boolean {
  return scope === null || scope?.objectIds.includes(id) === true;
}
