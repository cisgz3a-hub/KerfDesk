// One row of the Saved Libraries page (ADR-093, F-ML3). Presentational: the
// dialog owns the store wiring and passes callbacks; the row only owns its
// inline-rename text state.

import { useState } from 'react';
import { Button } from '../kit';
import type { SavedLibrarySummary } from '../state/material-library-collection';

export function SavedLibraryRow(props: {
  readonly summary: SavedLibrarySummary;
  readonly onOpen: () => void;
  readonly onRename: (name: string) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
}): JSX.Element {
  const { summary } = props;
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(summary.name);
  if (renaming) {
    return (
      <RenameRow
        summary={summary}
        draftName={draftName}
        onDraftChange={setDraftName}
        onSave={() => {
          props.onRename(draftName);
          setRenaming(false);
        }}
        onCancel={() => {
          setDraftName(summary.name);
          setRenaming(false);
        }}
      />
    );
  }
  return (
    <DisplayRow
      summary={summary}
      onOpen={props.onOpen}
      onStartRename={() => {
        setDraftName(summary.name);
        setRenaming(true);
      }}
      onDuplicate={props.onDuplicate}
      onDelete={props.onDelete}
      onExport={props.onExport}
    />
  );
}

function RenameRow(props: {
  readonly summary: SavedLibrarySummary;
  readonly draftName: string;
  readonly onDraftChange: (name: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <li style={rowStyle}>
      <input
        className="lf-input"
        type="text"
        value={props.draftName}
        aria-label={`Rename ${props.summary.name}`}
        title="New name for this library."
        autoFocus
        onChange={(event) => props.onDraftChange(event.currentTarget.value)}
      />
      <div style={actionsStyle}>
        <Button
          variant="primary"
          aria-label={`Save name for ${props.summary.name}`}
          title="Save the new name."
          onClick={props.onSave}
        >
          Save
        </Button>
        <Button
          aria-label={`Cancel renaming ${props.summary.name}`}
          title="Cancel renaming."
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </li>
  );
}

function DisplayRow(props: {
  readonly summary: SavedLibrarySummary;
  readonly onOpen: () => void;
  readonly onStartRename: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
}): JSX.Element {
  const { summary } = props;
  return (
    <li style={rowStyle}>
      <div style={metaStyle}>
        <span style={nameStyle}>
          {summary.name}
          {summary.isActive ? <span style={activeStyle}> · open</span> : null}
        </span>
        <span style={subStyle}>{describe(summary)}</span>
      </div>
      <div style={actionsStyle}>
        <Button
          variant="primary"
          disabled={summary.isActive}
          aria-label={`Open ${summary.name}`}
          title="Make this the active library."
          onClick={props.onOpen}
        >
          Open
        </Button>
        <Button
          aria-label={`Rename ${summary.name}`}
          title="Rename this library."
          onClick={props.onStartRename}
        >
          Rename
        </Button>
        <Button
          aria-label={`Duplicate ${summary.name}`}
          title="Make a copy of this library."
          onClick={props.onDuplicate}
        >
          Duplicate
        </Button>
        <Button
          aria-label={`Export ${summary.name}`}
          title="Save this library to a file."
          onClick={props.onExport}
        >
          Export...
        </Button>
        <Button
          variant="danger"
          aria-label={`Delete ${summary.name}`}
          title="Delete this library."
          onClick={props.onDelete}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function describe(summary: SavedLibrarySummary): string {
  const presets = `${summary.presetCount} ${summary.presetCount === 1 ? 'preset' : 'presets'}`;
  return summary.deviceHintName === null ? presets : `${presets} · ${summary.deviceHintName}`;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 0',
  borderBottom: '1px solid var(--lf-border)',
};
const metaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};
const nameStyle: React.CSSProperties = { fontWeight: 600 };
const activeStyle: React.CSSProperties = { color: 'var(--lf-accent)', fontWeight: 400 };
const subStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 6, flexShrink: 0 };
