// MachineModeToggle — segmented Laser | CNC switch at the top of the
// Cuts/Layers rail. Sets project.machine; the compile/emit pipeline, layer
// cards, and jog panel all follow this choice.

import { selectControllerDriver } from '../../core/controllers';
import { deviceSupportsMachineKind, type DeviceProfile } from '../../core/devices/device-profile';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  cncControllerWarningMessage,
  machineCapabilityWarningMessage,
} from './machine-capability-messages';

export function MachineModeToggle(): JSX.Element {
  const kind = useStore((s) => machineKindOf(s.project.machine));
  const device = useStore((s) => s.project.device);
  const setMachineKind = useStore((s) => s.setMachineKind);
  const pushToast = useToastStore((s) => s.pushToast);
  const select = (machineKind: MachineKind): void => {
    setMachineKind(machineKind);
    const warning = machineModeWarning(device, machineKind);
    if (warning !== null) pushToast(warning, 'warning');
  };
  return (
    <div role="group" aria-label="Machine type" className="lf-machine-mode">
      <SegButton
        label="Laser"
        title="Laser cutter/engraver mode: layers carry power, speed, and passes."
        active={kind === 'laser'}
        warning={machineModeWarning(device, 'laser')}
        onSelect={() => select('laser')}
      />
      <SegButton
        label="CNC"
        title="CNC router mode: layers carry cut type, depth, and feeds; G-code drives the spindle and Z axis."
        active={kind === 'cnc'}
        warning={machineModeWarning(device, 'cnc')}
        onSelect={() => select('cnc')}
      />
    </div>
  );
}

/** Why a mode may not suit this profile, or null. A controller that cannot
 *  run KerfDesk CNC jobs says so before the capability label does (controller
 *  audit CN-2). Either way the mode still switches. */
function machineModeWarning(device: DeviceProfile, machineKind: MachineKind): string | null {
  if (machineKind === 'cnc') {
    const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
    if (!driver.capabilities.cncJobs) return cncControllerWarningMessage(driver.label);
  }
  return deviceSupportsMachineKind(device, machineKind)
    ? null
    : machineCapabilityWarningMessage(machineKind);
}

function SegButton(props: {
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly warning: string | null;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      data-capability-warning={props.warning !== null ? 'true' : undefined}
      onClick={props.onSelect}
      title={props.warning === null ? props.title : `${props.title} ${props.warning}`}
      className="lf-machine-mode__choice"
    >
      {props.label}
    </button>
  );
}
