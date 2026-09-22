import type { Project } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function UndoHistoryDialog(props: {
  readonly current: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
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
}): JSX.Element {
  return (
    <div style={listStyle}>
      <HistoryRow label="Current project" project={props.current} />
      {topFirst(props.undoStack).map((project, index) => (
        <HistoryRow
          key={`undo-${index}`}
          label={index === 0 ? 'Next undo' : `Undo ${index + 1}`}
          project={project}
        />
      ))}
      {topFirst(props.redoStack).map((project, index) => (
        <HistoryRow
          key={`redo-${index}`}
          label={index === 0 ? 'Next redo' : `Redo ${index + 1}`}
          project={project}
        />
      ))}
    </div>
  );
}

function HistoryRow(props: { readonly label: string; readonly project: Project }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{props.label}</span>
      <span>{projectSummary(props.project)}</span>
    </div>
  );
}

function topFirst(stack: ReadonlyArray<Project>): ReadonlyArray<Project> {
  return [...stack].reverse();
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
  gridTemplateColumns: '120px 1fr',
  gap: 8,
  padding: '8px 10px',
  borderBottom: '1px solid var(--lf-border-subtle)',
};

const rowLabelStyle: React.CSSProperties = {
  fontWeight: 700,
};
