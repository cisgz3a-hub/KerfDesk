import type { KeyboardEvent } from 'react';
import { type ConsoleQuickCommand, type ControllerDriver } from '../../../core/controllers';
import {
  consoleQuickCommandDisabledReason,
  type ConsoleCommandAvailabilityState,
} from './console-command-availability';
import { UserMacroPanel } from './user-macros/UserMacroPanel';
import { useConsoleCommandDeckModel } from './use-console-command-deck-model';

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
      <UserMacroPanel
        sending={model.sending}
        inputDisabled={model.inputDisabled}
        onRun={(command, macro) =>
          model.send(command, false, {
            kind: 'user-macro',
            macroName: macro.name,
            macroTemplate: macro.template,
          })
        }
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
