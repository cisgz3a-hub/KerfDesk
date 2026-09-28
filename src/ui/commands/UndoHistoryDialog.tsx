// Window → Undo History: every step on the undo and redo stacks by name, as
// one timeline with the newest step at the top. Clicking an undo step undoes
// back to just before it; clicking a redo step redoes up to and including it.
// Both run the ordinary Undo or Redo that many times (state/undo-history.ts),
// so nothing is lost: after a jump back, the steps wait on the redo side and
// can be clicked again. The dialog stays open so you can jump more than once.

import { useRef } from 'react';
import type { Project } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import {
  redoHistoryEntries,
  undoHistoryEntries,
  type UndoHistoryEntry,
} from '../state/undo-history';

export function UndoHistoryDialog(props: {
  readonly current: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Undo this many steps in one go. */
  readonly onUndoSteps: (count: number) => void;
  /** Redo this many steps in one go. */
  readonly onRedoSteps: (count: number) => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Dialog title="Undo History" size="md" onClose={props.onClose}>
      <div style={summaryGridStyle}>
        <HistorySummary label="Current project" value={projectSummary(props.current)} />
        <HistorySummary label="Undo history" value={availableLabel(props.undoStack.length)} />
        <HistorySummary label="Redo history" value={availableLabel(props.redoStack.length)} />
      </div>
      <HistoryList
        current={props.current}
        undoStack={props.undoStack}
        redoStack={props.redoStack}
        onUndoSteps={props.onUndoSteps}
        onRedoSteps={props.onRedoSteps}
      />
      <DialogActions>
        <Button type="button" disabled={props.undoStack.length === 0} onClick={props.onUndo}>
          Undo
        </Button>
        <Button type="button" disabled={props.redoStack.length === 0} onClick={props.onRedo}>
          Redo
        </Button>
        <Button type="button" variant="primary" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HistorySummary(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={summaryItemStyle}>
      <span style={summaryLabelStyle}>{props.label}</span>
      <span>{props.value}</span>
    </div>
  );
}

function HistoryList(props: {
  readonly current: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly onUndoSteps: (count: number) => void;
  readonly onRedoSteps: (count: number) => void;
}): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const state = { project: props.current, undoStack: props.undoStack, redoStack: props.redoStack };
  // Furthest redo at the top, so the list reads newest to oldest top to bottom.
  const redo = [...redoHistoryEntries(state)].reverse();
  const undo = undoHistoryEntries(state);
  // The clicked row moves to the other side of the list; keep focus inside it.
  const jump = (run: (count: number) => void, count: number): void => {
    run(count);
    listRef.current?.focus();
  };
  return (
    <div ref={listRef} style={listStyle} tabIndex={-1} aria-label="Undo history steps">
      {redo.map((entry) => (
        <StepRow
          key={`redo-${entry.steps}`}
          entry={entry}
          direction="redo"
          onJump={() => jump(props.onRedoSteps, entry.steps)}
        />
      ))}
      <div style={currentRowStyle} aria-current="step">
        <span style={rowLabelStyle}>Current project</span>
        <span>{projectSummary(props.current)}</span>
      </div>
      {undo.map((entry) => (
        <StepRow
          key={`undo-${entry.steps}`}
          entry={entry}
          direction="undo"
          onJump={() => jump(props.onUndoSteps, entry.steps)}
        />
      ))}
    </div>
  );
}

function StepRow(props: {
  readonly entry: UndoHistoryEntry;
  readonly direction: 'undo' | 'redo';
  readonly onJump: () => void;
}): JSX.Element {
  const { entry, direction } = props;
  return (
    <button
      type="button"
      style={direction === 'redo' ? redoRowStyle : rowStyle}
      title={stepTitle(entry, direction)}
      data-history-direction={direction}
      data-history-steps={entry.steps}
      onClick={props.onJump}
    >
      <span style={stepNameStyle}>{entry.name}</span>
      <span style={stepHintStyle}>{stepHint(entry.steps, direction)}</span>
    </button>
  );
}

function stepHint(steps: number, direction: 'undo' | 'redo'): string {
  return `${plural(steps, 'step')} ${direction === 'undo' ? 'back' : 'forward'}`;
}

function stepTitle(entry: UndoHistoryEntry, direction: 'undo' | 'redo'): string {
  if (direction === 'undo') {
    return entry.steps === 1
      ? `Undo ${entry.name}.`
      : `Undo back to just before ${entry.name} (${entry.steps} steps). Redo brings them back.`;
  }
  return entry.steps === 1
    ? `Redo ${entry.name}.`
    : `Redo up to and including ${entry.name} (${entry.steps} steps).`;
}

function availableLabel(count: number): string {
  return `${count} available`;
}

function projectSummary(project: Project): string {
  return `${plural(project.scene.objects.length, 'object')}, ${plural(
    project.scene.layers.length,
    'layer',
  )}`;
}

function plural(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 8,
  marginBottom: 12,
};

const summaryItemStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
  display: 'grid',
  gap: 4,
};

const summaryLabelStyle: React.CSSProperties = {
  fontWeight: 700,
};

const listStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  marginBottom: 12,
  maxHeight: 260,
  overflow: 'auto',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  border: 0,
  borderBottom: '1px solid var(--lf-border-subtle)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const redoRowStyle: React.CSSProperties = {
  ...rowStyle,
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};

const currentRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
  padding: '8px 10px',
  borderBottom: '1px solid var(--lf-border-subtle)',
  background: 'var(--lf-accent-wash)',
};

const rowLabelStyle: React.CSSProperties = {
  fontWeight: 700,
};

const stepNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const stepHintStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
