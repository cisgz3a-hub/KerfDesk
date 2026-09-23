// MachineModeToggle — segmented Laser | CNC switch at the top of the
// Cuts/Layers rail. Sets project.machine; the compile/emit pipeline, layer
// cards, and jog panel all follow this choice.

import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { machineCapabilityWarningMessage } from './machine-capability-messages';

export function MachineModeToggle(): JSX.Element {
  const kind = useStore((s) => machineKindOf(s.project.machine));
  const device = useStore((s) => s.project.device);
  const setMachineKind = useStore((s) => s.setMachineKind);
  const pushToast = useToastStore((s) => s.pushToast);
  const select = (machineKind: MachineKind): void => {
    setMachineKind(machineKind);
    if (!deviceSupportsMachineKind(device, machineKind)) {
      pushToast(machineCapabilityWarningMessage(machineKind), 'warning');
    }
  };
  return (
    <div role="group" aria-label="Machine type" className="lf-machine-mode">
      <SegButton
        machineKind="laser"
        label="Laser"
        title="Laser cutter/engraver mode: layers carry power, speed, and passes."
        active={kind === 'laser'}
        available={deviceSupportsMachineKind(device, 'laser')}
        onSelect={() => select('laser')}
      />
      <SegButton
        machineKind="cnc"
        label="CNC"
        title="CNC router mode: layers carry cut type, depth, and feeds; G-code drives the spindle and Z axis."
        active={kind === 'cnc'}
        available={deviceSupportsMachineKind(device, 'cnc')}
        onSelect={() => select('cnc')}
      />
    </div>
  );
}

function SegButton(props: {
  readonly machineKind: MachineKind;
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly available: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const title = props.available
    ? props.title
    : `${props.title} ${machineCapabilityWarningMessage(props.machineKind)}`;
  return (
    <button
      type="button"
      aria-pressed={props.active}
      data-capability-warning={!props.available ? 'true' : undefined}
      onClick={props.onSelect}
      title={title}
      className="lf-machine-mode__choice"
    >
      {props.label}
    </button>
  );
}
