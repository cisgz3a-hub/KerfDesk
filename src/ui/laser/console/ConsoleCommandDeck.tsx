import { useState, type KeyboardEvent } from 'react';
import {
  selectControllerDriver,
  type ConsoleQuickCommand,
  type ControllerDriver,
} from '../../../core/controllers';
import { useLaserStore } from '../../state/laser-store';
import {
  consoleCommandDisabledReason,
  consoleQuickCommandDisabledReason,
  type ConsoleCommandAvailabilityState,
} from './console-command-availability';
import {
  createConsoleCommandHistory,
  navigateConsoleCommandHistory,
  recordSuccessfulConsoleCommand,
} from './console-command-history';
import { runConsoleCommand } from './run-console-command';

export type ConsoleCommandDeckProps = {
  readonly ariaLabel?: string;
  readonly autoFocus?: boolean;
  readonly enableHistory?: boolean;
  readonly showQuickCommands?: boolean;
  readonly onCommandSent?: (command: string) => void;
};

export function ConsoleCommandDeck({
  ariaLabel = 'Console commands',
  autoFocus = false,
  enableHistory = true,
  showQuickCommands = true,
  onCommandSent,
}: ConsoleCommandDeckProps): JSX.Element {
  const model = useConsoleCommandDeckModel(enableHistory, onCommandSent);
  return (
    <section aria-label={ariaLabel} style={deckStyle}>
      {showQuickCommands && model.driver.consoleQuickCommands.length > 0 ? (
        <QuickCommandRow
          quickCommands={model.driver.consoleQuickCommands}
          driver={model.driver}
          availabilityState={model.availabilityState}
          sending={model.sending}
          onSend={(command) => void model.send(command, false)}
        />
      ) : null}
      <ConsoleCommandForm
        autoFocus={autoFocus}
        command={model.command}
        inputDisabled={model.inputDisabled}
        sending={model.sending}
        sendDisabledReason={model.sendDisabledReason}
        onChange={model.changeCommand}
        onHistoryKey={model.handleHistoryKey}
        onSend={() => void model.send(model.command, true)}
      />
      {model.error !== null ? (
        <div role="alert" style={errorStyle}>
          {model.error}
        </div>
      ) : null}
      {enableHistory ? (
        <div style={hintStyle}>
          Use Arrow Up and Arrow Down to recall successfully sent commands.
        </div>
      ) : null}
    </section>
  );
}

function useConsoleCommandDeckModel(
  enableHistory: boolean,
  onCommandSent: ((command: string) => void) | undefined,
) {
  const connection = useLaserStore((state) => state.connection);
  const statusReport = useLaserStore((state) => state.statusReport);
  const fireActive = useLaserStore((state) => state.fireActive);
  const streamer = useLaserStore((state) => state.streamer);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const autofocusBusy = useLaserStore((state) => state.autofocusBusy);
  const activeControllerKind = useLaserStore((state) => state.activeControllerKind);
  const sendConsoleCommand = useLaserStore((state) => state.sendConsoleCommand);
  const driver = selectControllerDriver(activeControllerKind);
  const availabilityState: ConsoleCommandAvailabilityState = {
    connection,
    statusReport,
    fireActive,
    streamer,
    motionOperation,
    controllerOperation,
    autofocusBusy,
  };
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState(createConsoleCommandHistory);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendDisabledReason = consoleCommandDisabledReason(driver, command, availabilityState);

  const send = async (input: string, clearInput: boolean): Promise<void> => {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await runConsoleCommand(driver, input, sendConsoleCommand);
    setSending(false);
    if (result.status === 'sent') {
      setHistory((current) => recordSuccessfulConsoleCommand(current, result.command));
      if (clearInput) {
        // A transport write can be slow. Preserve a new draft the operator
        // typed while the submitted command was still in flight.
        setCommand((current) => (current === input ? '' : current));
      }
      onCommandSent?.(result.command);
    } else if (result.status === 'rejected') {
      setError(result.reason);
    }
  };

  const handleHistoryKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!enableHistory || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const navigation = navigateConsoleCommandHistory(
      history,
      command,
      event.key === 'ArrowUp' ? 'older' : 'newer',
    );
    if (!navigation.handled) return;
    event.preventDefault();
    setHistory(navigation.history);
    setCommand(navigation.value);
    setError(null);
  };

  return {
    availabilityState,
    command,
    driver,
    error,
    sending,
    sendDisabledReason,
    inputDisabled: connection.kind !== 'connected' || !driver.capabilities.console,
    send,
    handleHistoryKey,
    changeCommand: (value: string) => {
      setCommand(value);
      setHistory((current) => ({ ...current, cursor: null, draft: '' }));
      setError(null);
    },
  };
}

function QuickCommandRow(props: {
  readonly quickCommands: ReadonlyArray<ConsoleQuickCommand>;
  readonly driver: ControllerDriver;
  readonly availabilityState: ConsoleCommandAvailabilityState;
  readonly sending: boolean;
  readonly onSend: (command: string) => void;
}): JSX.Element {
  return (
    <div style={quickRowStyle} aria-label="Quick console commands">
      {props.quickCommands.map((quick) => {
        const disabledReason = consoleQuickCommandDisabledReason(
          props.driver,
          quick.command,
          props.availabilityState,
        );
        return (
          <button
            key={quick.command}
            type="button"
            disabled={props.sending || disabledReason !== null}
            title={disabledReason ?? quick.hint}
            onClick={() => props.onSend(quick.command)}
          >
            {quick.label}
          </button>
        );
      })}
    </div>
  );
}

function ConsoleCommandForm(props: {
  readonly autoFocus: boolean;
  readonly command: string;
  readonly inputDisabled: boolean;
  readonly sending: boolean;
  readonly sendDisabledReason: string | null;
  readonly onChange: (value: string) => void;
  readonly onHistoryKey: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onSend: () => void;
}): JSX.Element {
  return (
    <form
      style={formStyle}
      onSubmit={(event) => {
        event.preventDefault();
        if (props.sendDisabledReason === null) props.onSend();
      }}
    >
      <input
        aria-label="Console command"
        autoFocus={props.autoFocus}
        value={props.command}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onHistoryKey}
        placeholder="$I, $$, $G, G0 X0 Y0..."
        disabled={props.inputDisabled}
        title={props.sendDisabledReason ?? 'Send one controller command.'}
        style={inputStyle}
      />
      <button
        type="submit"
        disabled={props.sending || props.sendDisabledReason !== null}
        title={
          props.sending
            ? 'Waiting for the command write to finish.'
            : (props.sendDisabledReason ?? '')
        }
      >
        {props.sending ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
}

const deckStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const quickRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};
const formStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const errorStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontSize: 12,
  overflowWrap: 'anywhere',
};
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontSize: 11 };
