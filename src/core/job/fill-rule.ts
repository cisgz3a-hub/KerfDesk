import type { DeviceProfile } from '../devices';
import type { Layer, SceneObject } from '../scene';
import type { HatchFillRule } from './fill-hatching';

export function fillRuleForLayer(objects: ReadonlyArray<SceneObject>, layer: Layer): HatchFillRule {
  void objects;
  void layer;
  // Text geometry is resolved per object under non-zero semantics before the
  // layer is pooled. The pooled layer must remain even-odd so one text object
  // cannot alter unrelated SVG/shape donut topology (ADR-286 and the ADR-270
  // amendment).
  return 'evenodd';
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
