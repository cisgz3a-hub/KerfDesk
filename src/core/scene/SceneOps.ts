/**
 * === FILE: /src/core/scene/SceneOps.ts ===
 *
 * Purpose:    Pure functions that produce new Scene instances from
 *             existing ones. Every function is immutable — returns
 *             a new Scene, never mutates the input.
 *
 *             These are the building blocks for undo/redo (each call
 *             produces a snapshot) and for UI event handlers that
 *             need to update the scene in response to user actions.
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 * Last updated: Drag-to-move feature
 */

import { type Point, type Matrix3x2, IDENTITY_MATRIX, generateId } from '../types';
import { type Scene } from './Scene';
import { type SceneObject } from './SceneObject';

export type ParentGraphViolationKind =
  | 'missing-parent'
  | 'parent-not-group'
  | 'parent-cycle';

export interface ParentGraphViolation {
  kind: ParentGraphViolationKind;
  objectId: string;
  parentId: string | null;
  path: string[];
}

export interface ParentGraphRepairResult {
  scene: Scene;
  violations: ParentGraphViolation[];
  repairedCount: number;
}

export interface GroupObjectsOptions {
  groupId?: string;
  name?: string;
}

function touchScene(scene: Scene, objects: SceneObject[]): Scene {
  return {
    ...scene,
    objects,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every(value => value === first) ? first : null;
}

function makeGroupObject(
  scene: Scene,
  selected: readonly SceneObject[],
  options?: GroupObjectsOptions,
): SceneObject {
  const commonLayerId = commonValue(selected.map(obj => obj.layerId));
  const commonParentId = commonValue(selected.map(obj => obj.parentId));
  const layerId =
    commonLayerId ??
    (scene.layers.some(layer => layer.id === scene.activeLayerId)
      ? scene.activeLayerId
      : (selected[0]?.layerId ?? scene.layers[0]?.id ?? ''));

  return {
    id: options?.groupId ?? generateId(),
    type: 'group',
    name: options?.name ?? 'Group',
    layerId,
    parentId: commonParentId,
    transform: { ...IDENTITY_MATRIX },
    // Structural marker only: group membership is stored by child parentId.
    geometry: { type: 'path', subPaths: [] },
    visible: false,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

// GROUP / PARENT GRAPH

export function validateParentGraph(scene: Scene): ParentGraphViolation[] {
  const byId = new Map(scene.objects.map(obj => [obj.id, obj]));
  const violations: ParentGraphViolation[] = [];

  for (const obj of scene.objects) {
    if (!obj.parentId) continue;
    const parent = byId.get(obj.parentId);
    if (!parent) {
      violations.push({
        kind: 'missing-parent',
        objectId: obj.id,
        parentId: obj.parentId,
        path: [obj.id, obj.parentId],
      });
      continue;
    }
    if (parent.type !== 'group') {
      violations.push({
        kind: 'parent-not-group',
        objectId: obj.id,
        parentId: obj.parentId,
        path: [obj.id, obj.parentId],
      });
      continue;
    }

    const path: string[] = [obj.id];
    const seen = new Set<string>([obj.id]);
    let cursor: SceneObject | undefined = parent;
    while (cursor) {
      path.push(cursor.id);
      if (seen.has(cursor.id)) {
        violations.push({
          kind: 'parent-cycle',
          objectId: obj.id,
          parentId: obj.parentId,
          path: [...path],
        });
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }

  return violations;
}

export function repairParentGraph(scene: Scene): ParentGraphRepairResult {
  const violations = validateParentGraph(scene);
  if (violations.length === 0) {
    return { scene, violations, repairedCount: 0 };
  }

  const invalidObjectIds = new Set(violations.map(v => v.objectId));
  let repairedCount = 0;
  const objects = scene.objects.map(obj => {
    if (!invalidObjectIds.has(obj.id) || obj.parentId == null) return obj;
    repairedCount++;
    return { ...obj, parentId: null, _bounds: null, _worldTransform: null };
  });

  const repairedScene = repairedCount > 0 ? touchScene(scene, objects) : scene;
  const remaining = validateParentGraph(repairedScene);
  if (remaining.length > 0) {
    console.warn('[LaserForge] T3-79 parent graph still has violations after repair', remaining);
  } else {
    console.warn('[LaserForge] T3-79 repaired parent graph violations', violations);
  }
  return { scene: repairedScene, violations, repairedCount };
}

export function groupObjects(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  options?: GroupObjectsOptions,
): Scene {
  const existingIds = new Set(scene.objects.map(obj => obj.id));
  const selected = scene.objects.filter(obj => objectIds.has(obj.id));
  if (selected.length < 2) return scene;
  if (options?.groupId && existingIds.has(options.groupId)) return scene;

  const group = makeGroupObject(scene, selected, options);
  const objects = scene.objects.map(obj =>
    objectIds.has(obj.id)
      ? { ...obj, parentId: group.id, _bounds: null, _worldTransform: null }
      : obj,
  );
  return repairParentGraph(touchScene(scene, [...objects, group])).scene;
}

export function ungroupObjects(
  scene: Scene,
  groupIds: ReadonlySet<string>,
): Scene {
  const groups = new Map(
    scene.objects
      .filter(obj => groupIds.has(obj.id) && obj.type === 'group')
      .map(obj => [obj.id, obj]),
  );
  if (groups.size === 0) return scene;

  const replacementParentFor = (groupId: string): string | null => {
    let cursor = groups.get(groupId)?.parentId ?? null;
    const seen = new Set<string>([groupId]);
    while (cursor && groups.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = groups.get(cursor)?.parentId ?? null;
    }
    return cursor;
  };

  const objects = scene.objects
    .filter(obj => !groups.has(obj.id))
    .map(obj => {
      if (!obj.parentId || !groups.has(obj.parentId)) return obj;
      return {
        ...obj,
        parentId: replacementParentFor(obj.parentId),
        _bounds: null,
        _worldTransform: null,
      };
    });

  return repairParentGraph(touchScene(scene, objects)).scene;
}

export function remapClonedParentIds<T extends SceneObject>(
  clones: readonly T[],
  oldToNewId: ReadonlyMap<string, string>,
): T[] {
  const clonedIds = new Set(clones.map(obj => obj.id));
  return clones.map(obj => {
    if (!obj.parentId) return obj;
    const mappedParentId = oldToNewId.get(obj.parentId);
    const parentId = mappedParentId && clonedIds.has(mappedParentId) ? mappedParentId : null;
    return parentId === obj.parentId ? obj : { ...obj, parentId, _bounds: null, _worldTransform: null };
  });
}

// ─── MOVE ────────────────────────────────────────────────────────

/**
 * Translate selected objects by a world-space delta.
 * Returns a new Scene with updated transform matrices.
 *
 * Only modifies transform.tx and transform.ty — preserves
 * rotation, scale, and skew. Does not touch geometry data.
 */
export function moveObjects(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  dx: number,
  dy: number
): Scene {
  if (objectIds.size === 0 || (dx === 0 && dy === 0)) return scene;

  const newObjects = scene.objects.map(obj => {
    if (!objectIds.has(obj.id)) return obj;

    return {
      ...obj,
      transform: {
        ...obj.transform,
        tx: obj.transform.tx + dx,
        ty: obj.transform.ty + dy,
      },
      // Invalidate cached bounds
      _bounds: null,
      _worldTransform: null,
    };
  });

  return {
    ...scene,
    objects: newObjects,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

// ─── DELETE ──────────────────────────────────────────────────────

/**
 * Remove objects by ID. Returns new Scene without those objects.
 */
export function deleteObjects(
  scene: Scene,
  objectIds: ReadonlySet<string>
): Scene {
  if (objectIds.size === 0) return scene;

  return {
    ...scene,
    objects: scene.objects.filter(obj => !objectIds.has(obj.id)),
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

// ─── DUPLICATE ───────────────────────────────────────────────────

/**
 * Duplicate objects with a positional offset.
 * Returns new Scene with clones added and selected.
 */
export function duplicateObjects(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  offsetX: number = 10,
  offsetY: number = 10
): Scene {
  if (objectIds.size === 0) return scene;

  const clones: SceneObject[] = [];
  const oldToNewId = new Map<string, string>();

  for (const obj of scene.objects) {
    if (!objectIds.has(obj.id)) continue;

    const cloneId = `${obj.id}-copy-${generateId()}`;
    oldToNewId.set(obj.id, cloneId);
    clones.push({
      ...obj,
      id: cloneId,
      name: `${obj.name} (copy)`,
      transform: {
        ...obj.transform,
        tx: obj.transform.tx + offsetX,
        ty: obj.transform.ty + offsetY,
      },
      _bounds: null,
      _worldTransform: null,
    });
  }

  return {
    ...scene,
    objects: [...scene.objects, ...remapClonedParentIds(clones, oldToNewId)],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

// ─── REORDER ─────────────────────────────────────────────────────

/**
 * Move objects to a different layer.
 */
export function moveToLayer(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  targetLayerId: string
): Scene {
  if (objectIds.size === 0) return scene;
  if (!scene.layers.some(l => l.id === targetLayerId)) return scene;

  return {
    ...scene,
    objects: scene.objects.map(obj =>
      objectIds.has(obj.id)
        ? { ...obj, layerId: targetLayerId }
        : obj
    ),
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}
