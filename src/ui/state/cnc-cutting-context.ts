import type { DeviceProfile } from '../../core/devices';
import { cncCuttingToolContext } from '../../core/cnc/cutting-preset';
import { layerCncTool, type CncLayerSettings, type CncMachineConfig } from '../../core/scene';
import type { CncCuttingContext } from '../../core/scene/cnc-cutting-preset';

export function currentCncCuttingContext(
  settings: CncLayerSettings,
  machine: CncMachineConfig | null,
  device: DeviceProfile,
): CncCuttingContext | null {
  const source = settings.feedSource;
  const materialKey =
    settings.materialKey ?? (source?.kind === 'material-recipe' ? source.materialKey : undefined);
  if (machine === null || materialKey === undefined || materialKey.trim() === '') return null;
  return {
    materialKey,
    tool: cncCuttingToolContext(layerCncTool(machine, settings)),
    machine: {
      name: device.name,
      ...(device.profileId === undefined ? {} : { profileId: device.profileId }),
      controllerKind: device.controllerKind ?? 'grbl-v1.1',
      spindleMaxRpm: machine.params.spindleMaxRpm,
      maxFeedMmPerMin: machine.params.maxFeedMmPerMin ?? device.maxFeed,
    },
  };
}
