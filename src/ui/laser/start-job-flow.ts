// runStartJobFlow — readiness → review → stream, extracted from LaserWindow so the
// toolbar button and the Ctrl+Return shortcut (M22, WORKFLOW F-A15) run the
// identical flow. Reads both stores imperatively at call time.
//
// Dialogs go through the job-aware wrappers (H13): pass-through natives
// when no job is active — which is the normal case here, since
// prepareStartJob refuses to run while a job is active — but the
// startJob-failed alert in the catch arm can fire after streaming began,
// and a native dialog there would freeze the ack pump and Abort button.

import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import {
  createRunId,
  recoveryRepository,
  type LastCompletedReceipt,
  type RecoveryRepository,
} from '../state/recovery';
import { clearStartBlockers } from './start-blocker-invalidation';
import { useToastStore } from '../state/toast-store';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { noteManualRestartStarted, prepareManualRestartSource } from './manual-restart-source';
import { completedReceiptIsCurrent } from './start-job-execution-tracking';
import { armFreshStartHandoff } from './start-handoff-arming';
import {
  currentLaserForAuthorizedStartNow,
  type CurrentStartAuthorizationArgs,
} from './start-job-authorization';
import { reportStartAuthorizationRefusal } from './start-job-authorization-reporting';
import { transmitPreparedStart, type PreparedStartArgs } from './start-job-transmission';
import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { framedRunReadinessIssue, REPLAY_PERMIT_MISMATCH_MESSAGE } from './framed-run-readiness';
import {
  FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE,
  reviewFramedRunForStart,
} from './framed-run-start-review';
import { frameExpiredStartMessage, frameExpiryReason } from './frame-expiry-note';
import {
  claimCurrentFramedRunStart,
  releaseFramedRunStartClaim,
  type FramedRunStartClaim,
} from './framed-run-start-claim';

export async function runStartJobFlow(
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  // A permitted Start keeps its own single-owner permit claim
  // (start-job-authorization) and is not coalesced.
  await runFreshFramedJobFlow(repository);
}

async function runFreshFramedJobFlow(
  repository: RecoveryRepository,
  completedReceipt: LastCompletedReceipt | null = null,
): Promise<void> {
  clearStartBlockers();
  const permit = useLaserStore.getState().framedRun;
  const issue = framedRunReadinessIssue(permit) ?? replayPermitMismatch(permit, completedReceipt);
  if (issue !== null) {
    // Start is disabled until a clean Frame of this exact job completes; only
    // the keyboard shortcut or a permit expiring under the click reaches here.
    // Frame is the operator's own step, so Start says so instead of framing.
    if (permit !== null) useLaserStore.setState({ framedRun: null, frameVerification: null });
    const expiredBecause = frameExpiryReason();
    useToastStore
      .getState()
      .pushToast(
        permit === null && expiredBecause !== null
          ? frameExpiredStartMessage(expiredBecause)
          : issue,
        'warning',
      );
    return;
  }
  if (permit === null) return;
  await runFramedPermitStart(permit, repository, completedReceipt);
}

// Run again streams a Frame permit like Start, so the permit must be for the
// completed job it replays. The button shows only while the current job
// matches the receipt, and a ready permit matches the current job; this
// catches either one changing between the render and the click.
function replayPermitMismatch(
  permit: FramedRunPermit | null,
  completedReceipt: LastCompletedReceipt | null,
): string | null {
  if (permit === null || completedReceipt === null) return null;
  return permit.candidate.executionSignature === completedReceipt.artifact.executionSignature
    ? null
    : REPLAY_PERMIT_MISMATCH_MESSAGE;
}

/** Claims and transmits exactly one completion-issued permit. Derived jobs
 * use this same review, durable intent, final assertion, and archive owner. */
export async function runFramedPermitStart(
  permit: FramedRunPermit,
  repository: RecoveryRepository = recoveryRepository,
  completedReceipt: LastCompletedReceipt | null = null,
): Promise<boolean> {
  if (useLaserStore.getState().framedRun !== permit || framedRunReadinessIssue(permit) !== null) {
    return false;
  }
  // ADR-237: the single Job Review runs here at Start. Transient camera
  // permits were reviewed before their Frame and carry evidence from birth.
  const review = permit.candidate.review ?? (await reviewFramedRunForStart(permit));
  if (review === null) return false;
  if (useLaserStore.getState().framedRun !== permit) {
    useToastStore.getState().pushToast(FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE, 'warning');
    return false;
  }
  const claim = claimCurrentFramedRunStart(permit);
  if (claim === null) {
    useToastStore
      .getState()
      .pushToast('This framed job is already being handed to the controller.', 'warning');
    return false;
  }
  try {
    return await streamFramedRun(permit, review, claim, repository, completedReceipt);
  } finally {
    releaseFramedRunStartClaim(claim);
  }
}

