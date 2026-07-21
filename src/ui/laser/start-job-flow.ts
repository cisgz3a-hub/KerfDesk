// runStartJobFlow — the full Start-job sequence (readiness checks →
// operator confirmation → stream). Extracted from LaserWindow so the
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
import { useStartBlockerStore } from './start-blocker-store';
import { useToastStore } from '../state/toast-store';
import {
  checkpointProgramIssue,
  checkpointStartIssue,
  sameCheckpoint,
} from './start-job-checkpoint-policy';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { prepareCurrentStartJob, prepareRecoverySource } from './start-job-source';
import { captureStartExternalEnvironment } from './start-job-external-environment';
import {
  COMPLETED_REPLAY_CHANGED_MESSAGE,
  completedReceiptIsCurrent,
  replayCompilationMatches,
  stageFreshExecutionArtifact,
} from './start-job-execution-tracking';
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
  useStartBlockerStore.getState().clear();
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
  // ADR-237: the single Job Review runs here at Start. Transient camera
  // permits were reviewed before their Frame and carry evidence from birth.
  const review = permit.candidate.review ?? (await reviewFramedRunForStart(permit));
  if (review === null) return;
  if (useLaserStore.getState().framedRun !== permit) {
    useToastStore.getState().pushToast(FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE, 'warning');
    return;
  }
  const claim = claimCurrentFramedRunStart(permit);
  if (claim === null) {
    useToastStore
      .getState()
      .pushToast('This framed job is already being handed to the controller.', 'warning');
    return;
  }
  try {
    await streamFramedRun(permit, review, claim, repository);
  } finally {
    releaseFramedRunStartClaim(claim);
  }
}

async function streamFramedRun(
  permit: FramedRunPermit,
  review: FramedRunReviewEvidence,
  claim: FramedRunStartClaim,
  repository: RecoveryRepository,
): Promise<void> {
  const authorizationArgs = {
    preparedAgainst: permit.controller,
    checkpointToReplace: null,
    completedReceipt: null,
    expectedExecutionSignature: permit.candidate.executionSignature,
    externalEnvironment: permit.candidate.externalEnvironment,
    repository,
    framedRunClaim: claim,
  } as const;
  const currentLaser = await currentLaserForAuthorizedStart(authorizationArgs);
  if (currentLaser === null) return;
  await streamPreparedStart({
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
    externalEnvironment: permit.candidate.externalEnvironment,
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
  useStartBlockerStore.getState().clear();
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
  const externalEnvironment = captureStartExternalEnvironment(project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
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
    await repository.discardCompletedReceipt(completedReceipt.runId);
    useToastStore.getState().pushToast(COMPLETED_REPLAY_CHANGED_MESSAGE, 'warning');
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
    initial: { app, project, laser, prepared, laserModeStartSnapshot, externalEnvironment },
    checkpointToReplace,
    completedReceipt,
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
    externalEnvironment: bundle.externalEnvironment,
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
    externalEnvironment: bundle.externalEnvironment,
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
  useStartBlockerStore.getState().report(messages);
  const lines = messages.map((message) => `• ${message}`).join('\n');
  jobAwareAlert(`Cannot start job:\n\n${lines}`);
  return 'blocked';
}

async function streamPreparedStart(args: PreparedStartArgs): Promise<void> {
  const runId = createRunId();
  let staged = await stageFreshExecutionArtifact({
    runId,
    prepared: args.prepared,
    outputScope: args.outputScope,
    laser: args.laser,
    repository: args.repository,
    reviewedAtIso: args.reviewedAtIso,
    reviewModel: args.reviewModel,
    ...(args.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: args.laserModeStartEvidence }),
    ...(args.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: args.cncSetupAttestation }),
    ...(args.completedReceipt === null
      ? {}
      : { completedReplaySourceRunId: args.completedReceipt.runId }),
  });
  if (
    args.completedReceipt !== null &&
    !(await completedReceiptIsCurrent(args.completedReceipt, args.repository))
  ) {
    if (staged) await args.repository.discardStagedRun(runId);
    return;
  }
  const handoff = await armFreshStartHandoff(args.repository, runId, staged);
  if (handoff.blocked) return;
  staged = handoff.staged;
  const handoffArmed = handoff.armed;
  const authorizationArgs = {
    preparedAgainst: args.laser,
    checkpointToReplace: args.checkpointToReplace,
    completedReceipt: args.completedReceipt,
    expectedExecutionSignature: args.prepared.canvasPlan.retentionKey,
    externalEnvironment: args.externalEnvironment,
    repository: args.repository,
    ...(args.framedRunClaim === undefined ? {} : { framedRunClaim: args.framedRunClaim }),
  } as const;
  const authorization = currentLaserForAuthorizedStartNow(authorizationArgs);
  if (!authorization.ok) {
    if (handoffArmed) await args.repository.cancelPendingStart(runId);
    if (staged) await args.repository.discardStagedRun(runId);
    await reportStartAuthorizationRefusal(
      authorization.refusal,
      args.completedReceipt,
      args.repository,
    );
    return;
  }
  await transmitPreparedStart({
    args,
    runId,
    staged,
    handoffArmed,
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

async function armFreshStartHandoff(
  repository: RecoveryRepository,
  runId: ReturnType<typeof createRunId>,
  staged: boolean,
): Promise<{ readonly staged: boolean; readonly armed: boolean; readonly blocked: boolean }> {
  if (!staged) return { staged: false, armed: false, blocked: false };
  const armed = await repository.armFreshStart(runId);
  if (armed.ok && armed.value) return { staged: true, armed: true, blocked: false };
  await repository.cancelPendingStart(runId);
  await repository.discardStagedRun(runId);
  if (!armed.ok) return { staged: false, armed: false, blocked: false };
  useStartBlockerStore
    .getState()
    .report(['Another job Start is already being prepared. Wait for it to finish and try again.']);
  return { staged: false, armed: false, blocked: true };
}

// Resume a stopped/errored laser job from a chosen 1-based RAW line. CNC
// recovery is intentionally blocked before compile and again in the core
// builder because acknowledgement position is not physical machine state.
export async function runStartFromLineFlow(fromLine: number): Promise<void> {
  if (machineKindOf(useStore.getState().project.machine) === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  const prepared = prepareRecoverySource();
  if (prepared === null) return;
  await streamResumeFromRawLine(
    prepared.project,
    prepared.gcode,
    fromLine,
    prepared.canvasPlan,
    prepared.laserModeStartSnapshot,
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
  const prepared = prepareRecoverySource({
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
  );
}
