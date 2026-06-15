import { useMemo, useState } from 'react';
import { prepareConsoleCommand } from '../../core/controllers/grbl';
import { helpProps } from '../help/help-topics';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import type { SerialTranscriptEntry } from '../state/laser-transcript';

const QUICK_COMMANDS = ['$X', '$$', '$#', '$I', '$G', '?'] as const;
type QuickCommand = (typeof QUICK_COMMANDS)[number];

export function ConsolePanel(): JSX.Element {
  const transcript = useLaserStore((s) => s.transcript);
  const connection = useLaserStore((s) => s.connection);
  const statusReport = useLaserStore((s) => s.statusReport);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const sendConsoleCommand = useLaserStore((s) => s.sendConsoleCommand);
  const clearTranscript = useLaserStore((s) => s.clearTranscript);
  const [showStatus, setShowStatus] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [command, setCommand] = useState('');
  const visible = useMemo(
    () => visibleEntries(transcript, { showStatus, showStream }),
    [transcript, showStatus, showStream],
  );
  const disconnected = connection.kind !== 'connected';
  const activeOperationReason =
    (isActiveJob(streamer) && 'A job is active. Press Stop before sending console commands.') ||
    (motionOperation !== null &&
      'A jog or frame operation is active. Wait for it to finish before sending console commands.') ||
    (autofocusBusy &&
      'Auto-focus is active. Wait for it to finish before sending console commands.') ||
    null;
  const sendDisabledReason = consoleCommandDisabledReason(command, {
    disconnected,
    activeOperationReason,
    machineState: statusReport?.state ?? null,
  });
  const sendHelp = helpProps('control:laser.console.send', sendDisabledReason ?? undefined);
  const inputHelp = helpProps('control:laser.console.input', sendDisabledReason ?? undefined);

  const handleSend = (): void => {
    const input = command.trim();
    if (input === '') return;
    if (!confirmIfNeeded(input)) return;
    void sendConsoleCommand(input, confirmedOptions(input)).then(() => setCommand(''));
  };

  const handleCopy = (): void => {
    const text = visible.map(formatTranscriptLine).join('\n');
    void navigator.clipboard?.writeText(text);
  };

  return (
    <section style={panelStyle} aria-label="GRBL console" {...helpProps('control:laser.console')}>
      <ConsoleHeader
        visibleCount={visible.length}
        transcriptCount={transcript.length}
        onCopy={handleCopy}
        onClear={clearTranscript}
      />
      <QuickCommandRow
        disconnected={disconnected}
        activeOperationReason={activeOperationReason}
        onSend={sendConsoleCommand}
      />
      <ConsoleFilters
        showStatus={showStatus}
        showStream={showStream}
        onShowStatus={setShowStatus}
        onShowStream={setShowStream}
      />
      <ConsoleTranscript visible={visible} />
      <ConsoleCommandForm
        command={command}
        disconnected={disconnected}
        sendDisabledReason={sendDisabledReason}
        inputHelp={inputHelp}
        sendHelp={sendHelp}
        onCommandChange={setCommand}
        onSend={handleSend}
      />
    </section>
  );
}

function ConsoleHeader(props: {
  readonly visibleCount: number;
  readonly transcriptCount: number;
  readonly onCopy: () => void;
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
          disabled={props.visibleCount === 0}
          title={copyHelp.title}
          data-help-id={copyHelp['data-help-id']}
        >
          Copy visible
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

function QuickCommandRow(props: {
  readonly disconnected: boolean;
  readonly activeOperationReason: string | null;
  readonly onSend: (command: string) => Promise<void>;
}): JSX.Element {
  return (
    <div style={quickStyle}>
      {QUICK_COMMANDS.map((quick) => {
        const quickHelp = quickHelpProps(quick, props.disconnected, props.activeOperationReason);
        return (
          <button
            key={quick}
            type="button"
            onClick={() => void props.onSend(quick)}
            disabled={quickDisabled(quick, props.disconnected, props.activeOperationReason)}
            title={quickHelp.title}
            data-help-id={quickHelp['data-help-id']}
          >
            {quick}
          </button>
        );
      })}
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
      <label title="Show periodic GRBL status report replies like <Idle|...>.">
        <input
          type="checkbox"
          checked={props.showStatus}
          onChange={(e) => props.onShowStatus(e.target.checked)}
          title="Show periodic GRBL status report replies like <Idle|...>."
        />
        Show status
      </label>
      <label title="Show high-volume job stream writes that are hidden by default.">
        <input
          type="checkbox"
          checked={props.showStream}
          onChange={(e) => props.onShowStream(e.target.checked)}
          title="Show high-volume job stream writes that are hidden by default."
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
            {entry.decoded !== undefined ? <span style={decodedStyle}>{entry.decoded}</span> : null}
          </div>
        ))
      )}
    </div>
  );
}

