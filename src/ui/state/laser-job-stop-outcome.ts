import { cancel as cancelStreamer, wipeInFlight } from '../../core/controllers/grbl';
import { controllerOperationOwner } from './laser-controller-operation';
import { isGrblFamilyDriver } from './laser-disconnect-transaction';
import { quickStopPatch } from './laser-quick-stop';
import { finishedJobStateReset, frameProofReset } from './laser-session-reset';
import { originUnknownAfterControllerReset } from './laser-status-line';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import type { JobStopContext, StopOutcome } from './laser-job-stop';

type StopOutcomeOwner = {
  readonly streamerEpoch: number;
  readonly manualCancelEpoch: number;
  readonly operationOwner: object | null;
};

const QUICK_STOP_LOG =
  '[lf2] Abort quick-stopped the controller (M410): homing and position are unverified until you re-home or re-check the origin.';

export function captureStopOutcomeOwner(context: JobStopContext): StopOutcomeOwner {
  const state = context.get();
  return {
    streamerEpoch: state.streamerEpoch,
    manualCancelEpoch: state.manualMotionCancelEpoch,
    operationOwner:
      state.controllerOperation === null
        ? null
        : controllerOperationOwner(state.controllerOperation),
  };
}

function newerWorkOwnsStopOutcome(state: LaserState, stopped: StopOutcomeOwner): boolean {
  return (
    state.streamerEpoch !== stopped.streamerEpoch ||
    state.manualMotionCancelEpoch !== stopped.manualCancelEpoch ||
    state.motionOperation !== null ||
    state.completedFrame !== null ||
    (state.controllerOperation !== null &&
      controllerOperationOwner(state.controllerOperation) !== stopped.operationOwner)
  );
}

export function applyStopOutcome(
  context: JobStopContext,
  outcome: StopOutcome,
  softReset: string | null,
  stopped: StopOutcomeOwner,
): void {
  const retainedReset = softReset !== null && isGrblFamilyDriver(context.driver());
  context.set((state) => {
    // Reset/cleanup may finish before a delayed hosted-refill release. Never
    // let that older Abort cancel work started after the controls reopened.
    if (retainedReset && newerWorkOwnsStopOutcome(state, stopped)) return {};
    return {
      ...finishedJobStateReset(),
      wcoCache: null,
      accessoryCache: null,
      ...(outcome.airOffSent ? { airAssistOn: false } : {}),
      ...frameProofReset(),
      ...(softReset === null ? {} : originUnknownAfterControllerReset(state)),
      ...quickStopOutcomePatch(state, outcome.quickStop),
      streamer:
        state.streamer === null
          ? state.streamer
          : softReset !== null && !retainedReset
            ? wipeInFlight(cancelStreamer(state.streamer))
            : cancelStreamer(state.streamer),
      ...liveCanvasLifecyclePatch(state, 'stopped'),
    };
  });
}

function quickStopOutcomePatch(
  state: LaserState,
  quickStop: StopOutcome['quickStop'],
): Partial<LaserState> {
  if (quickStop === 'none') return {};
  return {
    ...quickStopPatch(state),
    ...(quickStop === 'sent' ? { log: pushLog(state, QUICK_STOP_LOG) } : {}),
  };
}
