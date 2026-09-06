import type { DeviceProfile } from '../devices';
import type { Layer } from '../scene';

export function layerFillCacheKey(layer: Layer, device: DeviceProfile): string {
  return [
    layer.bindingOperationId ?? layer.id,
    layer.color,
    layer.hatchAngleDeg,
    layer.hatchSpacingMm,
    layer.fillBidirectional,
    layer.fillCrossHatch,
    layer.fillStyle,
    device.origin,
    device.bedWidth,
    device.bedHeight,
  ].join(':');
}
