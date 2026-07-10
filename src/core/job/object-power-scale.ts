import type { Layer, ObjectPowerScale } from '../scene';
import { clamp } from '../math';

const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;
const DEFAULT_POWER_SCALE_PERCENT = 100;

/**
 * Returns a bounded LightBurn-style object power scale percentage.
 */
export function objectPowerScalePercent(object: ObjectPowerScale): number {
  const scale = object.powerScale;
  if (scale === undefined || !Number.isFinite(scale)) return DEFAULT_POWER_SCALE_PERCENT;
  return clamp(scale, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
}

/**
 * Applies an object's power scale to the layer max power percentage.
 */
export function effectiveObjectPowerPercent(layer: Layer, object: ObjectPowerScale): number {
  const layerPower = clamp(layer.power, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
  return (layerPower * objectPowerScalePercent(object)) / MAX_POWER_SCALE_PERCENT;
}

/**
 * Applies an object's power scale to the layer min power percentage.
 */
export function effectiveObjectMinPowerPercent(layer: Layer, object: ObjectPowerScale): number {
  const layerPower = clamp(layer.power, MIN_POWER_SCALE_PERCENT, MAX_POWER_SCALE_PERCENT);
  const minPower = clamp(layer.minPower, MIN_POWER_SCALE_PERCENT, layerPower);
  return (minPower * objectPowerScalePercent(object)) / MAX_POWER_SCALE_PERCENT;
}
