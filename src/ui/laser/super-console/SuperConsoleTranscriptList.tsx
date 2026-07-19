import { useLayoutEffect, useRef } from 'react';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';

export function SuperConsoleTranscriptList(props: {
  readonly entries: ReadonlyArray<SerialTranscriptEntry>;
  readonly followLatest?: boolean;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (props.followLatest !== false && scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [props.entries, props.followLatest]);

  return (
    <div
      ref={scrollRef}
      style={scrollStyle}
      role="region"
      aria-label="Super console transcript"
      tabIndex={0}
    >
      <table style={tableStyle}>
        <thead>
          <tr>
            <ColumnHeader>Timestamp</ColumnHeader>
            <ColumnHeader>Direction</ColumnHeader>
            <ColumnHeader>Source</ColumnHeader>
            <ColumnHeader>Kind</ColumnHeader>
            <ColumnHeader>Raw</ColumnHeader>
            <ColumnHeader>Meaning</ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {props.entries.length === 0 ? (
            <tr>
              <td colSpan={6} style={emptyStyle}>
                (no console lines match the current filters)
              </td>
            </tr>
          ) : (
            props.entries.map((entry) => <TranscriptRow key={entry.id} entry={entry} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeader(props: { readonly children: React.ReactNode }): JSX.Element {
  return <th style={headerCellStyle}>{props.children}</th>;
}

function TranscriptRow(props: { readonly entry: SerialTranscriptEntry }): JSX.Element {
  const entry = props.entry;
  return (
    <tr style={rowStyleFor(entry)}>
      <td style={timeCellStyle} title={new Date(entry.at).toISOString()}>
        {formatTime(entry.at)}
      </td>
      <td style={compactCellStyle}>{entry.direction.toUpperCase()}</td>
      <td style={mutedCellStyle}>{entry.source}</td>
      <td style={mutedCellStyle}>{entry.kind}</td>
      <td style={contentCellStyle}>{entry.raw}</td>
      <td style={decodedCellStyle}>{entry.decoded ?? ''}</td>
    </tr>
  );
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function rowStyleFor(entry: SerialTranscriptEntry): React.CSSProperties {
  if (entry.kind === 'error') return errorRowStyle;
  if (entry.kind === 'alarm') return alarmRowStyle;
  if (entry.direction === 'out') return outboundRowStyle;
  return rowStyle;
}

const scrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 240,
  overflow: 'auto',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 760,
  borderCollapse: 'collapse',
  tableLayout: 'auto',
};
const headerCellStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: '4px 6px',
  borderBottom: '1px solid var(--lf-border-strong)',
  background: 'var(--lf-bg-2)',
  color: 'var(--lf-text-muted)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
const cellStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--lf-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};
const emptyStyle: React.CSSProperties = {
  ...cellStyle,
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};
const rowStyle: React.CSSProperties = {};
const outboundRowStyle: React.CSSProperties = { color: 'var(--lf-accent-fg)' };
const errorRowStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontWeight: 600,
};
const alarmRowStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontWeight: 700,
};
const timeCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: 'var(--lf-text-faint)',
  whiteSpace: 'nowrap',
};
const compactCellStyle: React.CSSProperties = { ...cellStyle, whiteSpace: 'nowrap' };
const mutedCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: 'var(--lf-text-muted)',
  whiteSpace: 'nowrap',
};
const contentCellStyle: React.CSSProperties = {
  ...cellStyle,
  minWidth: 180,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};
const decodedCellStyle: React.CSSProperties = {
  ...contentCellStyle,
  color: 'var(--lf-text-muted)',
};
