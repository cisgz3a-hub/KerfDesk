import type { DeviceProfile } from '../devices';
import { sceneObjectUsesOperation, type Layer, type SceneObject } from '../scene';
import type { HatchFillRule } from './fill-hatching';

export function fillRuleForLayer(objects: ReadonlyArray<SceneObject>, layer: Layer): HatchFillRule {
  return objects.some((obj) => textObjectMatchesLayer(obj, layer)) ? 'nonzero' : 'evenodd';
}

function textObjectMatchesLayer(obj: SceneObject, layer: Layer): boolean {
  return obj.kind === 'text' && sceneObjectUsesOperation(obj, layer);
}

export function layerFillCacheKey(
  layer: Layer,
  device: DeviceProfile,
  fillRule: HatchFillRule,
): string {
  return [
    layer.color,
    layer.hatchAngleDeg,
    layer.hatchSpacingMm,
    layer.fillBidirectional,
    layer.fillCrossHatch,
    layer.fillStyle,
    fillRule,
    device.origin,
    device.bedWidth,
    device.bedHeight,
  ].join(':');
}
