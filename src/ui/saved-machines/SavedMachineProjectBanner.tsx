// A project names the saved machine its copy came from (ADR-374). When that
// copy no longer matches the saved machine, say where they differ and offer
// both directions without forcing either: the project copy may be the newer
// one (edited in Machine Setup) or the saved machine may be (updated from
// another project). Waits while the opened-project machine banner is asking
// its own question, so only one machine question shows at a time.

import { useMemo, useState } from 'react';
import { findSavedMachine } from '../../core/saved-machines/saved-machine-list';
import { machineKindOf } from '../../core/scene';
import { Button } from '../kit';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { useToastStore } from '../state/toast-store';
import { saveProjectCopyToSavedMachine } from './saved-machine-actions';
import { projectCopyDifferences } from './saved-machine-comparison';
import { switchWithToast } from './switch-feedback';

export function SavedMachineProjectBanner(): JSX.Element | null {
  const device = useStore((state) => state.project.device);
  const machineKind = useStore((state) => machineKindOf(state.project.machine));
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const openedMachineQuestion = useStore((state) => state.projectBedReconciliation !== null);
  const list = useSavedMachinesStore((store) => store.list);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const saved = findSavedMachine(list, device.savedMachineId);
  const differences = useMemo(
    () => (saved === undefined ? [] : projectCopyDifferences(device, saved.profile)),
    [device, saved],
  );
  if (openedMachineQuestion || saved === undefined || differences.length === 0) return null;
  const key = `${documentEpoch}:${saved.id}:${saved.updatedAt}`;
  if (dismissed === key) return null;
  return (
    <section role="status" aria-label="Saved machine differs" style={bannerStyle}>
      <span>
        <strong>Saved machine differs:</strong> this project&apos;s copy of “{saved.name}” differs
        from your saved machine in {differences.join(', ')}.
      </span>
      <span style={actionsStyle}>
        <Button
          variant="primary"
          title={`Write this project's machine settings over the saved “${saved.name}”.`}
          onClick={() => {
            saveProjectCopyToSavedMachine(saved.id, { rememberController: false });
            useToastStore
              .getState()
              .pushToast(`Updated “${saved.name}” from this project.`, 'success');
          }}
        >
          Update saved machine
        </Button>
        <Button
          title={`Replace this project's machine settings with the saved “${saved.name}” (one undoable change).`}
          onClick={() => switchWithToast(saved.id, { machineKind })}
        >
          Use saved settings
        </Button>
        <Button
          variant="ghost"
          title="Keep both as they are; this project keeps its own copy."
          onClick={() => setDismissed(key)}
        >
          Keep project copy
        </Button>
      </span>
    </section>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-text)',
  fontSize: 12,
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexShrink: 0 };
