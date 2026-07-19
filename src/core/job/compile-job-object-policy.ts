import type { Layer, SceneObject } from '../scene';
import { objectPowerScalePercent } from './object-power-scale';

export function layerWithObjectOverride(layer: Layer, object: SceneObject): Layer {
  return object.operationOverride === undefined ? layer : { ...layer, ...object.operationOverride };
}

export function sharedObjectPowerScalePercent(
  objects: ReadonlyArray<SceneObject>,
): number | undefined {
  let sharedScale: number | undefined;
  for (const object of objects) {
    const scale = objectPowerScalePercent(object);
    if (sharedScale === undefined) sharedScale = scale;
    else if (sharedScale !== scale) return undefined;
  }
  return sharedScale;
}
