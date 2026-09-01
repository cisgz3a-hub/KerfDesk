import type { Scene } from './scene';
import type { ColoredPath, SceneObject } from './scene-object';

type LayerVisibility = { readonly visible: boolean };

export type VisibleOperationResolution<T extends LayerVisibility> = {
  readonly visible: boolean;
  readonly operation: T | undefined;
};

export function sceneObjectHasVisibleLayer(scene: Scene, object: SceneObject): boolean {
  return sceneObjectHasVisibleLayerFromMap(object, sceneLayerVisibilityLookup(scene.layers));
}

/**
 * Build the canonical operation lookup used by canvas visibility consumers.
 * Persisted operation ids take precedence; the first matching color remains a
 * compatibility alias for projects saved before per-path operation bindings.
 */
export function sceneLayerVisibilityLookup<
  T extends LayerVisibility & { readonly id: string; readonly color: string },
>(layers: ReadonlyArray<T>): Map<string, T> {
  const lookup = new Map<string, T>();
  for (const layer of layers) {
    lookup.set(layer.id, layer);
    if (!lookup.has(layer.color)) lookup.set(layer.color, layer);
  }
  return lookup;
}

export function sceneObjectHasVisibleLayerFromMap(
  object: SceneObject,
  operationLookup: ReadonlyMap<string, LayerVisibility>,
): boolean {
  if ('paths' in object) {
    if (object.paths.length === 0) {
      const operationIds = object.operationIds;
      if (operationIds !== undefined) return hasVisibleOperation(operationIds, operationLookup);
      return 'color' in object ? operationLookup.get(object.color)?.visible !== false : true;
    }
    return hasVisiblePath(object.paths, object.operationIds, operationLookup);
  }
  if (object.operationIds !== undefined) {
    return hasVisibleOperation(object.operationIds, operationLookup);
  }
  return operationLookup.get(object.color)?.visible !== false;
}

function hasVisiblePath(
  paths: ReadonlyArray<ColoredPath>,
  objectOperationIds: ReadonlyArray<string> | undefined,
  operationLookup: ReadonlyMap<string, LayerVisibility>,
): boolean {
  const object = { operationIds: objectOperationIds };
  return paths.some(
    (path) => resolveVisibleOperationForPath(object, path, operationLookup).visible,
  );
}

/**
 * Resolve a path through every bound operation in persisted order. The first
 * visible operation supplies deterministic canvas styling; unknown/orphaned
 * bindings remain fail-visible without inventing operation settings.
 */
export function resolveVisibleOperationForPath<T extends LayerVisibility>(
  object: { readonly operationIds?: ReadonlyArray<string> | undefined },
  path: Pick<ColoredPath, 'color' | 'operationIds'>,
  operationLookup: ReadonlyMap<string, T>,
): VisibleOperationResolution<T> {
  const operationIds = path.operationIds ?? object.operationIds;
  if (operationIds === undefined) {
    const operation = operationLookup.get(path.color);
    return { visible: operation?.visible !== false, operation };
  }
  let hasUnknownBinding = false;
  for (const id of operationIds) {
    const operation = operationLookup.get(id);
    if (operation === undefined) {
      hasUnknownBinding = true;
      continue;
    }
    if (operation.visible) return { visible: true, operation };
  }
  return { visible: hasUnknownBinding, operation: undefined };
}

/** Canonical cached visibility API for canvas consumers outside the Scene module. */
export const sceneLayerVisibility = {
  lookup: sceneLayerVisibilityLookup,
  hasObject: sceneObjectHasVisibleLayerFromMap,
  resolvePath: resolveVisibleOperationForPath,
} as const;

function hasVisibleOperation(
  operationIds: ReadonlyArray<string>,
  operationLookup: ReadonlyMap<string, LayerVisibility>,
): boolean {
  return operationIds.some((id) => operationLookup.get(id)?.visible !== false);
}
