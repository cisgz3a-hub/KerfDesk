// One saved machine in My machines. Presentational: the dialog owns the
// actions; the row owns only its rename draft and its in-page Remove
// confirmation (never a blocking browser dialog, which would freeze Stop).

import { useState } from 'react';
import type { SavedMachine } from '../../core/saved-machines/saved-machine-list';
import { Button } from '../kit';
import { recognitionSummary, savedMachineSummary } from './saved-machine-describe';

export type SavedMachineRowProps = {
  readonly machine: SavedMachine;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly onSwitch: () => void;
  /** Returns why the name was refused, or null once renamed. */
  readonly onRename: (name: string) => string | null;
  readonly onDuplicate: () => void;
  readonly onToggleDefault: () => void;
  readonly onExport: () => void;
  readonly onRemove: () => void;
};

type RowMode = 'view' | 'rename' | 'confirm-remove';

export function SavedMachineRow(props: SavedMachineRowProps): JSX.Element {
  const [mode, setMode] = useState<RowMode>('view');
  return (
    <li style={rowStyle} aria-label={props.machine.name}>
      <RowHeading {...props} />
      {mode === 'rename' ? (
        <RenameForm
          machine={props.machine}
          onRename={props.onRename}
          onDone={() => setMode('view')}
        />
      ) : null}
      {mode === 'confirm-remove' ? (
        <RemoveConfirm
          machine={props.machine}
          onRemove={props.onRemove}
          onCancel={() => setMode('view')}
        />
      ) : null}
      {mode === 'view' ? <RowActions {...props} onMode={setMode} /> : null}
    </li>
  );
}

function RowHeading(props: SavedMachineRowProps): JSX.Element {
  return (
    <div style={metaStyle}>
      <span style={nameStyle}>
        {props.machine.name}
        {props.isDefault ? <span style={badgeStyle}>Default</span> : null}
        {props.isActive ? <span style={badgeStyle}>In this project</span> : null}
      </span>
      <span style={subStyle}>{savedMachineSummary(props.machine)}</span>
      <span style={subStyle}>{recognitionSummary(props.machine.controllerFingerprint)}</span>
    </div>
  );
}

function RowActions(
  props: SavedMachineRowProps & { readonly onMode: (mode: RowMode) => void },
): JSX.Element {
  const name = props.machine.name;
  return (
    <div style={actionsStyle}>
      <Button
        variant="primary"
        disabled={props.isActive}
        aria-label={`Switch to ${name}`}
        title={
          props.isActive
            ? 'The open project already uses this machine.'
            : 'Apply every setting of this machine to the open project (one undoable change).'
        }
        onClick={props.onSwitch}
      >
        Switch to
      </Button>
      <Button
        aria-label={`Rename ${name}`}
        title="Rename this saved machine."
        onClick={() => props.onMode('rename')}
      >
        Rename
      </Button>
      <Button
        aria-label={`Duplicate ${name}`}
        title="Copy every setting into a new saved machine."
        onClick={props.onDuplicate}
      >
        Duplicate
      </Button>
      <Button
        aria-label={props.isDefault ? `Clear default ${name}` : `Set ${name} as default`}
        title={
          props.isDefault
            ? 'Stop starting new projects with this machine.'
            : 'Start new projects, and KerfDesk itself, with this machine.'
        }
        onClick={props.onToggleDefault}
      >
        {props.isDefault ? 'Clear default' : 'Set default'}
      </Button>
      <Button
        aria-label={`Export ${name}`}
        title="Save this machine to a .lfmachine.json file."
        onClick={props.onExport}
      >
        Export…
      </Button>
      <Button
        variant="danger"
        aria-label={`Remove ${name}`}
        title="Remove this machine from My machines."
        onClick={() => props.onMode('confirm-remove')}
      >
        Remove
      </Button>
    </div>
  );
}

function RenameForm(props: {
  readonly machine: SavedMachine;
  readonly onRename: (name: string) => string | null;
  readonly onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.machine.name);
  const [issue, setIssue] = useState<string | null>(null);
  const save = (): void => {
    const refused = props.onRename(draft);
    if (refused === null) props.onDone();
    else setIssue(refused);
  };
  return (
    <div style={actionsStyle}>
      <input
        className="lf-input"
        type="text"
        value={draft}
        aria-label={`New name for ${props.machine.name}`}
        title="New name for this saved machine."
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
      <Button variant="primary" title="Save the new name." onClick={save}>
        Save name
      </Button>
      <Button title="Keep the current name." onClick={props.onDone}>
        Cancel
      </Button>
      {issue === null ? null : (
        <span role="alert" style={issueStyle}>
          {issue}
        </span>
      )}
    </div>
  );
}

function RemoveConfirm(props: {
  readonly machine: SavedMachine;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div role="group" aria-label={`Confirm removing ${props.machine.name}`} style={actionsStyle}>
      <span style={subStyle}>
        Remove “{props.machine.name}” from My machines? Projects that use it keep their own copy.
      </span>
      <Button
        variant="danger"
        title="Remove it from this workstation's list."
        onClick={props.onRemove}
      >
        Remove machine
      </Button>
      <Button title="Keep this machine." onClick={props.onCancel}>
        Keep
      </Button>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 0',
  borderBottom: '1px solid var(--lf-border)',
};
const metaStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const nameStyle: React.CSSProperties = { fontWeight: 600, display: 'flex', gap: 6 };
const subStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  padding: '0 6px',
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  color: 'var(--lf-text-muted)',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};
const issueStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 12 };
