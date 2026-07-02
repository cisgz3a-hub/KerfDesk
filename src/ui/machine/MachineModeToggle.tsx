// MachineModeToggle — segmented Laser | CNC switch at the top of the
// Cuts/Layers rail. Sets project.machine; the compile/emit pipeline, layer
// cards, and jog panel all follow this choice.

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';

export function MachineModeToggle(): JSX.Element {
  const kind = useStore((s) => machineKindOf(s.project.machine));
  const setMachineKind = useStore((s) => s.setMachineKind);
  return (
    <div role="group" aria-label="Machine type" style={groupStyle}>
      <SegButton
        label="Laser"
        title="Laser cutter/engraver mode: layers carry power, speed, and passes."
        active={kind === 'laser'}
        onSelect={() => setMachineKind('laser')}
      />
      <SegButton
        label="CNC"
        title="CNC router mode: layers carry cut type, depth, and feeds; G-code drives the spindle and Z axis."
        active={kind === 'cnc'}
        onSelect={() => setMachineKind('cnc')}
      />
    </div>
  );
}

function SegButton(props: {
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onSelect}
      title={props.title}
      style={props.active ? activeSegStyle : segStyle}
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
