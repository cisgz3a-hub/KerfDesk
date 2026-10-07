import {
  failedControllerQualificationPatch,
  qualifyingController,
} from './laser-controller-qualification';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

export function controllerHandshakeFailurePatch(
  state: LaserState,
  expectedEpoch: number,
  error: unknown,
): Partial<LaserState> {
  if (state.controllerSessionEpoch !== expectedEpoch) return {};
  const message = error instanceof Error ? error.message : String(error);
  if (handshakeIsWaitingForIdle(state, message)) {
    return {
      controllerQualification: qualifyingController(expectedEpoch, 'controller-response'),
      log: pushLog(state, '[lf2] Waiting for Idle before reading controller information.'),
    };
  }
  return {
    ...failedControllerQualificationPatch(state, expectedEpoch, message),
    lastWriteError: message,
    log: pushLog(state, `[lf2] Controller handshake failed: ${message}`),
  };
}

function handshakeIsWaitingForIdle(state: LaserState, message: string): boolean {
  const qualification = state.controllerQualification;
  return (
    qualification.kind === 'qualifying' &&
    qualification.phase !== 'settings-read' &&
    ['Alarm', 'Sleep', 'Run', 'Hold', 'Door'].includes(state.statusReport?.state ?? '') &&
    (message === 'Timed out waiting for fresh Idle.' ||
      /^Controller entered (Alarm|Sleep)\.$/.test(message))
  );
}
