import { useState, type KeyboardEvent } from 'react';
import { selectControllerDriver, type ControllerDriver } from '../../../core/controllers';
import type { ConsoleCommandProvenance } from '../../state/console-command-provenance';
import { useLaserStore } from '../../state';
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

type ConsoleCommandSubmission =
  | { readonly kind: 'manual-draft'; readonly input: string }
  | {
      readonly kind: 'preserve-draft';
      readonly input: string;
      readonly provenance?: ConsoleCommandProvenance;
    };

type ConsoleCommandDeckModel = {
  readonly availabilityState: ConsoleCommandAvailabilityState;
  readonly command: string;
  readonly driver: ControllerDriver;
  readonly error: string | null;
  readonly isSending: boolean;
  readonly sendDisabledReason: string | null;
  readonly isInputDisabled: boolean;
  readonly send: (submission: ConsoleCommandSubmission) => Promise<void>;
  readonly handleHistoryKey: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly changeCommand: (value: string) => void;
};

/** Owns the shared Console draft, history, availability, and one-command dispatch state. */
export function useConsoleCommandDeckModel(
  enableHistory: boolean,
  onCommandSent: ((command: string) => void) | undefined,
): ConsoleCommandDeckModel {
  const connection = useLaserStore((state) => state.connection);
  const activeControllerKind = useLaserStore((state) => state.activeControllerKind);
  const sendConsoleCommand = useLaserStore((state) => state.sendConsoleCommand);
  const driver = selectControllerDriver(activeControllerKind);
  const availabilityState: ConsoleCommandAvailabilityState = {
    connection,
    statusReport: useLaserStore((state) => state.statusReport),
    fireActive: useLaserStore((state) => state.fireActive),
    streamer: useLaserStore((state) => state.streamer),
    motionOperation: useLaserStore((state) => state.motionOperation),
    controllerOperation: useLaserStore((state) => state.controllerOperation),
    autofocusBusy: useLaserStore((state) => state.autofocusBusy),
  };
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState(createConsoleCommandHistory);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendDisabledReason = consoleCommandDisabledReason(driver, command, availabilityState);

  const send = async (submission: ConsoleCommandSubmission): Promise<void> => {
    if (isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const result = await runConsoleCommand(
        driver,
        submission.input,
        sendConsoleCommand,
        submission.kind === 'preserve-draft' ? submission.provenance : undefined,
      );
      if (result.status === 'sent') {
        setHistory((current) => recordSuccessfulConsoleCommand(current, result.command));
        if (submission.kind === 'manual-draft') {
          // A transport write can be slow. Preserve a new draft the operator
          // typed while the submitted command was still in flight.
          setCommand((current) => (current === submission.input ? '' : current));
        }
        onCommandSent?.(result.command);
      } else if (result.status === 'rejected') {
        setError(result.reason);
      }
    } finally {
      setIsSending(false);
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
