import type { Scene } from './scene';
import type { ColoredPath, SceneObject } from './scene-object';

type LayerVisibility = { readonly visible: boolean };

export function sceneObjectHasVisibleLayer(scene: Scene, object: SceneObject): boolean {
  const lookup = new Map<string, LayerVisibility>();
  for (const operation of scene.layers) {
    lookup.set(operation.id, operation);
    if (!lookup.has(operation.color)) lookup.set(operation.color, operation);
  }
  return sceneObjectHasVisibleLayerFromMap(object, lookup);
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
  return paths.some((path) => {
    const operationIds = path.operationIds ?? objectOperationIds;
    return operationIds === undefined
      ? operationLookup.get(path.color)?.visible !== false
      : hasVisibleOperation(operationIds, operationLookup);
  });
}

function hasVisibleOperation(
  operationIds: ReadonlyArray<string>,
  operationLookup: ReadonlyMap<string, LayerVisibility>,
): boolean {
  return operationIds.some((id) => operationLookup.get(id)?.visible !== false);
}
