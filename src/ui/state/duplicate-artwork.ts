import {
  addLayer,
  addObject,
  artworkOperationName,
  createArtworkOperation,
  remapSceneObjectOperationBindings,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../core/scene';

export function duplicateArtworkWithOperations(
  scene: Scene,
  original: SceneObject,
  id: string,
): { readonly scene: Scene; readonly object: SceneObject } {
  const rawClone = { ...original, id } as SceneObject;
  const sourceOperations = scene.layers.filter((operation) =>
    sceneObjectUsesOperation(original, operation),
  );
  if (sourceOperations.length === 0) {
    const created = createArtworkOperation(scene, rawClone);
    return {
      scene: addLayer(addObject(scene, created.object), created.operation),
      object: created.object,
    };
  }

  let nextScene = scene;
  const operationIdMap = new Map<string, string>();
  for (const source of sourceOperations) {
    const seed = createArtworkOperation(nextScene, rawClone, {
      mode: source.mode,
      name:
        sourceOperations.length === 1
          ? artworkOperationName(rawClone)
          : `${artworkOperationName(rawClone)} - ${source.name}`,
    }).operation;
    const operation: Layer = {
      ...source,
      ...(original.operationOverride ?? {}),
      id: seed.id,
      name: seed.name,
      color: seed.color,
      subLayers: [],
    };
    operationIdMap.set(source.id, operation.id);
    nextScene = addLayer(nextScene, operation);
  }
  const clone = remapSceneObjectOperationBindings(
    withoutOperationOverride(rawClone),
    sourceOperations,
    operationIdMap,
  );
  return { scene: addObject(nextScene, clone), object: clone };
}

function withoutOperationOverride(object: SceneObject): SceneObject {
  if (object.operationOverride === undefined) return object;
  const { operationOverride: _operationOverride, ...rest } = object;
  return rest as SceneObject;
}
