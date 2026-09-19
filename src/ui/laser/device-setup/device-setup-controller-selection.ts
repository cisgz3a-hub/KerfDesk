import { selectControllerDriver } from '../../../core/controllers';
import {
  controllerCompatibleProfile,
  type ControllerKind,
  type DeviceProfile,
} from '../../../core/devices';

export function controllerProfileForSelection(
  profile: DeviceProfile,
  controllerKind: ControllerKind,
): DeviceProfile {
  const compatible = controllerCompatibleProfile(profile, controllerKind).profile;
  // Switching to another protocol family drops the vendor command contract.
  // Correcting a GRBL / grblHAL label keeps the machine's vendor commands.
  const { controllerCommandSet, ...familyProfile } = compatible;
  return {
    ...familyProfile,
    ...(controllerCommandSet !== undefined &&
    (controllerKind === 'grbl-v1.1' || controllerKind === 'grblhal')
      ? { controllerCommandSet }
      : {}),
    controllerKind,
    baudRate: selectControllerDriver(controllerKind).defaultBaudRate,
    minPowerS: 0,
    maxPowerS: defaultPowerScale(controllerKind),
  };
}

function defaultPowerScale(controllerKind: ControllerKind): number {
  if (controllerKind === 'marlin' || controllerKind === 'fluidnc') return 255;
  if (controllerKind === 'smoothieware') return 1;
  return 1000;
}
