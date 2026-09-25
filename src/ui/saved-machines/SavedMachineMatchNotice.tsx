// Connect-time recognition (ADR-374): when the connected controller agrees
// with exactly one saved machine that is not the one open, offer the switch.
// A notice, never an automatic switch: the operator may be connecting on
// purpose, and a switch replaces the whole machine profile.

import { useState } from 'react';
import { findSavedMachine } from '../../core/saved-machines/saved-machine-list';
import { savedMachineSuggestion } from '../../core/saved-machines/saved-machine-recognition';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { switchWithToast } from './switch-feedback';
import { useConnectedControllerFingerprint } from './use-connected-controller-fingerprint';

export function SavedMachineMatchNotice(): JSX.Element | null {
  const observed = useConnectedControllerFingerprint();
  const list = useSavedMachinesStore((store) => store.list);
  const device = useStore((state) => state.project.device);
  const sessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (observed === null) return null;
  const activeId = findSavedMachine(list, device.savedMachineId)?.id;
  const match = savedMachineSuggestion(observed, list, activeId);
  if (match === null) return null;
  const key = `${sessionEpoch}:${match.machine.id}:${activeId ?? ''}`;
  if (dismissed === key) return null;
  const name = match.machine.name;
  return (
    <section role="status" aria-label="Saved machine recognised" style={noticeStyle}>
      <span>
        This controller looks like your saved machine <strong>“{name}”</strong> (matched{' '}
        {match.basis.join(', ')}). The open project uses “{device.name}”.
      </span>
      <span style={actionsStyle}>
        <Button
          variant="primary"
          aria-label={`Switch to ${name}`}
          title="Apply every setting of that saved machine to the open project (one undoable change)."
          onClick={() => switchWithToast(match.machine.id)}
        >
          Switch
        </Button>
        <Button
          title="Keep the open project's machine for this connection."
          onClick={() => setDismissed(key)}
        >
          Not now
        </Button>
      </span>
    </section>
  );
}

const noticeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
  background: 'var(--lf-tint-info)',
  color: 'var(--lf-text)',
  fontSize: 12,
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 6 };
