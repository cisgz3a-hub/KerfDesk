import { useState, type KeyboardEvent } from 'react';
import { selectControllerDriver, type ControllerDriver } from '../../../core/controllers';
import type { ConsoleCommandProvenance } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import {
  consoleCommandDisabledReason,
  type ConsoleCommandAvailabilityState,
} from './console-command-availability';
import {
  createConsoleCommandHistory,
  navigateConsoleCommandHistory,
  recordSuccessfulConsoleCommand,
} from './console-command-history';
import { runConsoleCommand } from './run-console-command';

type ConsoleCommandSendMode =
  | { readonly kind: 'manual-draft' }
  | { readonly kind: 'quick-command' }
  | { readonly kind: 'user-macro'; readonly provenance: ConsoleCommandProvenance };

type ConsoleCommandDeckModel = {
  readonly availabilityState: ConsoleCommandAvailabilityState;
  readonly command: string;
  readonly driver: ControllerDriver;
  readonly error: string | null;
  readonly isSending: boolean;
  readonly sendDisabledReason: string | null;
  readonly isInputDisabled: boolean;
  readonly send: (input: string, mode: ConsoleCommandSendMode) => Promise<void>;
  readonly handleHistoryKey: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly changeCommand: (value: string) => void;
};

/**
 * Builds the shared Console command-deck model, including optional successful-command history and
 * the callback invoked after the existing Console transport accepts a command.
 */
export function useConsoleCommandDeckModel(
  enableHistory: boolean,
  onCommandSent: ((command: string) => void) | undefined,
): ConsoleCommandDeckModel {
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
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendDisabledReason = consoleCommandDisabledReason(driver, command, availabilityState);

  const send = async (input: string, mode: ConsoleCommandSendMode): Promise<void> => {
    if (isSending) return;
    setIsSending(true);
    setError(null);
    const provenance = mode.kind === 'user-macro' ? mode.provenance : undefined;
    const result = await runConsoleCommand(driver, input, sendConsoleCommand, provenance);
    setIsSending(false);
    if (result.status === 'sent') {
      setHistory((current) => recordSuccessfulConsoleCommand(current, result.command));
      if (mode.kind === 'manual-draft') {
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
    isSending,
    sendDisabledReason,
    isInputDisabled: connection.kind !== 'connected' || !driver.capabilities.console,
    send,
    handleHistoryKey,
    changeCommand: (value: string) => {
      setCommand(value);
      setHistory((current) => ({ ...current, cursor: null, draft: '' }));
      setError(null);
    },
  };
}
