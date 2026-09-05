import {
  appendSceneObjectOperationBinding,
  artworkOperationName,
  createArtworkOperation,
  replaceSceneObjectOperationBinding,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
} from '../../core/scene';
import { layerSubLayerOperationId } from '../../core/scene/layer';
import { operationOverrideForObject } from '../../core/effective-output';

/** Copy only the requested operation. Existing bindings retain their identity,
 * including the compound geometry shared by CNC pockets and inlays. */
export function cloneArtworkOperations(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  source: Layer,
  additive: boolean,
): Scene {
  const targets = scene.objects.filter(
    (object) => objectIds.has(object.id) && (additive || sceneObjectUsesOperation(object, source)),
  );
  const first = targets[0];
  if (first === undefined) return scene;
  const seed = createArtworkOperation(scene, first, {
    name: additive ? `${source.name} 2` : artworkOperationName(first),
    subLayers: source.subLayers,
  }).operation;
  const operation: Layer = {
    ...source,
    id: seed.id,
    name: seed.name,
    color: seed.color,
    subLayers: seed.subLayers,
  };
  const targetIds = new Set(targets.map((object) => object.id));
  const subOperationIds = source.subLayers.map(
    (sub) =>
      [
        layerSubLayerOperationId(source.id, sub.id),
        layerSubLayerOperationId(operation.id, sub.id),
      ] as const,
  );
  const objects = scene.objects.map((object) => {
    if (!targetIds.has(object.id)) return object;
    const next = additive
      ? appendSceneObjectOperationBinding(object, operation.id, scene.layers)
      : replaceSceneObjectOperationBinding(object, source.id, operation.id, scene.layers);
    const copiedScopes = Object.fromEntries(
      subOperationIds.flatMap(([from, to]) => {
        const settings = object.operationOverride?.byOperation?.[from];
        return settings === undefined ? [] : [[to, settings]];
      }),
    );
    return {
      ...next,
      operationOverride: {
        ...next.operationOverride,
        byOperation: {
          ...next.operationOverride?.byOperation,
          ...copiedScopes,
          [operation.id]: operationOverrideForObject(source, object) ?? null,
        },
      },
    };
  });
  return { ...scene, objects, layers: [...scene.layers, operation] };
}
