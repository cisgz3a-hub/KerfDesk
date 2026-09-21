import type { LiveCanvasRun } from './canvas-motion-plan';
import { type LaserState, useLaserStore } from './laser-store';

/** The immutable plan and start stamp identify one display across status polls. */
export type CompletedJobDisplayIdentity = Pick<LiveCanvasRun, 'plan' | 'startedAtMs'>;

/** A final line acknowledgement or the first Idle alone is not completion. */
export function completedJobCanBeDismissed(state: LaserState): boolean {
  const run = state.liveCanvasRun;
  return (
    run?.lifecycle === 'finished' &&
    run.timing?.kind === 'complete' &&
    state.streamer === null &&
    state.statusReport?.state === 'Idle' &&
    !hasDisplayBlockingOperation(state) &&
    !hasControllerFault(state)
  );
}

function hasDisplayBlockingOperation(state: LaserState): boolean {
  return (
    state.controllerOperation !== null ||
    state.motionOperation !== null ||
    state.pauseResumeTransition !== null ||
    state.autofocusBusy ||
    state.probeBusy ||
    state.fireActive
  );
}

function hasControllerFault(state: LaserState): boolean {
  return (
    state.alarmCode !== null ||
    state.lastError !== null ||
    state.lastWriteError !== null ||
    state.safetyNotice !== null
  );
}

/** Display-only acknowledgement. Never changes the project, controller, Frame
 * evidence, compiled plan, or recovery repository. Recheck at the click boundary
 * so a stale Done button cannot erase a newer run or its unfinished status. */
export function dismissCompletedJobDisplay(expected: CompletedJobDisplayIdentity): boolean {
  let dismissed = false;
  useLaserStore.setState((state) => {
    const run = state.liveCanvasRun;
    if (
      !completedJobCanBeDismissed(state) ||
      run?.plan !== expected.plan ||
      run.startedAtMs !== expected.startedAtMs
    ) {
      return state;
    }
    dismissed = true;
    return { liveCanvasRun: null };
  });
  return dismissed;
}
