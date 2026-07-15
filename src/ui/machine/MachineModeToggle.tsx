// MachineModeToggle — segmented Laser | CNC switch at the top of the
// Cuts/Layers rail. Sets project.machine; the compile/emit pipeline, layer
// cards, and jog panel all follow this choice.

import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { blockedMachineModeMessage } from './machine-capability-messages';

export function MachineModeToggle(): JSX.Element {
  const kind = useStore((s) => machineKindOf(s.project.machine));
  const device = useStore((s) => s.project.device);
  const setMachineKind = useStore((s) => s.setMachineKind);
  const pushToast = useToastStore((s) => s.pushToast);
  const select = (machineKind: MachineKind): void => {
    const result = setMachineKind(machineKind);
    if (result.kind === 'blocked-by-capability') {
      pushToast(blockedMachineModeMessage(result.requestedKind), 'warning');
    }
  };
  return (
    <div role="group" aria-label="Machine type" style={groupStyle}>
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
  const title = props.available ? props.title : blockedMachineModeMessage(props.machineKind);
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-disabled={!props.available}
      onClick={props.onSelect}
      title={title}
      style={!props.available ? unavailableSegStyle : props.active ? activeSegStyle : segStyle}
    >
      {props.label}
    </button>
  );
}

const groupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  marginBottom: 10,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  overflow: 'hidden',
};
const segStyle: React.CSSProperties = {
  flex: 1,
  padding: '5px 0',
  border: 'none',
  background: 'var(--lf-bg-2)',
  color: 'var(--lf-text-muted)',
  cursor: 'pointer',
  fontWeight: 600,
};
const activeSegStyle: React.CSSProperties = {
  ...segStyle,
  background: 'var(--lf-accent)',
  color: 'var(--lf-bg)',
};
const unavailableSegStyle: React.CSSProperties = {
  ...segStyle,
  color: 'var(--lf-text-muted)',
  cursor: 'not-allowed',
  opacity: 0.45,
};
