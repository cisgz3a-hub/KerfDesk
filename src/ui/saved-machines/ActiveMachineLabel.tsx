// The machine a job will run on, beside Frame and Start (ADR-374).

import { Button } from '../kit';
import { useStore } from '../state';
import { openMyMachines } from './my-machines-dialog-store';

export function ActiveMachineLabel(): JSX.Element {
  const name = useStore((state) => state.project.device.name);
  return (
    <div style={rowStyle}>
      <span style={textStyle}>
        Machine: <strong>{name || 'Unnamed machine'}</strong>
      </span>
      <Button
        variant="ghost"
        title="Open My machines to switch to another of your machines."
        onClick={openMyMachines}
      >
        Change
      </Button>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 0,
};
const textStyle: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-sm)',
};
