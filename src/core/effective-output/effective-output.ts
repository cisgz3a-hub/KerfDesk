import { clamp } from '../math';
import type { Layer, ObjectPowerScale, SceneObject } from '../scene';

const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;
const DEFAULT_POWER_SCALE_PERCENT = 100;

/** Resolve object-local settings before power scaling is applied. */
export function effectiveOperationForObject(layer: Layer, object: SceneObject): Layer {
  return object.operationOverride === undefined ? layer : { ...layer, ...object.operationOverride };
}

export function objectPowerScalePercent(object: ObjectPowerScale): number {
  const scale = object.powerScale;
  if (scale === undefined || !Number.isFinite(scale)) return DEFAULT_POWER_SCALE_PERCENT;
  return clamp(scale, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
}

export function effectiveObjectPowerPercent(layer: Layer, object: ObjectPowerScale): number {
  const layerPower = clamp(layer.power, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
  return (layerPower * objectPowerScalePercent(object)) / MAX_POWER_SCALE_PERCENT;
}

export function effectiveObjectMinPowerPercent(layer: Layer, object: ObjectPowerScale): number {
  const layerPower = clamp(layer.power, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
  const minPower = clamp(layer.minPower, MIN_POWER_SCALE_PERCENT, layerPower);
  return (minPower * objectPowerScalePercent(object)) / MAX_POWER_SCALE_PERCENT;
}
