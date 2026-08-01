import { currentPauseResumeTransportFence } from './laser-pause-resume-transition';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

type PauseResumeFailureContext = {
  readonly set: SetFn;
  readonly get: () => LaserState;
  readonly refs: PostJobSettleRefs;
};

const ACTIVE_TRANSITION_MESSAGE = 'Pause or Resume is already waiting for controller confirmation.';
const PENDING_TRANSPORT_MESSAGE =
  'The previous Pause or Resume transport write is still settling. Keep the job frozen; retry only after it settles. Use ABORT JOB or the physical E-stop if the machine is unsafe.';
const REJECTED_TRANSPORT_MESSAGE =
  'The previous Pause or Resume controller write was rejected with acceptance unknown. Keep the stream stopped and use ABORT JOB or the physical E-stop; do not retry on this connection.';

export function assertNoPauseResumeTransition(context: PauseResumeFailureContext): void {
  const transportFence = currentPauseResumeTransportFence(context.refs);
  if (
    context.refs.controllerStatusWait == null &&
    context.refs.pauseResumeTransition == null &&
    transportFence === null
  ) {
    return;
  }
  throw recordPauseResumeConfirmationFailure(
    context,
    transportFence === 'rejected'
      ? REJECTED_TRANSPORT_MESSAGE
      : transportFence === 'settling'
        ? PENDING_TRANSPORT_MESSAGE
        : ACTIVE_TRANSITION_MESSAGE,
  );
}

export function reportedPauseResumeFailure(
  context: PauseResumeFailureContext,
  error: unknown,
): unknown {
  if (currentPauseResumeTransportFence(context.refs) !== 'rejected') return error;
  return context.get().lastWriteError ?? error;
}

export function recordPauseResumeConfirmationFailure(
  context: PauseResumeFailureContext,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error);
  context.set({
    lastWriteError: message,
    log: pushLog(context.get(), `[lf2] Controller status confirmation failed: ${message}`),
  });
  return error instanceof Error ? error : new Error(message);
}
