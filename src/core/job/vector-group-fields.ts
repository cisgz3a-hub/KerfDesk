import type { DeviceProfile } from '../devices';
import { captureLayerOperationSettings, type Layer, type SceneObject } from '../scene';
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
  const speed = Math.min(layer.speed, device.maxFeed);
  return {
    layerId: layer.id,
    ...(priorityObjectId === undefined ? {} : { sourceObjectId: priorityObjectId }),
    color: layer.color,
    power: effectiveObjectPowerPercent(layer, powerSource),
    ...(layer.powerMode !== undefined ? { powerMode: layer.powerMode } : {}),
    speed,
    ...(speed === layer.speed ? {} : { requestedSpeed: layer.speed }),
    ...('operationOverride' in powerSource && powerSource.operationOverride !== undefined
      ? { operationSettings: captureLayerOperationSettings(layer) }
      : {}),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
  };
}