async function streamFramedRun(
  permit: FramedRunPermit,
  review: FramedRunReviewEvidence,
  claim: FramedRunStartClaim,
  repository: RecoveryRepository,
  completedReceipt: LastCompletedReceipt | null,
): Promise<boolean> {
  const authorizationArgs = {
    preparedAgainst: permit.controller,
    completedReceipt,
    expectedExecutionSignature: permit.candidate.executionSignature,
    repository,
    framedRunClaim: claim,
  } as const;
  const currentLaser = await currentLaserForAuthorizedStart(authorizationArgs);
  if (currentLaser === null) return false;
  return streamPreparedStart({
    outputScope: permit.candidate.outputScope,
    project: permit.candidate.project,
    laser: currentLaser,
    prepared: permit.candidate.preparedStart,
    machineKind: machineKindOf(permit.candidate.project.machine),
    reviewedAtIso: review.reviewedAtIso,
    reviewModel: review.reviewModel,
    laserModeStartEvidence: review.laserModeStartEvidence,
    cncSetupAttestation: review.cncSetupAttestation,
    completedReceipt,
    repository,
    framedRunClaim: claim,
  });
}

/** Exact-job replay after a fully settled completion (ADR-372 Amendment 1).
 * It follows Start exactly: it needs a completed Frame of this job, streams
 * that permit's bytes from line one with a new run identity, and never runs a
 * Frame itself. The receipt records which completed run it replays. */
export async function runCompletedJobAgainFlow(
  receipt: LastCompletedReceipt,
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  await runFreshFramedJobFlow(repository, receipt);
}

async function currentLaserForAuthorizedStart(
  args: CurrentStartAuthorizationArgs,
): Promise<ReturnType<typeof useLaserStore.getState> | null> {
  if (!(await completedReplayCanContinue(args.completedReceipt, args.repository))) {
    return null;
  }
  const authorization = currentLaserForAuthorizedStartNow(args);
  if (authorization.ok) return authorization.laser;
  await reportStartAuthorizationRefusal(
    authorization.refusal,
    args.completedReceipt,
    args.repository,
  );
  return null;
}

// ADR-337: nothing proportional to the job's geometry runs between here and
// the first wire byte. The durable pre-wire record is the start intent — two
// linear scans of the emitted program — and the execution archive is written
// once the controller has accepted it.
async function streamPreparedStart(args: PreparedStartArgs): Promise<boolean> {
  const runId = createRunId();
  if (
    args.completedReceipt !== null &&
    !(await completedReceiptIsCurrent(args.completedReceipt, args.repository))
  ) {
    return false;
  }
  const handoff = await armFreshStartHandoff(args, runId);
  if (handoff.blocked) return false;
  const authorizationArgs = {
    preparedAgainst: args.laser,
    completedReceipt: args.completedReceipt,
    expectedExecutionSignature: args.prepared.canvasPlan.retentionKey,
    repository: args.repository,
    ...(args.framedRunClaim === undefined ? {} : { framedRunClaim: args.framedRunClaim }),
  } as const;
  const authorization = currentLaserForAuthorizedStartNow(authorizationArgs);
  if (!authorization.ok) {
    if (handoff.armed) await args.repository.cancelPendingStart(runId);
    await reportStartAuthorizationRefusal(
      authorization.refusal,
      args.completedReceipt,
      args.repository,
    );
    return false;
  }
  return transmitPreparedStart({
    args,
    runId,
    handoffArmed: handoff.armed,
    authorizationArgs,
    authorization,
  });
}

async function completedReplayCanContinue(
  receipt: LastCompletedReceipt | null,
  repository: RecoveryRepository,
): Promise<boolean> {
  return receipt === null || completedReceiptIsCurrent(receipt, repository);
}

// Resume a stopped/errored laser job from a chosen 1-based RAW line. CNC
// recovery is intentionally blocked before compile and again in the core
// builder because acknowledgement position is not physical machine state.
export async function runStartFromLineFlow(fromLine: number): Promise<void> {
  if (machineKindOf(useStore.getState().project.machine) === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  // The newest run's own placement, not the stopped head (audit recovery-4).
  const restart = await prepareManualRestartSource();
  if (restart === null) return;
  const prepared = restart.source;
  const started = await streamResumeFromRawLine(
    prepared.project,
    prepared.gcode,
    fromLine,
    prepared.canvasPlan,
    prepared.laserModeStartSnapshot,
    prepared.controllerSnapshot,
    restart.placementNote,
  );
  if (started) noteManualRestartStarted(restart);
}
