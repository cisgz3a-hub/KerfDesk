import { clamp } from '../math';
import type { Layer, ObjectPowerScale, SceneObject } from '../scene';
import type { ObjectOperationSettingsOverride } from '../scene/scene-object';
import { projectObjectOperationSettings } from '../scene/object-operation-settings';

const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;
const DEFAULT_POWER_SCALE_PERCENT = 100;

/** Resolve object-local settings before power scaling is applied. */
export function effectiveOperationForObject(
  layer: Layer,
  object: Pick<SceneObject, 'operationOverride'>,
): Layer {
  const override = operationOverrideForObject(layer, object);
  return override === undefined ? layer : { ...layer, ...override };
}

export function operationOverrideForObject(
  layer: Pick<Layer, 'id' | 'bindingOperationId'>,
  object: Pick<SceneObject, 'operationOverride'>,
): ObjectOperationSettingsOverride | undefined {
  const override = object.operationOverride;
  if (override === undefined) return undefined;
  if (override.byOperation === undefined) return recognizedSettings(override);
  // A materialized sub-operation can own its settings independently. Otherwise
  // it follows the parent artwork scope, matching legacy global inheritance.
  for (const id of [layer.id, layer.bindingOperationId]) {
    if (id !== undefined && Object.hasOwn(override.byOperation, id))
      return recognizedSettings(override.byOperation[id]);
  }
  return recognizedSettings(override);
}

function recognizedSettings(
  value: Readonly<Record<string, unknown>> | null | undefined,
): ObjectOperationSettingsOverride | undefined {
  if (value == null) return undefined;
  const settings = projectObjectOperationSettings(value);
  return Object.keys(settings).length === 0 ? undefined : settings;
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
