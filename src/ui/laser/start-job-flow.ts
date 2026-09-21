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
import {
  fingerprintGcode,
  fingerprintsEqual,
  rawResumeLine,
  type JobCheckpoint,
} from '../../core/recovery';
import { machineKindOf } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { readJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import {
  createRunId,
  recoveryRepository,
  type LastCompletedReceipt,
  type RecoveryRepository,
} from '../state/recovery';
import { useCameraStore } from '../state/camera-store';
import { clearStartBlockers, reportStartBlockers } from './start-blocker-invalidation';
import { useToastStore } from '../state/toast-store';
import {
  checkpointProgramIssue,
  checkpointStartIssue,
  sameCheckpoint,
} from './start-job-checkpoint-policy';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { prepareCurrentStartJob, prepareRecoverySource } from './start-job-source';
import {
  completedReceiptIsCurrent,
  replayCompilationMatches,
} from './start-job-execution-tracking';
import { createStartIntent } from '../state/recovery/start-intent';
import {
  completedReplayInvalidationHandler,
  discardChangedCompletedReplay,
} from './completed-replay-invalidation';
import {
  currentLaserForAuthorizedStartNow,
  type CurrentStartAuthorizationArgs,
} from './start-job-authorization';
import {
  reportBlockedStart,
  reportStartAuthorizationRefusal,
} from './start-job-authorization-reporting';
import { transmitPreparedStart, type PreparedStartArgs } from './start-job-transmission';
import { offerFixForBlockedStart } from './start-blocked-fix-offers';
import { type StartOfferPolicy } from './start-blocked-repair';
import { runJobReviewGate } from './job-review';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { framedRunReadinessIssue } from './framed-run-readiness';
import {
  FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE,
  reviewFramedRunForStart,
} from './framed-run-start-review';
import { runFrameNow } from './use-frame-action';
import {
  claimCurrentFramedRunStart,
  releaseFramedRunStartClaim,
  type FramedRunStartClaim,
} from './framed-run-start-claim';

export async function runStartJobFlow(
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  await runFreshFramedJobFlow(repository);
}

async function runFreshFramedJobFlow(repository: RecoveryRepository): Promise<void> {
  clearStartBlockers();
  const permit = useLaserStore.getState().framedRun;
  const issue = framedRunReadinessIssue(permit);
  if (issue !== null) {
    if (permit !== null) {
      useLaserStore.setState({ framedRun: null, frameVerification: null });
      useToastStore.getState().pushToast(issue, 'warning');
    }
    // Start is the primary action: with no current permit it launches the same
    // dialog-free prepare/Frame flow as the Frame button. A successful trace
    // arms the exact job; pressing Start again opens the one Job Review.
    await runFrameNow();
    return;
  }
  if (permit === null) return;
  await runFramedPermitStart(permit, repository);
}

/** Claims and transmits exactly one completion-issued permit. Derived jobs
 * use this same review, durable intent, final assertion, and archive owner. */
export async function runFramedPermitStart(
  permit: FramedRunPermit,
  repository: RecoveryRepository = recoveryRepository,
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
    return await streamFramedRun(permit, review, claim, repository);
  } finally {
    releaseFramedRunStartClaim(claim);
  }
}

async function streamFramedRun(
  permit: FramedRunPermit,
  review: FramedRunReviewEvidence,
  claim: FramedRunStartClaim,
  repository: RecoveryRepository,
): Promise<boolean> {
  const authorizationArgs = {
    preparedAgainst: permit.controller,
    checkpointToReplace: null,
    completedReceipt: null,
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
    checkpointToReplace: null,
    completedReceipt: null,
    repository,
    framedRunClaim: claim,
  });
}

export async function runConfirmedCheckpointReplacementStart(
  checkpoint: JobCheckpoint,
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  await runStartJobFlowWithCheckpoint(checkpoint, null, repository);
}

/** Exact-job replay after a fully settled completion. This still performs the
 * complete current Start flow and creates a new run identity at line one. */
