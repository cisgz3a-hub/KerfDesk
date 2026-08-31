import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  isActiveJob,
  mpgCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';

export type MachineSettingsReadReadinessOptions = {
  /** The collector lives outside Zustand, so the store boundary supplies it. */
  readonly settingsCollectionActive?: boolean;
};

/**
 * Pure presentation of the authoritative machine-settings read gate.
 *
 * UI callers use this before dispatch so a temporarily busy controller is
 * shown as "waiting" instead of creating an expected error/log side effect.
 * The store action calls the same function again and remains authoritative.
 */
export function machineSettingsReadBlockReason(
  state: LaserState,
  options: MachineSettingsReadReadinessOptions = {},
): string | null {
  const transportBlock = machineSettingsTransportBlockReason(state);
  if (transportBlock !== null) return transportBlock;
  const activityBlock = machineSettingsActivityBlockReason(state);
  if (activityBlock !== null) return activityBlock;
  const controllerState = state.statusReport?.state ?? null;
  const exactAlarmEvidence =
    controllerState === 'Alarm' || (controllerState === null && state.alarmCode !== null);
  if (controllerState !== 'Idle' && !exactAlarmEvidence) {
    return 'Controller must report Idle or Alarm before reading machine settings.';
  }
  return machineSettingsOperationBlockReason(state, options);
}

function machineSettingsActivityBlockReason(state: LaserState): string | null {
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  return hasPendingControllerWrite(state)
    ? 'Wait for the previous controller write and acknowledgement before reading machine settings.'
    : null;
}

function machineSettingsOperationBlockReason(
  state: LaserState,
  options: MachineSettingsReadReadinessOptions,
): string | null {
  const operationMessage = controllerOperationCommandBlockMessage(state.controllerOperation);
  if (operationMessage !== null) return operationMessage;
  if (state.autofocusBusy) {
    return 'Auto-focus is running. Wait for it to finish before reading machine settings.';
  }
  if (options.settingsCollectionActive === true) {
    return 'Machine settings are already being read. Wait for the current $$ response to finish.';
  }
  return null;
}

function machineSettingsTransportBlockReason(state: LaserState): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  return mpgCommandBlockMessage(state);
}
