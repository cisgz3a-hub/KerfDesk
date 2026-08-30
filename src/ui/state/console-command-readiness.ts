import type { PreparedConsoleCommand } from '../../core/controllers/grbl';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import type { LaserState } from './laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  UNKNOWN_IDLE_STATUS_MESSAGE,
  isActiveJob,
  mpgCommandBlockMessage,
} from './laser-store-helpers';

const CONSOLE_RESET_COMMANDS = new Set<string>(['M112', 'M999']);
const CONSOLE_FAIL_OFF_SEQUENCE_PATTERN = /^(?:M5|M9)(?:\s+(?:M5|M9))*$/;

/** Returns the factual transport or operation precondition blocking a console command. */
export function consoleCommandBlockReason(
  state: LaserState,
  command: Pick<
    PreparedConsoleCommand,
    'kind' | 'normalized' | 'requiresIdle' | 'requiresNoActiveOperation' | 'stateEffect'
  >,
  checkIdle: boolean,
): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  const recoveryCommand = isConsoleRecoveryCommand(command);
  if (consoleCommandRequiresMpgRelease(command)) {
    const mpgBlock = mpgCommandBlockMessage(state);
    if (mpgBlock !== null) return mpgBlock;
  }
  const operationBlock = consoleOperationBlockForCommand(state, command, recoveryCommand);
  if (operationBlock !== null) return operationBlock;
  if (!checkIdle || !command.requiresIdle || recoveryCommand) return null;
  if (state.statusReport === null) return UNKNOWN_IDLE_STATUS_MESSAGE;
  return state.statusReport.state === 'Idle'
    ? null
    : `Machine must be Idle before sending this console command (currently ${state.statusReport.state}).`;
}

function consoleOperationBlockForCommand(
  state: LaserState,
  command: Pick<PreparedConsoleCommand, 'requiresNoActiveOperation'>,
  recoveryCommand: boolean,
): string | null {
  // A known MPG takeover pauses host refill, so exact recovery/fail-off traffic
  // can bypass the app-operation fence without later queued lines undoing it.
  // Normal app-owned streaming retains the existing operation exclusion.
  if (recoveryCommand && state.mpgActive === true) return null;
  return command.requiresNoActiveOperation ? consoleOperationBlockReason(state) : null;
}

/** Identifies console commands that need a fresh same-session Idle observation. */
export function consoleCommandNeedsFreshIdle(command: PreparedConsoleCommand): boolean {
  return command.requiresIdle && !isConsoleRecoveryCommand(command);
}

function consoleOperationBlockReason(state: LaserState): string | null {
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  const controllerOperationMessage = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationMessage !== null) return controllerOperationMessage;
  return state.autofocusBusy
    ? 'Auto-focus is running. Wait for it to finish before sending console commands.'
    : null;
}

function consoleCommandRequiresMpgRelease(
  command: Pick<PreparedConsoleCommand, 'kind' | 'stateEffect' | 'normalized'>,
): boolean {
  if (command.kind === 'settings-query') return true;
  if (command.stateEffect === 'read-only') return false;
  return !isConsoleRecoveryCommand(command);
}

function isConsoleRecoveryCommand(
  command: Pick<PreparedConsoleCommand, 'kind' | 'normalized'>,
): boolean {
  if (command.kind === 'unlock') return true;
  const normalized = command.normalized.trim().toUpperCase();
  if (CONSOLE_RESET_COMMANDS.has(normalized)) return true;
  return CONSOLE_FAIL_OFF_SEQUENCE_PATTERN.test(normalized);
}