export async function runCompletedJobAgainFlow(
  receipt: LastCompletedReceipt,
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  await runStartJobFlowWithCheckpoint(null, receipt, repository);
}

async function runStartJobFlowWithCheckpoint(
  checkpointToReplace: JobCheckpoint | null,
  completedReceipt: LastCompletedReceipt | null,
  repository: RecoveryRepository,
  offerPolicy: StartOfferPolicy = 'offer-fixes',
): Promise<void> {
  clearStartBlockers();
  const laser = useLaserStore.getState();
  const app = useStore.getState();
  const initialCheckpointIssue = checkpointStartIssue(checkpointToReplace);
  if (initialCheckpointIssue !== null) {
    reportBlockedStart(initialCheckpointIssue);
    return;
  }
  const { project } = app;
  const laserModeStartSnapshot = captureLaserModeStartSnapshot(laser);
  const camera = useCameraStore.getState();
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    completedReceipt?.artifact.jobOrigin,
  );
  if (!prepared.ok) {
    if ((await repairOrReportBlockedStart(prepared.messages, offerPolicy)) === 'retry') {
      return runStartJobFlowWithCheckpoint(
        checkpointToReplace,
        completedReceipt,
        repository,
        'no-offers',
      );
    }
    return;
  }
  if (completedReceipt !== null && !replayCompilationMatches(prepared, completedReceipt)) {
    await discardChangedCompletedReplay(completedReceipt, repository);
    return;
  }
  const programIssue = checkpointProgramIssue(checkpointToReplace, prepared.gcode);
  if (programIssue !== null) {
    reportBlockedStart(programIssue);
    return;
  }
  // ADR-224: the Job Review dialog replaces the warnings toast and the two
  // native start confirms here. It returns the exact bundle that must stream
  // — re-prepared if the operator edited settings inside the review — plus
  // the same evidence/attestation objects the confirms used to produce.
  const review = await runJobReviewGate({
    initial: { app, project, laser, prepared, laserModeStartSnapshot },
    checkpointToReplace,
    completedReceipt,
    ...completedReplayInvalidationHandler(completedReceipt, repository),
  });
  if (review === null) return;
  const { bundle, reviewedAtIso, reviewModel, laserModeStartEvidence, cncSetupAttestation } =
    review;
  const machineKind = machineKindOf(bundle.project.machine);
  const currentLaser = await currentLaserForAuthorizedStart({
    preparedAgainst: bundle.laser,
    checkpointToReplace,
    completedReceipt,
    expectedExecutionSignature: bundle.prepared.canvasPlan.retentionKey,
    repository,
  });
  if (currentLaser === null) return;
  await streamPreparedStart({
    outputScope: currentOutputScope(bundle.app),
    project: bundle.project,
    laser: currentLaser,
    prepared: bundle.prepared,
    machineKind,
    reviewedAtIso,
    reviewModel,
    laserModeStartEvidence,
    cncSetupAttestation,
    checkpointToReplace,
    completedReceipt,
    repository,
  });
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

