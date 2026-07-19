import type { SerialTranscriptEntry } from '../../state/laser-transcript';

// Detail view of the full transcript: unlike the docked ConsolePanel (which
// renders only the last 150 entries), this list renders every entry it is
// given and adds the source and wall-clock time columns.
export function SuperConsoleTranscriptList(props: {
  readonly entries: ReadonlyArray<SerialTranscriptEntry>;
}): JSX.Element {
  return (
    <div style={listStyle} role="log" aria-live="polite" aria-label="Super console transcript">
      {props.entries.length === 0 ? (
        <div style={emptyStyle}>(no console lines match the current filters)</div>
      ) : (
        props.entries.map((entry) => <TranscriptRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
}

function TranscriptRow(props: { readonly entry: SerialTranscriptEntry }): JSX.Element {
  const entry = props.entry;
  return (
    <div style={rowStyleFor(entry)}>
      <span style={timeStyle}>{formatTime(entry.at)}</span>
      <span style={badgeStyle}>{entry.direction.toUpperCase()}</span>
      <span style={sourceStyle}>{entry.source}</span>
      <span style={kindStyle}>{entry.kind}</span>
      <span style={rawStyle}>{entry.raw}</span>
      {entry.decoded !== undefined ? <span style={decodedStyle}>{entry.decoded}</span> : null}
    </div>
  );
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

function rowStyleFor(entry: SerialTranscriptEntry): React.CSSProperties {
  if (entry.kind === 'error') return errorRowStyle;
  if (entry.kind === 'alarm') return alarmRowStyle;
  if (entry.direction === 'out') return outboundRowStyle;
  return rowStyle;
}

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 240,
  overflowY: 'auto',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
};
const emptyStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontStyle: 'italic' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, whiteSpace: 'pre-wrap' };
const outboundRowStyle: React.CSSProperties = { ...rowStyle, color: 'var(--lf-accent-fg)' };
const errorRowStyle: React.CSSProperties = {
  ...rowStyle,
  color: 'var(--lf-danger-fg)',
  fontWeight: 600,
};
const alarmRowStyle: React.CSSProperties = {
  ...rowStyle,
  color: 'var(--lf-danger-fg)',
  fontWeight: 700,
};
const timeStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', minWidth: 64 };
const badgeStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', minWidth: 42 };
const sourceStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', minWidth: 64 };
const kindStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', minWidth: 96 };
const rawStyle: React.CSSProperties = { flex: 1 };
const decodedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
