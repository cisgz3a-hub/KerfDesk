import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import { isDoorTransitionProgress } from './laser-pause-resume-evidence';
import {
  assertPauseResumeTransitionOwner,
  hasCurrentPauseResumeTransportFence,
  PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS,
  PAUSE_RESUME_TRANSITION_TIMEOUT_MS,
  markPauseResumeTransportWriteRejected,
  refreshPauseResumeTransitionLiveness,
  releasePauseResumeTransportWrite,
  reservePauseResumeTransportWrite,
  type PauseResumeLivenessPolicy,
  type PauseResumeTransitionAction,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import {
  containActiveStreamWriteFailure,
  streamWriteOwner,
} from './laser-stream-heartbeat-containment';

type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

type PauseResumeWriteContext = {
  readonly set: SetFn;
  readonly get?: () => LaserState;
  readonly refs: PostJobSettleRefs;
  readonly safeWrite: SafeWriteFn;
};

type PauseResumeConfirmationContext = PauseResumeWriteContext & {
  readonly get: () => LaserState;
  readonly driver: () => ControllerDriver;
};

type PauseResumeWriteOptions = {
  readonly token: PauseResumeTransitionToken;
  readonly command: string;
  readonly action: PauseResumeTransitionAction;
};

type PauseResumeConfirmationOptions = {
  readonly token: PauseResumeTransitionToken;
  readonly command: string;
  readonly expectedSession: number;
  readonly accept: (report: StatusReport) => boolean;
  readonly timeoutMessage: string;
  readonly action: PauseResumeTransitionAction;
  readonly liveness: PauseResumeLivenessPolicy;
  /** Sees every fresh same-session report after the command write settled. */
  readonly observeFreshReport?: (report: StatusReport) => void;
};

const STATUS_WAIT_TIMEOUT_MS =
  PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS + PAUSE_RESUME_TRANSITION_TIMEOUT_MS;

export async function writeWhilePauseResumeOwner(
  context: PauseResumeWriteContext,
  options: PauseResumeWriteOptions,
): Promise<void> {
  const { token, command, action } = options;
  const writeEpoch = context.refs.writeEpoch ?? 0;
  const writeOwner = context.get === undefined ? null : streamWriteOwner(context.get());
  reservePauseResumeTransportWrite(context.refs, token);
  try {
    try {
      await context.safeWrite(command, action);
    } catch (error) {
      if ((context.refs.writeEpoch ?? 0) === writeEpoch) {
        if (writeOwner !== null) {
          containActiveStreamWriteFailure(
            context.set,
            context.refs,
            context.safeWrite,
            action,
            writeOwner,
          );
        }
        markPauseResumeTransportWriteRejected(context.refs, token);
      }
      throw error;
    }
    assertPauseResumeTransitionOwner(context.refs, token);
  } finally {
    releasePauseResumeTransportWrite(context.refs, token);
    clearSettledPauseResumeUiState(context, token);
  }
}

export async function sendRealtimeAndConfirmPauseResume(
  context: PauseResumeConfirmationContext,
  options: PauseResumeConfirmationOptions,
): Promise<void> {
  const { token, command, expectedSession, accept, timeoutMessage, action, liveness } = options;
  const trackCncDoorProgress = liveness === 'cnc-door';
  assertExpectedSession(context, expectedSession, 'before confirmation');
  const statusQuery = context.driver().realtime.statusQuery;
  if (statusQuery === null) throw new Error('Controller has no realtime status query.');

  await writeWhilePauseResumeOwner(context, { token, command, action });
  if (trackCncDoorProgress) refreshPauseResumeTransitionLiveness(context.refs, token);
  const afterCommand = context.get();
  assertExpectedSession(context, expectedSession, 'before the status query');

  let isStatusWriteSettled = false;
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: { sessionEpoch: expectedSession, sequence: afterCommand.statusSequence },
    accept,
    onFreshReport: (report: StatusReport) => {
      options.observeFreshReport?.(report);
      if (isStatusWriteSettled && extendsLiveness(liveness, report, action, accept)) {
        refreshPauseResumeTransitionLiveness(context.refs, token);
      }
    },
    timeoutMs: STATUS_WAIT_TIMEOUT_MS,
    timeoutMessage,
  });
  // Arm before our query so its immediate reply is captured. A reply cannot
  // extend liveness until the transport write settles, preserving the strict
  // two-second bound for a hung write.
  const statusWrite = writeWhilePauseResumeOwner(context, {
    token,
    command: statusQuery,
    action,
  }).then(() => {
    isStatusWriteSettled = true;
    if (trackCncDoorProgress) refreshPauseResumeTransitionLiveness(context.refs, token);
  });
  await Promise.all([statusWrite, confirmation]);
  assertPauseResumeTransitionOwner(context.refs, token);
  assertExpectedSession(context, expectedSession, 'during confirmation');
}

function assertExpectedSession(
  context: PauseResumeConfirmationContext,
  expectedSession: number,
  stage: string,
): void {
  if (context.get().controllerSessionEpoch === expectedSession) return;
  throw new Error(`Controller session changed ${stage}.`);
}

// Progress only refreshes the silence deadline; the absolute maximum still
// bounds the transition, and only an accepted report releases a refill.
function extendsLiveness(
  liveness: PauseResumeLivenessPolicy,
  report: StatusReport,
  action: PauseResumeTransitionAction,
  accept: (report: StatusReport) => boolean,
): boolean {
  switch (liveness) {
    case 'none':
      return false;
    case 'cnc-door':
      return isDoorTransitionProgress(report, action) || accept(report);
    case 'door-restore':
      // A laser keeps the beam dark through the whole restore: GRBL and
      // grblHAL skip the spin-up delay in laser mode and switch the laser on
      // only when the cycle restarts. The coolant (air) delay can still
      // outlast the heartbeat, and fresh restore reports prove the controller
      // is alive and working toward Run.
      return action === 'resume' && isDoorTransitionProgress(report, 'resume');
  }
}

function clearSettledPauseResumeUiState(
  context: PauseResumeWriteContext,
  token: PauseResumeTransitionToken,
): void {
  if (
    context.refs.pauseResumeTransition != null ||
    hasCurrentPauseResumeTransportFence(context.refs, token)
  ) {
    return;
  }
  context.set((state) =>
    state.pauseResumeTransition?.token === token.id ? { pauseResumeTransition: null } : {},
  );
}
