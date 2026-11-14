// ADR-673: a camera capture kept after Trace is a picture of the bed, a
// placement reference like the LightBurn camera overlay, never artwork to burn.
// It stays an ordinary scene object, but the Image operations it burns with are
// left with Output off, so it shows without engraving until the operator turns
// that on. An operation another object also uses keeps its Output: the capture
// moves onto an output-off copy of it instead, so no other artwork stops.
// ADR-570 Amendment 3 does the same for a stamp's source artwork, a whole
// selection at once.

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
  return withObjectsOutputOff(scene, [imageId]);
}

/**
 * Keep these objects but stop them burning. An operation only they use has
 * its Output turned off; an operation other artwork also uses is copied once,
 * with Output off, and these objects move to the copy, so the other artwork
 * keeps burning (ADR-570 Amendment 3 for Prepare Stamp's sources).
 */
export function withObjectsOutputOff(
  scene: Scene,
  objectIds: ReadonlyArray<string>,
  options: { readonly copyName?: (operation: Layer) => string } = {},
): Scene {
  const ids = new Set(objectIds);
  const objects = scene.objects.filter((object) => ids.has(object.id));
  const operations = scene.layers.filter((layer) =>
    objects.some((object) => operationIdsForObject(object, scene.layers).includes(layer.id)),
  );
  if (operations.length === 0) return scene;
  let working = scene;
  const binding = new Map<string, string>();
  const turnOff = new Set<string>();
  for (const operation of operations) {
    if (!sharedWithOtherArtwork(scene, ids, operation)) {
      binding.set(operation.id, operation.id);
      turnOff.add(operation.id);
      continue;
    }
    const owner = objects.find((object) => sceneObjectUsesOperation(object, operation));
    if (owner === undefined) continue;
    const copyName = options.copyName?.(operation);
    const created = createArtworkOperation(working, owner, {
      subLayers: operation.subLayers,
      ...(copyName === undefined ? {} : { name: copyName }),
    });
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
  working = { ...working, layers };
  for (const object of objects) {
    const used = operations.filter((operation) => sceneObjectUsesOperation(object, operation));
    if (used.length === 0) continue;
    const rebound = remapSceneObjectOperationBindings(object, used, binding);
    working = replaceObject(working, object.id, rebound);
  }
  return working;
}

function sharedWithOtherArtwork(scene: Scene, ids: ReadonlySet<string>, operation: Layer): boolean {
  return scene.objects.some(
    (object) => !ids.has(object.id) && sceneObjectUsesOperation(object, operation),
  );
}