// Blocks that have a one-click remedy offer it in place instead of
// dead-ending in an alert. Retried at most once ('no-offers') so a gate that
// still fails cannot loop the operator through the same dialog. 'handled'
// (frame trace underway) skips the refusal report entirely — its toast
// already tells the operator to press Start again after the trace.
async function repairOrReportBlockedStart(
  messages: ReadonlyArray<string>,
  offerPolicy: StartOfferPolicy,
): Promise<'retry' | 'blocked'> {
  if (offerPolicy === 'offer-fixes') {
    const repair = await offerFixForBlockedStart(messages);
    if (repair === 'retry') return 'retry';
    if (repair === 'handled') return 'blocked';
  }
  reportStartBlockers(messages);
  const lines = messages.map((message) => `• ${message}`).join('\n');
  jobAwareAlert(`Cannot start job:\n\n${lines}`);
  return 'blocked';
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
    checkpointToReplace: args.checkpointToReplace,
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

/** Arm the durable Start handoff from the cheap intent (ADR-337).
 *
 * Unavailable recovery storage is NOT a Start gate: rule 7 refuses only when
 * transport cannot accept work, output cannot be produced or streamed, or the
 * reviewed artifact cannot be handed off consistently. A run whose durable
 * record could not be written still goes to the machine, and
 * `activateAcceptedFreshRun` tells the operator afterwards that it has no
 * forensic record — the same posture staging had before this decision. */
async function armFreshStartHandoff(
  args: PreparedStartArgs,
  runId: ReturnType<typeof createRunId>,
): Promise<{ readonly armed: boolean; readonly blocked: boolean }> {
  const intent = createStartIntent({
    gcode: args.prepared.gcode,
    machineKind: args.machineKind,
    outputScope: args.outputScope,
    ...(args.prepared.jobOrigin === undefined ? {} : { jobOrigin: args.prepared.jobOrigin }),
    nowIso: new Date().toISOString(),
  });
  const armed = await args.repository.armFreshStartIntent(runId, intent);
  if (armed.ok && armed.value) return { armed: true, blocked: false };
  await args.repository.cancelPendingStart(runId);
  if (!armed.ok) return { armed: false, blocked: false };
  reportStartBlockers([
    'Another job Start is already being prepared. Wait for it to finish and try again.',
  ]);
  return { armed: false, blocked: true };
}

// Resume a stopped/errored laser job from a chosen 1-based RAW line. CNC
// recovery is intentionally blocked before compile and again in the core
// builder because acknowledgement position is not physical machine state.
export async function runStartFromLineFlow(fromLine: number): Promise<void> {
  if (machineKindOf(useStore.getState().project.machine) === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  const prepared = await prepareRecoverySource();
  if (prepared === null) return;
  await streamResumeFromRawLine(
    prepared.project,
    prepared.gcode,
    fromLine,
    prepared.canvasPlan,
    prepared.laserModeStartSnapshot,
    undefined,
    prepared.controllerSnapshot,
  );
}

// Resume the checkpointed interrupted job (ADR-118): re-compile the project,
// REFUSE when its bytes no longer match the checkpoint's fingerprint (an
// edited project silently renumbers every line), then map the acked-sendable
// count back to the raw line the stream died at.
export async function runCheckpointResumeFlow(checkpoint: JobCheckpoint): Promise<void> {
  const current = readJobCheckpoint();
  if (current === null || !sameCheckpoint(current, checkpoint)) {
    jobAwareAlert(
      'Cannot resume the interrupted job:\n\nThe recovery record changed or was removed. Review the current recovery banner before continuing.',
    );
    return;
  }
  if (checkpoint.machineKind === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  // Recompile with the run's OWN scope + resolved origin (PST-02, R1): a crash
  // resets the live output scope and re-resolves current-position against the
  // post-crash head, both of which would renumber every line and trip the
  // fingerprint refusal below. The frozen origin reproduces the exact bytes.
  const prepared = await prepareRecoverySource({
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (prepared === null) return;
  if (!fingerprintsEqual(fingerprintGcode(prepared.gcode), checkpoint.fingerprint)) {
    jobAwareAlert(
      'Cannot resume the interrupted job:\n\n' +
        'The current project no longer produces the same G-code as the interrupted run — ' +
        'it was edited since (a changed object, output scope, or job placement all ' +
        'renumber the lines), so they no longer match. Re-open the original project, or ' +
        'use Start from line… manually if you are sure of the line.',
    );
    return;
  }
  const fromLine = rawResumeLine(prepared.gcode, checkpoint.ackedLines);
  await streamResumeFromRawLine(
    prepared.project,
    prepared.gcode,
    fromLine,
    prepared.canvasPlan,
    prepared.laserModeStartSnapshot,
    checkpoint,
    prepared.controllerSnapshot,
  );
}
