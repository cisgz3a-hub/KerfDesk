import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import {
  assertPauseResumeTransitionOwner,
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
import { containActiveStreamWriteFailure } from './laser-stream-heartbeat-containment';

type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

type PauseResumeWriteContext = {
  readonly set: SetFn;
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
};

const STATUS_WAIT_TIMEOUT_MS =
  PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS + PAUSE_RESUME_TRANSITION_TIMEOUT_MS;

export async function writeWhilePauseResumeOwner(
  context: PauseResumeWriteContext,
  options: PauseResumeWriteOptions,
): Promise<void> {
  const { token, command, action } = options;
  const writeEpoch = context.refs.writeEpoch ?? 0;
  reservePauseResumeTransportWrite(context.refs, token);
  try {
    try {
      await context.safeWrite(command, action);
    } catch (error) {
      if ((context.refs.writeEpoch ?? 0) === writeEpoch) {
        containActiveStreamWriteFailure(context.set, context.refs, context.safeWrite, action);
        markPauseResumeTransportWriteRejected(context.refs, token);
      }
      throw error;
    }
    assertPauseResumeTransitionOwner(context.refs, token);
  } finally {
    releasePauseResumeTransportWrite(context.refs, token);
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
    ...(trackCncDoorProgress
      ? {
          onFreshReport: (report: StatusReport) => {
            if (isStatusWriteSettled && (isCncDoorProgress(report, action) || accept(report))) {
              refreshPauseResumeTransitionLiveness(context.refs, token);
            }
          },
        }
      : {}),
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

function isCncDoorProgress(report: StatusReport, action: PauseResumeTransitionAction): boolean {
  if (report.state !== 'Door') return false;
  return action === 'pause' ? report.subState === 2 : report.subState === 3;
}
