import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  isActiveJob,
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
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  if (hasPendingControllerWrite(state)) {
    return 'Wait for the previous controller write and acknowledgement before reading machine settings.';
  }
  if (state.statusReport?.state !== 'Idle') {
    return 'Controller must report Idle before reading machine settings.';
  }
  const controllerOperationMessage = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationMessage !== null) return controllerOperationMessage;
  if (state.autofocusBusy) {
    return 'Auto-focus is running. Wait for it to finish before reading machine settings.';
  }
  if (options.settingsCollectionActive === true) {
    return 'Machine settings are already being read. Wait for the current $$ response to finish.';
  }
  return null;
}
