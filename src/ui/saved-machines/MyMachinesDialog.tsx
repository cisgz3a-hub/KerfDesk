// My machines (ADR-374): the operator's own machines, saved on this
// workstation. LightBurn's Devices window lists devices globally
// (https://docs.lightburnsoftware.com/2.1/Reference/Devices/); here a project
// keeps its own copy of its machine, and Switch to applies a saved machine to
// the open project as one undoable change.

import { useState } from 'react';
import {
  findSavedMachine,
  savedMachinesByName,
  type SavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { CurrentMachineSection } from './CurrentMachineSection';
import {
  STORAGE_FAILED_MESSAGE,
  duplicateMachine,
  removeMachine,
  renameMachine,
  setDefaultMachine,
} from './saved-machine-actions';
import { exportSavedMachineFile, importSavedMachineFile } from './saved-machine-files';
import { SavedMachineRow } from './SavedMachineRow';
import { switchFeedback, type SwitchFeedback } from './switch-feedback';
import { switchToSavedMachine } from './switch-saved-machine';

type Report = (tone: SwitchFeedback['tone'], text: string) => void;

export function MyMachinesDialog(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const list = useSavedMachinesStore((store) => store.list);
  const persistFailed = useSavedMachinesStore((store) => store.persistFailed);
  const savedMachineId = useStore((state) => state.project.device.savedMachineId);
  const active = findSavedMachine(list, savedMachineId);
  const [status, setStatus] = useState<SwitchFeedback | null>(null);
  const report: Report = (tone, text) => setStatus({ tone, text });
  const onImport = (): void => {
    importSavedMachineFile(platform)
      .then((result) => {
        if (result.kind === 'cancelled') return;
        if (result.kind === 'failed') report('error', `Import failed: ${result.message}`);
        else report('success', importedText(result.machine, result.notes));
      })
      .catch((error: unknown) => report('error', `Import failed: ${errorText(error)}`));
  };
  const machines = savedMachinesByName(list);
  return (
    <Dialog onClose={props.onClose} title="My machines" size="lg">
      <p style={introStyle}>
        Machines saved on this workstation. Each project keeps its own copy of its machine; Switch
        to applies a saved machine to the open project and asks for a fresh Frame.
      </p>
      <CurrentMachineSection active={active} onReport={(text) => report('success', text)} />
      {persistFailed ? (
        <p role="alert" style={toneStyle('warning')}>
          {STORAGE_FAILED_MESSAGE}
        </p>
      ) : null}
      {status === null ? null : (
        <p role="status" style={toneStyle(status.tone)}>
          {status.text}
        </p>
      )}
      {machines.length === 0 ? (
        <p style={emptyStyle}>
          No saved machines yet. Save the current machine, or import a .lfmachine.json file.
        </p>
      ) : (
        <ul style={listStyle} aria-label="Saved machines">
          {machines.map((machine) => (
            <SavedMachineListRow
              key={machine.id}
              machine={machine}
              activeId={active?.id}
              defaultId={list.defaultMachineId}
              platform={platform}
              report={report}
            />
          ))}
        </ul>
      )}
      <DialogActions>
        <Button title="Add a machine from a .lfmachine.json file." onClick={onImport}>
          Import…
        </Button>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function SavedMachineListRow(props: {
  readonly machine: SavedMachine;
  readonly activeId: string | undefined;
  readonly defaultId: string | null;
  readonly platform: ReturnType<typeof usePlatform>;
  readonly report: Report;
}): JSX.Element {
  const { machine, report } = props;
  const isDefault = props.defaultId === machine.id;
  return (
    <SavedMachineRow
      machine={machine}
      isActive={props.activeId === machine.id}
      isDefault={isDefault}
      onSwitch={() => {
        const feedback = switchFeedback(switchToSavedMachine(machine.id));
        report(feedback.tone, feedback.text);
      }}
      onRename={(name) => renameMachine(machine.id, name)}
      onDuplicate={() => {
        duplicateMachine(machine.id);
        report('success', `Duplicated “${machine.name}”.`);
      }}
      onToggleDefault={() => {
        setDefaultMachine(isDefault ? null : machine.id);
        report('success', defaultText(machine, !isDefault));
      }}
      onExport={() => {
        exportSavedMachineFile(props.platform, machine.id)
          .then((outcome) => {
            if (outcome === 'saved') report('success', `Exported “${machine.name}”.`);
          })
          .catch((error: unknown) => report('error', `Export failed: ${errorText(error)}`));
      }}
      onRemove={() => {
        removeMachine(machine.id);
        report('success', `Removed “${machine.name}”. Projects that used it keep their own copy.`);
      }}
    />
  );
}

function importedText(machine: SavedMachine, notes: ReadonlyArray<string>): string {
  const review = notes.length === 0 ? '' : ` Review: ${notes.join(' ')}`;
  return `Imported “${machine.name}”.${review}`;
}

function defaultText(machine: SavedMachine, isDefault: boolean): string {
  return isDefault
    ? `“${machine.name}” is the default: KerfDesk and new projects start with it.`
    : 'No default machine: new projects keep the machine that is open.';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toneStyle(tone: SwitchFeedback['tone']): React.CSSProperties {
  const color =
    tone === 'error'
      ? 'var(--lf-danger-fg)'
      : tone === 'warning'
        ? 'var(--lf-warning-fg)'
        : 'var(--lf-success-fg)';
  return { margin: '4px 0', fontSize: 12, color };
}

const introStyle: React.CSSProperties = { marginTop: 0, color: 'var(--lf-text-muted)' };
const emptyStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontStyle: 'italic' };
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 420,
  overflowY: 'auto',
};
