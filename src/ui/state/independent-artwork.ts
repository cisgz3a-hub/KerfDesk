// A derived object (a Boolean result, an offset, a rubber-band outline) gets
// its own operation cloned from a source's, so a later change to either one
// leaves the other alone (ADR-103 behaviour).

import { effectiveOperationForObject } from '../../core/effective-output';
import {
  addLayer,
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  primaryOperationForObject,
  type ImportedSvg,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../core/scene';

/** Adds an operation cloned from the source object's first operation. */
export function prepareIndependentArtwork(
  scene: Scene,
  artwork: ImportedSvg,
  source: SceneObject | undefined,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const sourceOperation =
    source === undefined ? null : primaryOperationForObject(source, scene.layers);
  return prepareIndependentArtworkOn(scene, artwork, sourceOperation);
}

/** Adds an operation cloned from `sourceOperation`, or a fresh one when null. */
export function prepareIndependentArtworkOn(
  scene: Scene,
  artwork: ImportedSvg,
  sourceOperation: Layer | null,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const seed = createArtworkOperation(scene, artwork, {
    subLayers: sourceOperation?.subLayers ?? [],
  });
  const operation: Layer =
    sourceOperation === null
      ? seed.operation
      : independentOperationForArtwork(sourceOperation, seed.operation, artwork);
  return {
    scene: addLayer(scene, operation),
    object: seed.object as ImportedSvg,
  };
}

function independentOperationForArtwork(source: Layer, seed: Layer, artwork: ImportedSvg): Layer {
  const effectiveRoot = effectiveOperationForObject(source, artwork);
  const subLayers = source.subLayers.map((subLayer) => ({
    ...subLayer,
    settings: captureLayerOperationSettings(
      effectiveOperationForObject(layerFromSubLayer(source, subLayer), artwork),
    ),
  }));
  const { bindingOperationId: _bindingOperationId, ...withoutRuntimeBinding } = effectiveRoot;
  const cloned: Layer = {
    ...withoutRuntimeBinding,
    id: seed.id,
    name: seed.name,
    color: seed.color,
    subLayers,
  };
  if (artwork.operationOverride === undefined) return cloned;
  // The override is materialized into the root and every sublayer, so a later
  // linked-preset refresh must not silently erase the derived artwork's output.
  const { materialBinding: _materialBinding, ...detached } = cloned;
  return detached;
}
