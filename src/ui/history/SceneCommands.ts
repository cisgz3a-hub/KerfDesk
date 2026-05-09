/**
 * === FILE: /src/ui/history/SceneCommands.ts ===
 *
 * Purpose:    Pure command functions for all Scene mutations.
 *             Each function takes a Scene + arguments, returns a new Scene.
 *             No mutation, no side effects.
 *
 *             These are designed to pair with HistoryManager:
 *               const newScene = addObject(scene, obj);
 *               history.push(newScene);
 *
 *             Re-exports SceneOps for convenience (moveObjects,
 *             deleteObjects, duplicateObjects, moveToLayer).
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/SceneOps.ts
 * Last updated: Undo/Redo feature
 */

import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type Geometry } from '../../core/scene/SceneObject';
import { type Matrix3x2 } from '../../core/types';

// Re-export existing SceneOps commands
export {
  moveObjects,
  deleteObjects,
  duplicateObjects,
  moveToLayer,
  groupObjects,
  ungroupObjects,
  validateParentGraph,
  repairParentGraph,
} from '../../core/scene/SceneOps';

// ─── ADD OBJECT ──────────────────────────────────────────────────

/**
 * Add one or more objects to the scene.
 */
export function addObjects(
  scene: Scene,
  objects: SceneObject[]
): Scene {
  if (objects.length === 0) return scene;

  return {
    ...scene,
    objects: [...scene.objects, ...objects],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Add a single object to the scene.
 */
export function addObject(
  scene: Scene,
  object: SceneObject
): Scene {
  return addObjects(scene, [object]);
}

// ─── UPDATE OBJECT ───────────────────────────────────────────────

/**
 * Update properties of a single object by ID.
 * Only the provided fields are overwritten (shallow merge).
 */
export function updateObject(
  scene: Scene,
  objectId: string,
  updates: Partial<Pick<SceneObject, 'name' | 'layerId' | 'visible' | 'locked' | 'transform' | 'geometry' | 'powerScale'>>
): Scene {
  let found = false;

  const newObjects = scene.objects.map(obj => {
    if (obj.id !== objectId) return obj; // Structural sharing: unchanged objects keep same reference
    found = true;
    return {
      ...obj,
      ...updates,
      _bounds: null,         // Invalidate cached bounds
      _worldTransform: null,
    };
  });

  if (!found) return scene; // No matching object — return unchanged

  return {
    ...scene,
    objects: newObjects,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Update the geometry of an object.
 */
export function updateGeometry(
  scene: Scene,
  objectId: string,
  geometry: Geometry
): Scene {
  return updateObject(scene, objectId, { geometry });
}

/**
 * Update the transform of an object.
 */
export function updateTransform(
  scene: Scene,
  objectId: string,
  transform: Matrix3x2
): Scene {
  return updateObject(scene, objectId, { transform });
}

// ─── LAYER OPERATIONS ────────────────────────────────────────────

/**
 * Add a new layer to the scene.
 */
export function addLayer(
  scene: Scene,
  layer: import('../../core/scene/Layer').Layer
): Scene {
  return {
    ...scene,
    layers: [...scene.layers, layer],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Remove a layer and all its objects.
 */
export function removeLayer(
  scene: Scene,
  layerId: string
): Scene {
  if (scene.layers.length <= 1) return scene; // Can't remove the last layer

  return {
    ...scene,
    layers: scene.layers.filter(l => l.id !== layerId),
    objects: scene.objects.filter(o => o.layerId !== layerId),
    activeLayerId: scene.activeLayerId === layerId
      ? scene.layers.find(l => l.id !== layerId)!.id
      : scene.activeLayerId,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Reorder objects within the scene (change z-order).
 * Moves objects to the given index in the objects array.
 */
export function reorderObjects(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  targetIndex: number
): Scene {
  if (objectIds.size === 0) return scene;

  const moving = scene.objects.filter(o => objectIds.has(o.id));
  const remaining = scene.objects.filter(o => !objectIds.has(o.id));

  const clamped = Math.max(0, Math.min(remaining.length, targetIndex));
  const newObjects = [
    ...remaining.slice(0, clamped),
    ...moving,
    ...remaining.slice(clamped),
  ];

  return {
    ...scene,
    objects: newObjects,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}
