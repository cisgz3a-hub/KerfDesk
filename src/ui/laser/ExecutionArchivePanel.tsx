import { useState, type CSSProperties } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { recoveryRepository, type RecoveryRepository, type RunId } from '../state/recovery';
import type { ExecutionHistoryRecord } from '../state/recovery/recovery-model';
import { useRecoveryRepositorySnapshot } from '../state/use-recovery-repository';
import { exportExecutionArtifact } from './export-execution-artifact';

type ArchiveStatus = {
  readonly kind: 'success' | 'info' | 'error';
  readonly message: string;
};

export function ExecutionArchivePanel(props: {
  readonly repository?: RecoveryRepository;
}): JSX.Element {
  const repository = props.repository ?? recoveryRepository;
  const platform = usePlatformOptional();
  const snapshot = useRecoveryRepositorySnapshot(repository);
  const [exportingRunId, setExportingRunId] = useState<RunId | null>(null);
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const records = [...snapshot.executionHistory].reverse();

  const exportRecord = async (runId: RunId): Promise<void> => {
    if (exportingRunId !== null) return;
    if (platform === null) {
      setStatus({ kind: 'error', message: 'File export is unavailable on this platform.' });
      return;
    }
    setExportingRunId(runId);
    setStatus(null);
    try {
      const result = await exportExecutionArtifact({ platform, repository, runId });
      if (result.ok) {
        setStatus({ kind: 'success', message: `Execution exported to ${result.displayName}.` });
      } else {
        setStatus({
          kind: result.reason === 'cancelled' ? 'info' : 'error',
          message: result.message,
        });
      }
    } finally {
      setExportingRunId(null);
    }
  };

  return (
    <details style={panelStyle} aria-label="Execution archive">
      <summary
        style={summaryStyle}
        title="Show or hide completed and interrupted execution records available for export."
      >
        <strong>Execution archive</strong> <span style={countStyle}>({records.length})</span>
      </summary>
      <p style={descriptionStyle}>
        Read-only completed and interrupted runs. Export retrieves the exact stored artifact from
        recovery storage, including its recorded provenance; it does not compile or move the
        machine.
      </p>
      {!snapshot.loaded ? (
        <p role="status" style={emptyStyle}>
          Loading execution archive…
        </p>
      ) : records.length === 0 ? (
        <p role="status" style={emptyStyle}>
          No archived executions yet. Completed or interrupted jobs will appear here.
        </p>
      ) : (
        <ol style={listStyle}>
          {records.map((record) => (
            <ExecutionArchiveRow
              key={record.runId}
              record={record}
              disabled={exportingRunId !== null}
              exporting={exportingRunId === record.runId}
              onExport={() => void exportRecord(record.runId)}
            />
          ))}
        </ol>
      )}
      {status === null ? null : (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          style={status.kind === 'error' ? errorStyle : statusStyle}
        >
          {status.message}
        </p>
      )}
    </details>
  );
}

function ExecutionArchiveRow(props: {
  readonly record: ExecutionHistoryRecord;
  readonly disabled: boolean;
  readonly exporting: boolean;
  readonly onExport: () => void;
}): JSX.Element {
  const record = props.record;
  const label = record.terminalKind === 'completed' ? 'Completed' : 'Interrupted';
  return (
    <li style={rowStyle}>
      <div style={rowHeadingStyle}>
        <strong>{label}</strong>
        <time dateTime={record.terminalAtIso} title={record.terminalAtIso}>
          {formatArchiveTime(record.terminalAtIso)}
        </time>
      </div>
      <div style={metadataStyle}>
        {record.ackedLines} / {record.sendableLines} lines acknowledged ·{' '}
        {formatBytes(record.estimatedArtifactBytes)}
      </div>
      <code style={runIdStyle}>{record.runId}</code>
      {record.interruption === undefined ? null : (
        <p style={interruptionStyle}>{record.interruption.message}</p>
      )}
      <button
        type="button"
        onClick={props.onExport}
        disabled={props.disabled}
        aria-label={`Export stored execution ${record.runId}`}
        title="Save the exact stored execution artifact and its recorded provenance as JSON."
      >
        {props.exporting ? 'Exporting…' : 'Export stored JSON'}
      </button>
    </li>
  );
}

function formatArchiveTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
  minWidth: 0,
};
const summaryStyle: CSSProperties = { cursor: 'pointer', fontSize: 12 };
const countStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontWeight: 400 };
const descriptionStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.35,
  margin: '8px 0',
};
const emptyStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12, margin: '8px 0' };
const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  listStyle: 'none',
  margin: '8px 0',
  padding: 0,
};
const rowStyle: CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 4,
  minWidth: 0,
  paddingTop: 6,
};
const rowHeadingStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 6,
  color: 'var(--lf-text)',
  fontSize: 11,
};
const metadataStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const runIdStyle: CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 10,
  overflowWrap: 'anywhere',
};
const interruptionStyle: CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 11,
  margin: 0,
};
const statusStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11, margin: '6px 0' };
const errorStyle: CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 11, margin: '6px 0' };
