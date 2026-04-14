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

import { type Point, type Matrix3x2 } from '../types';
import { type Scene } from './Scene';
import { type SceneObject } from './SceneObject';

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

  for (const obj of scene.objects) {
    if (!objectIds.has(obj.id)) continue;

    const cloneId = `${obj.id}-copy-${Date.now().toString(36)}`;
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
    objects: [...scene.objects, ...clones],
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
