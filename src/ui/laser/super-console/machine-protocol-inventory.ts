import { selectControllerDriver } from '../../../core/controllers';
import { firmwareReportQuery } from '../../../core/controllers/controller-firmware-report';
import type { DeviceProfile } from '../../../core/devices';
import type { LaserState } from '../../state/laser-store';

export function machineProtocolInventory(device: DeviceProfile, laser: LaserState) {
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  const caps = driver.capabilities;
  return [
    { name: 'Declared protocol', value: driver.label },
    {
      name: 'Connection',
      value:
        caps.transport === 'file-only'
          ? 'File export only; no live transport'
          : driver.kind === 'fluidnc'
            ? 'Serial or explicit desktop FluidNC TCP channel'
            : 'Serial',
    },
    {
      name: 'Live status',
      value:
        caps.statusQuery === 'none'
          ? 'Not supported'
          : caps.statusQuery === 'realtime-report'
            ? 'Realtime controller reports'
            : 'Owned queued position reports while transport is idle',
    },
    {
      name: 'Firmware identity',
      value: firmwareReportQuery(driver) ?? 'No documented report adapter for this command set',
    },
    {
      name: 'Settings',
      value:
        caps.settings === 'grbl-dollar'
          ? 'Owned read and selected explicit writes'
          : caps.settings === 'readonly-dump'
            ? 'Owned read-only dump'
            : 'No generic settings adapter',
    },
    {
      name: 'Focus',
      value:
        device.autofocusCommand.trim().length > 0
          ? 'Operator-configured single-line focus command; device dependent'
          : 'Manual focus; no configured device command',
    },
    {
      name: 'Probing',
      value: caps.probing
        ? 'GRBL-family touch-off; surface grid requires declared powered Z and probe'
        : 'No qualified probe workflow for this protocol',
    },
    {
      name: 'Offline execution',
      value:
        driver.kind === 'ruida'
          ? 'Experimental vector .rd export; run from the machine panel'
          : 'Save executable output and use a separately qualified controller/file workflow',
    },
    {
      name: 'Firmware flashing',
      value: 'No flashing adapter; use the documented controller/vendor updater',
    },
    {
      name: 'Conveyor / curved surface',
      value:
        'No universal conveyor or curved-surface device protocol; review hardware-specific workflow',
    },
    {
      name: 'Observation scope',
      value:
        laser.connection.kind === 'connected'
          ? `Current session ${laser.controllerSessionEpoch}; firmware reports do not enable capabilities`
          : 'Disconnected; declarations are not a connected-device observation',
    },
  ];
}