function ConsoleCommandForm(props: {
  readonly command: string;
  readonly disconnected: boolean;
  readonly sendDisabledReason: string | null;
  readonly inputHelp: ReturnType<typeof helpProps>;
  readonly sendHelp: ReturnType<typeof helpProps>;
  readonly onCommandChange: (value: string) => void;
  readonly onSend: () => void;
}): JSX.Element {
  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSend();
      }}
    >
      <input
        aria-label="Console command"
        value={props.command}
        onChange={(e) => props.onCommandChange(e.target.value)}
        placeholder="$I, $$, $G, G0 X0 Y0..."
        disabled={props.disconnected}
        title={props.inputHelp.title}
        data-help-id={props.inputHelp['data-help-id']}
      />
      <button
        type="submit"
        disabled={props.sendDisabledReason !== null}
        title={props.sendHelp.title}
        data-help-id={props.sendHelp['data-help-id']}
      >
        Send
      </button>
    </form>
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

function confirmIfNeeded(input: string): boolean {
  const prepared = prepareConsoleCommand(input);
  if (!prepared.ok || !prepared.command.requiresConfirmation) return true;
  return jobAwareConfirm(`Send persistent GRBL setting?\n\n${prepared.command.normalized}`);
}

function confirmedOptions(input: string): { readonly confirmed: true } | undefined {
  const prepared = prepareConsoleCommand(input);
  return prepared.ok && prepared.command.requiresConfirmation ? { confirmed: true } : undefined;
}

function quickDisabled(
  command: QuickCommand,
  disconnected: boolean,
  activeOperationReason: string | null,
): boolean {
  if (disconnected) return true;
  return command !== '?' && activeOperationReason !== null;
}

function quickHelpProps(
  command: QuickCommand,
  disconnected: boolean,
  activeOperationReason: string | null,
): ReturnType<typeof helpProps> {
  const disabledReason = disconnected
    ? 'Connect to the laser before sending console commands.'
    : activeOperationReason;
  return helpProps(`control:laser.console.quick.${command}`, disabledReason ?? undefined);
}

function consoleCommandDisabledReason(
  input: string,
  state: {
    readonly disconnected: boolean;
    readonly activeOperationReason: string | null;
    readonly machineState: string | null;
  },
): string | null {
  if (state.disconnected) return 'Connect to the laser before sending console commands.';
  const trimmed = input.trim();
  if (trimmed === '') return 'Enter one command before sending.';
  const prepared = prepareConsoleCommand(trimmed);
  if (!prepared.ok) return prepared.reason;
  if (prepared.command.requiresNoActiveOperation && state.activeOperationReason !== null) {
    return state.activeOperationReason;
  }
  if (!prepared.command.requiresIdle) return null;
  if (state.machineState === null) return 'Wait for an Idle status report before sending.';
  if (state.machineState !== 'Idle') {
    return `Machine must be Idle before sending this command (currently ${state.machineState}).`;
  }
  return null;
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
const quickStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '0 6px',
  flexWrap: 'wrap',
};
const toggleRowStyle: React.CSSProperties = { display: 'flex', gap: 10, padding: '0 6px' };
const scrollStyle: React.CSSProperties = {
  maxHeight: 180,
  minHeight: 90,
  overflowY: 'auto',
  padding: '4px 6px',
  fontFamily: 'ui-monospace, Menlo, monospace',
};
const formStyle: React.CSSProperties = { display: 'flex', gap: 4, padding: '0 6px 6px' };
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
