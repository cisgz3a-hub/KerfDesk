import { useMemo } from 'react';
import { type LaserController, type MachineState } from '../../controllers/ControllerInterface';
import { GrblController } from '../../controllers/grbl/GrblController';
import { type MachineSettingsLiveCapabilities } from '../components/settings/MachineSettingsTab';

export function useSettingsLiveCapabilities(
  controller: LaserController | null,
  machineState: MachineState | null,
): MachineSettingsLiveCapabilities | null {
  return useMemo(() => {
    if (!controller || !(controller instanceof GrblController)) return null;
    const info = controller.getMachineInfo();
    return {
      bedWidth: info.bedWidth > 0 ? info.bedWidth : null,
      bedHeight: info.bedHeight > 0 ? info.bedHeight : null,
      maxSpindle: typeof controller.maxSpindle === 'number' && controller.maxSpindle > 0
        ? controller.maxSpindle
        : null,
      laserMode: controller.getFirmwareLaserModeEnabled() ?? null,
      homingEnabled: controller.getFirmwareHomingCycleEnabled() ?? null,
    };
  }, [controller, machineState]);
}
