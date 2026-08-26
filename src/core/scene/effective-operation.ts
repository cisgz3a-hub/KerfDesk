import type { Layer } from './layer';
import type { SceneObject } from './scene-object';

/**
 * Single object-local operation resolver for editor, preview, compilation,
 * review, and output provenance. Missing fields inherit the bound operation.
 */
export function effectiveOperationForObject(layer: Layer, object: SceneObject): Layer {
  return object.operationOverride === undefined ? layer : { ...layer, ...object.operationOverride };
}
