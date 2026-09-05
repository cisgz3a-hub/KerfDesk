import { useMemo, useState } from 'react';
import { helpProps } from '../help/help-topics';
import { useLaserStore } from '../state/laser-store';
import type { SerialTranscriptEntry } from '../state/laser-transcript';
import { ConsoleCommandDeck } from './console/ConsoleCommandDeck';
import { useTranscriptCopy } from './console/use-transcript-copy';

export function ConsolePanel(): JSX.Element {
  const transcript = useLaserStore((state) => state.transcript);
  const clearTranscript = useLaserStore((state) => state.clearTranscript);
  const [showStatus, setShowStatus] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const { copyState, manualText, copy, reset } = useTranscriptCopy();
  const visible = useMemo(
    () => visibleEntries(transcript, { showStatus, showStream }),
    [transcript, showStatus, showStream],
  );

  return (
    <section style={panelStyle} aria-label="GRBL console" {...helpProps('control:laser.console')}>
      <ConsoleHeader
        visibleCount={visible.length}
        transcriptCount={transcript.length}
        onCopy={() => void copy(visible.map(formatTranscriptLine).join('\n'))}
        copyState={copyState}
        onClear={() => {
          reset();
          clearTranscript();
        }}
      />
      <ConsoleFilters
        showStatus={showStatus}
        showStream={showStream}
        onShowStatus={(value) => {
          reset();
          setShowStatus(value);
        }}
        onShowStream={(value) => {
          reset();
          setShowStream(value);
        }}
      />
      <ConsoleTranscript visible={visible} />
      {copyState === 'manual' ? (
        <label>
          Clipboard access failed. Select and copy this transcript manually.
          <textarea
            readOnly
            aria-label="Console transcript to copy manually"
            title="Select this transcript and copy it manually."
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: '100%', minHeight: 90, boxSizing: 'border-box' }}
          />
        </label>
      ) : null}
      <div style={commandDeckWrapStyle}>
        <ConsoleCommandDeck enableHistory={false} ariaLabel="Docked console commands" />
      </div>
    </section>
  );
}

function ConsoleHeader(props: {
  readonly visibleCount: number;
  readonly transcriptCount: number;
  readonly onCopy: () => void;
  readonly copyState: 'idle' | 'copying' | 'copied' | 'manual';
  readonly onClear: () => void;
}): JSX.Element {
  const copyHelp = helpProps('control:laser.console.copy');
  const clearHelp = helpProps('control:laser.console.clear');
  return (
    <div style={headerStyle}>
      <span style={titleStyle}>Console</span>
      <div style={headerButtonsStyle}>
        <button
          type="button"
          onClick={props.onCopy}
          disabled={props.visibleCount === 0 || props.copyState === 'copying'}
          title={copyHelp.title}
          data-help-id={copyHelp['data-help-id']}
        >
          {props.copyState === 'copied'
            ? 'Copied'
            : props.copyState === 'copying'
              ? 'Copying…'
              : 'Copy visible'}
        </button>
        <button
          type="button"
          onClick={props.onClear}
          disabled={props.transcriptCount === 0}
          title={clearHelp.title}
          data-help-id={clearHelp['data-help-id']}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function ConsoleFilters(props: {
  readonly showStatus: boolean;
  readonly showStream: boolean;
  readonly onShowStatus: (value: boolean) => void;
  readonly onShowStream: (value: boolean) => void;
}): JSX.Element {
  return (
    <div style={toggleRowStyle}>
      <label title="Show periodic controller status reports.">
        <input
          type="checkbox"
          title="Show periodic controller status reports."
          checked={props.showStatus}
          onChange={(event) => props.onShowStatus(event.target.checked)}
        />
        Show status
      </label>
      <label title="Show high-volume job stream writes that are hidden by default.">
        <input
          type="checkbox"
          title="Show high-volume job stream writes that are hidden by default."
          checked={props.showStream}
          onChange={(event) => props.onShowStream(event.target.checked)}
        />
        Show stream
      </label>
    </div>
  );
}

function ConsoleTranscript(props: {
  readonly visible: ReadonlyArray<SerialTranscriptEntry>;
}): JSX.Element {
  return (
    <div style={scrollStyle} role="log" aria-live="polite">
      {props.visible.length === 0 ? (
        <div style={emptyStyle}>(connect to a controller to see console traffic)</div>
      ) : (
        props.visible.slice(-150).map((entry) => (
          <div key={entry.id} style={rowStyleFor(entry)}>
            <span style={badgeStyle}>{entry.direction.toUpperCase()}</span>
            <span style={kindStyle}>{entry.kind}</span>
            <span style={rawStyle}>{entry.raw}</span>
            {entry.decoded === undefined ? null : <span style={decodedStyle}>{entry.decoded}</span>}
          </div>
        ))
      )}
    </div>
  );
}

function visibleEntries(
  entries: ReadonlyArray<SerialTranscriptEntry>,
  filters: { readonly showStatus: boolean; readonly showStream: boolean },
): ReadonlyArray<SerialTranscriptEntry> {
  return entries.filter((entry) => {
    if (!filters.showStatus && entry.kind === 'status') return false;
    if (!filters.showStream && entry.source === 'job') return false;
    if (!filters.showStatus && entry.source === 'poll') return false;
    return true;
  });
}

function formatTranscriptLine(entry: SerialTranscriptEntry): string {
  const decoded = entry.decoded === undefined ? '' : ` ${entry.decoded}`;
  return `${entry.direction} ${entry.kind} ${entry.raw}${decoded}`;
}

function rowStyleFor(entry: SerialTranscriptEntry): React.CSSProperties {
  if (entry.kind === 'error') return errorRowStyle;
  if (entry.kind === 'alarm') return alarmRowStyle;
  if (entry.direction === 'out') return outboundRowStyle;
  return rowStyle;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 6px',
  borderBottom: '1px solid var(--lf-border)',
};
const titleStyle: React.CSSProperties = { fontWeight: 700 };
const headerButtonsStyle: React.CSSProperties = { display: 'flex', gap: 4 };
const toggleRowStyle: React.CSSProperties = { display: 'flex', gap: 10, padding: '0 6px' };
const scrollStyle: React.CSSProperties = {
  maxHeight: 180,
  minHeight: 90,
  overflowY: 'auto',
  padding: '4px 6px',
  fontFamily: 'ui-monospace, Menlo, monospace',
};
const commandDeckWrapStyle: React.CSSProperties = { padding: '0 6px 6px' };
const emptyStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontStyle: 'italic' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 5, whiteSpace: 'pre-wrap' };
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
const badgeStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', minWidth: 28 };
const kindStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', minWidth: 80 };
const rawStyle: React.CSSProperties = { flex: 1 };
const decodedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
