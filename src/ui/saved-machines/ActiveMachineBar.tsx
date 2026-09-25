// The machine rail's first line: which machine the open project drives,
// whether it is one of My machines, and the way into the list (ADR-374).

import { findSavedMachine } from '../../core/saved-machines/saved-machine-list';
import { Button } from '../kit';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { openMyMachines } from './my-machines-dialog-store';
import { SavedMachineMatchNotice } from './SavedMachineMatchNotice';

export function ActiveMachineBar(): JSX.Element {
  const device = useStore((state) => state.project.device);
  const list = useSavedMachinesStore((store) => store.list);
  const saved = findSavedMachine(list, device.savedMachineId);
  return (
    <>
      <section aria-label="Active machine" style={barStyle}>
        <span style={textStyle}>
          <span style={labelStyle}>Machine</span>
          <strong style={nameStyle}>{device.name || 'Unnamed machine'}</strong>
          <span style={labelStyle}>{savedLabel(device.name, saved?.name)}</span>
        </span>
        <Button title="Save, switch between and manage your own machines." onClick={openMyMachines}>
          My machines
        </Button>
      </section>
      <SavedMachineMatchNotice />
    </>
  );
}

function savedLabel(projectName: string, savedName: string | undefined): string {
  if (savedName === undefined) return 'Not in My machines';
  return savedName === projectName ? 'Saved in My machines' : `Saved as “${savedName}”`;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const textStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
const nameStyle: React.CSSProperties = { overflowWrap: 'anywhere' };
