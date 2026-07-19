import type { ControllerDriver } from '../../../core/controllers';
import { controllerOperationCommandBlockMessage } from '../../state/laser-controller-operation';
import type { LaserState } from '../../state/laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  UNKNOWN_IDLE_STATUS_MESSAGE,
  isActiveJob,
} from '../../state/laser-store-helpers';

export type ConsoleCommandAvailabilityState = Pick<
  LaserState,
  | 'connection'
  | 'statusReport'
  | 'fireActive'
  | 'streamer'
  | 'motionOperation'
  | 'controllerOperation'
  | 'autofocusBusy'
>;

/**
 * Mirrors the visible part of the store's console safety gate. The store
 * remains authoritative and re-checks every command immediately before the
 * serial write, so a state change between render and click still fails closed.
 */
export function consoleCommandDisabledReason(
  driver: ControllerDriver,
  input: string,
  state: ConsoleCommandAvailabilityState,
): string | null {
  if (state.connection.kind !== 'connected') {
    return 'Connect to the laser before sending console commands.';
  }

  const prepared = driver.prepareConsoleCommand(input);
  if (!prepared.ok) return prepared.reason;

  if (prepared.command.requiresNoActiveOperation) {
    const operationReason = consoleActiveOperationReason(state);
    if (operationReason !== null) return operationReason;
  }

  if (!prepared.command.requiresIdle) return null;
  if (state.statusReport === null) return UNKNOWN_IDLE_STATUS_MESSAGE;
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle before sending this console command (currently ${state.statusReport.state}).`;
  }
  return null;
}

/** Use the driver's parsed command metadata for quick-command availability. */
export function consoleQuickCommandDisabledReason(
  driver: ControllerDriver,
  command: string,
  state: ConsoleCommandAvailabilityState,
): string | null {
  return consoleCommandDisabledReason(driver, command, state);
}

export function consoleActiveOperationReason(
  state: Pick<
    ConsoleCommandAvailabilityState,
    'fireActive' | 'streamer' | 'motionOperation' | 'controllerOperation' | 'autofocusBusy'
  >,
): string | null {
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  const controllerOperationReason = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationReason !== null) return controllerOperationReason;
  if (state.autofocusBusy) {
    return 'Auto-focus is running. Wait for it to finish before sending console commands.';
  }
  return null;
}
