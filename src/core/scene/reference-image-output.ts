// ADR-673: a camera capture kept after Trace is a picture of the bed, a
// placement reference like the LightBurn camera overlay, never artwork to burn.
// It stays an ordinary scene object, but the Image operations it burns with are
// left with Output off, so it shows without engraving until the operator turns
// that on. An operation another object also uses keeps its Output: the capture
// moves onto an output-off copy of it instead, so no other artwork stops.

import { createArtworkOperation } from './artwork-operation';
import { cloneLayerSubLayers, type Layer } from './layer';
import {
  operationIdsForObject,
  remapSceneObjectOperationBindings,
  sceneObjectUsesOperation,
} from './operation-binding';
import { addLayer, replaceObject, type Scene } from './scene';

/** The source name Trace from Camera gives the bed picture it captures. */
export const CAMERA_CAPTURE_SOURCE = 'camera capture';

export function withImageOutputOff(scene: Scene, imageId: string): Scene {
  const image = scene.objects.find((object) => object.id === imageId);
  if (image === undefined) return scene;
  const operations = scene.layers.filter((layer) =>
    operationIdsForObject(image, scene.layers).includes(layer.id),
  );
  if (operations.length === 0) return scene;
  let working = scene;
  const binding = new Map<string, string>();
  const turnOff = new Set<string>();
  for (const operation of operations) {
    if (!sharedWithOtherArtwork(scene, imageId, operation)) {
      binding.set(operation.id, operation.id);
      turnOff.add(operation.id);
      continue;
    }
    const created = createArtworkOperation(working, image, { subLayers: operation.subLayers });
    working = addLayer(working, {
      ...operation,
      id: created.operation.id,
      name: created.operation.name,
      color: created.operation.color,
      subLayers: cloneLayerSubLayers(operation.subLayers),
      output: false,
    });
    binding.set(operation.id, created.operation.id);
  }
  const layers = working.layers.map((layer) =>
    turnOff.has(layer.id) ? { ...layer, output: false } : layer,
  );
  const rebound = remapSceneObjectOperationBindings(image, operations, binding);
  return replaceObject({ ...working, layers }, imageId, rebound);
}

function sharedWithOtherArtwork(scene: Scene, imageId: string, operation: Layer): boolean {
  return scene.objects.some(
    (object) => object.id !== imageId && sceneObjectUsesOperation(object, operation),
  );
}
