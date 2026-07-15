import type { DeviceProfile } from '../devices';
import type { Layer, SceneObject } from '../scene';
import type { CutGroup } from './job';
import { effectiveObjectPowerPercent } from './object-power-scale';

type VectorPowerSource = SceneObject | { readonly powerScale: number };

export function commonVectorGroupFields(
  layer: Layer,
  device: DeviceProfile,
  powerSource: VectorPowerSource,
  sourceObjectId?: string,
): Omit<CutGroup, 'kind' | 'segments'> {
  const priorityObjectId = sourceObjectId ?? ('id' in powerSource ? powerSource.id : undefined);
  return {
    layerId: layer.id,
    ...(priorityObjectId === undefined ? {} : { sourceObjectId: priorityObjectId }),
    color: layer.color,
    power: effectiveObjectPowerPercent(layer, powerSource),
    ...(layer.powerMode !== undefined ? { powerMode: layer.powerMode } : {}),
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
  };
}
