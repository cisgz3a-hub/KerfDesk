import type { StreamerStatus } from '../../core/controllers/grbl';
import { hasOwnedControllerReset } from './laser-reset-cleanup';
import type { LaserState } from './laser-store';
import {
  isTerminalCanvasLifecycle,
  liveCanvasTimingUnavailablePatch,
} from './live-canvas-run-timing';

/** The errored sender here is a host refill freeze, not yet a terminal cause.
 * Accepted Abort, an actual close or a real fault supplies that cause. */
export function isProvisionalResetFreeze(
  state: LaserState,
  status: StreamerStatus | undefined = state.streamer?.status,
): boolean {
  return (
    status === 'errored' &&
    hasOwnedControllerReset(state.controllerOperation) &&
    (state.safetyNotice === null || state.safetyNotice.kind === 'cnc-transition-unconfirmed')
  );
}

/** Repeated resets cannot revise an already recorded terminal display. */
export function provisionalResetCanvasPatch(
  state: LaserState,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  return run === null || isTerminalCanvasLifecycle(run.lifecycle)
    ? {}
    : liveCanvasTimingUnavailablePatch(state, 'Controller stop is awaiting its outcome.');
}
