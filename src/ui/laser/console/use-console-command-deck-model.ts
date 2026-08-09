import { useState, type KeyboardEvent } from 'react';
import { selectControllerDriver } from '../../../core/controllers';
import type { ConsoleCommandProvenance } from '../../state/console-command-provenance';
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

export function useConsoleCommandDeckModel(
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

  const send = async (
    input: string,
    shouldClearInput: boolean,
    provenance?: ConsoleCommandProvenance,
  ): Promise<void> => {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await runConsoleCommand(driver, input, sendConsoleCommand, provenance);
    setSending(false);
    if (result.status === 'sent') {
      setHistory((current) => recordSuccessfulConsoleCommand(current, result.command));
      if (shouldClearInput) {
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
