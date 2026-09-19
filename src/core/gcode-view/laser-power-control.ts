import { resolveMarlinDialect, type DeviceProfile } from '../devices';
import type { BuildRenderModelOptions } from './render-model-types';

/** Use the emitted artifact's profile, including for retained/recovered runs. */
export function laserPowerControlForDevice(
  device: DeviceProfile,
): BuildRenderModelOptions['laserPowerControl'] {
  if (device.controllerKind === 'smoothieware') return 'smoothieware';
  if (device.controllerKind === 'marlin' && resolveMarlinDialect(device).powerMode === 'fan') {
    return 'fan';
  }
  return 'spindle';
}
