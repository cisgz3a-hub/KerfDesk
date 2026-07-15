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

import type { OverrideValues } from '../../core/controllers/grbl';
import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import { streamingModeForController } from '../../core/devices';
import {
  fingerprintGcode,
  fingerprintsEqual,
  rawResumeLine,
  type JobCheckpoint,
} from '../../core/recovery';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { readJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { controllerQualificationStartBlockMessage } from '../state/laser-controller-qualification';
import {
  createRunId,
  recoveryRepository,
  type LastCompletedReceipt,
  type RecoveryRepository,
} from '../state/recovery';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { armVariableStreamAdvancement } from './variable-stream-advancement';
import { useCameraStore } from '../state/camera-store';
import { useStartBlockerStore } from './start-blocker-store';
import { reducedOverrideAcknowledgement } from '../state/cnc-accessory-readiness';
import { useToastStore } from '../state/toast-store';
import {
  checkpointProgramIssue,
  checkpointStartIssue,
  sameCheckpoint,
} from './start-job-checkpoint-policy';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { prepareCurrentStartJob, prepareRecoverySource } from './start-job-source';
import {
  captureStartExternalEnvironment,
  type StartExternalEnvironment,
} from './start-job-external-environment';
import {
  activateAcceptedFreshRun,
  completedReceiptIsCurrent,
  replayCompilationMatches,
  stageFreshExecutionArtifact,
} from './start-job-execution-tracking';
import {
  currentLaserForAuthorizedStartNow,
  type CurrentStartAuthorizationArgs,
  type StartAuthorizationRefusal,
} from './start-job-authorization';
import {
  reportBlockedStart,
  reportStartAuthorizationRefusal,
  startAuthorizationRefusalMessage,
} from './start-job-authorization-reporting';
import { confirmLaserModeStartEvidence } from './laser-mode-start-acknowledgement';
import {
  captureLaserModeStartSnapshot,
  type LaserModeStartEvidence,
} from '../state/laser-mode-start-evidence';

export async function runStartJobFlow(
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  await runStartJobFlowWithCheckpoint(null, null, repository);
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
): Promise<void> {
  useStartBlockerStore.getState().clear();
  const laser = useLaserStore.getState();
  if (blockUnqualifiedStart(laser)) return;
  const initialCheckpointIssue = checkpointStartIssue(checkpointToReplace);
  if (initialCheckpointIssue !== null) {
    reportBlockedStart(initialCheckpointIssue);
    return;
  }
  const app = useStore.getState();
  const { project } = app;
  const laserModeStartSnapshot = captureLaserModeStartSnapshot(laser);
  const camera = useCameraStore.getState();
  const externalEnvironment = captureStartExternalEnvironment(project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
  );
  if (!prepared.ok) {
    useStartBlockerStore.getState().report(prepared.messages);
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot start job:\n\n${lines}`);
    return;
  }
  if (completedReceipt !== null && !replayCompilationMatches(prepared, completedReceipt)) {
    await repository.discardCompletedReceipt(completedReceipt.runId);
    useToastStore
      .getState()
      .pushToast('The completed job changed. Use Start job to run the current canvas.', 'warning');
    return;
  }
  const programIssue = checkpointProgramIssue(checkpointToReplace, prepared.gcode);
  if (programIssue !== null) {
    reportBlockedStart(programIssue);
    return;
  }
  if (prepared.warnings.length > 0) {
    useToastStore.getState().pushToast(prepared.warnings.join('\n'), 'warning');
  }
  const machineKind = machineKindOf(project.machine);
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    laserModeStartSnapshot,
    jobAwareConfirm,
  );
  if (laserModeStartEvidence === null) return;
  const cncSetupAttestation = confirmCncSetup(machineKind, prepared.gcode, laser.ovCache);
  if (cncSetupAttestation === null) return;
  const currentLaser = await currentLaserForAuthorizedStart({
    preparedAgainst: laser,
    checkpointToReplace,
    completedReceipt,
    expectedExecutionSignature: prepared.canvasPlan.retentionKey,
    externalEnvironment,
    repository,
  });
  if (currentLaser === null) return;
  await streamPreparedStart({
    app,
    project,
    laser: currentLaser,
    prepared,
    machineKind,
    laserModeStartEvidence,
    cncSetupAttestation,
    checkpointToReplace,
    completedReceipt,
    externalEnvironment,
    repository,
  });
}

async function currentLaserForAuthorizedStart(args: {
  readonly preparedAgainst: ReturnType<typeof useLaserStore.getState>;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly expectedExecutionSignature: string;
  readonly externalEnvironment: StartExternalEnvironment;
  readonly repository: RecoveryRepository;
}): Promise<ReturnType<typeof useLaserStore.getState> | null> {
  if (
    args.completedReceipt !== null &&
    !(await completedReceiptIsCurrent(args.completedReceipt, args.repository))
  ) {
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

function blockUnqualifiedStart(laser: ReturnType<typeof useLaserStore.getState>): boolean {
  const message = controllerQualificationStartBlockMessage(
    laser.controllerQualification,
    laser.controllerSessionEpoch,
  );
  if (message === null) return false;
  useStartBlockerStore.getState().report([message]);
  return true;
}

type PreparedStartArgs = {
  readonly app: ReturnType<typeof useStore.getState>;
  readonly project: ReturnType<typeof useStore.getState>['project'];
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly prepared: Extract<Awaited<ReturnType<typeof prepareCurrentStartJob>>, { ok: true }>;
  readonly machineKind: MachineKind;
  readonly laserModeStartEvidence: LaserModeStartEvidence | undefined;
  readonly cncSetupAttestation: CncSetupAttestation | undefined;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly externalEnvironment: StartExternalEnvironment;
  readonly repository: RecoveryRepository;
};

async function streamPreparedStart(args: PreparedStartArgs): Promise<void> {
  const runId = createRunId();
  const staged = await stageFreshExecutionArtifact({
    runId,
    prepared: args.prepared,
    outputScope: currentOutputScope(args.app),
    laser: args.laser,
    repository: args.repository,
  });
  if (
    args.completedReceipt !== null &&
    !(await completedReceiptIsCurrent(args.completedReceipt, args.repository))
  ) {
    if (staged) await args.repository.discardStagedRun(runId);
    return;
  }
  const authorizationArgs = {
    preparedAgainst: args.laser,
    checkpointToReplace: args.checkpointToReplace,
    completedReceipt: args.completedReceipt,
    expectedExecutionSignature: args.prepared.canvasPlan.retentionKey,
    externalEnvironment: args.externalEnvironment,
    repository: args.repository,
  } as const;
  const authorization = currentLaserForAuthorizedStartNow(authorizationArgs);
  if (!authorization.ok) {
    if (staged) await args.repository.discardStagedRun(runId);
    await reportStartAuthorizationRefusal(
      authorization.refusal,
      args.completedReceipt,
      args.repository,
    );
    return;
  }
  let boundaryRefusal: StartAuthorizationRefusal | null = null;
  const assertFinalStartAuthorized = finalStartAssertion(authorizationArgs, (refusal) => {
    boundaryRefusal = refusal;
  });
  try {
    // Calling an async function runs synchronously until its first await. The
    // store repeats this gate after its own final await, immediately before it
    // creates the streamer; no app/camera/controller mutation can slip through
    // either side of the Start boundary without a refusal.
    await authorization.laser.startJob(
      args.prepared.gcode,
      preparedStartOptions(args, runId, assertFinalStartAuthorized),
    );
    armVariableStreamAdvancement(args.project);
    await activateAcceptedFreshRun(runId, staged, args.repository);
  } catch (err) {
    if (staged) await args.repository.discardStagedRun(runId);
    if (boundaryRefusal !== null) {
      await reportStartAuthorizationRefusal(
        boundaryRefusal,
        args.completedReceipt,
        args.repository,
      );
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    useStartBlockerStore.getState().report([message]);
    jobAwareAlert(`Could not start job:\n\n${message}`);
  }
}

function preparedStartOptions(
  args: PreparedStartArgs,
  runId: ReturnType<typeof createRunId>,
  assertFinalStartAuthorized: () => void,
): StartJobOptions {
  return {
    runId,
    assertFinalStartAuthorized,
    streamingMode: streamingModeForController(
      args.project.device.controllerKind,
      args.project.device.streamingMode,
    ),
    rxBufferBytes: args.project.device.rxBufferBytes,
    machineKind: args.machineKind,
    ...(args.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: args.laserModeStartEvidence }),
    ...(args.prepared.cncToolPlan === undefined ? {} : { cncToolPlan: args.prepared.cncToolPlan }),
    ...(args.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: args.cncSetupAttestation }),
    canvasPlan: args.prepared.canvasPlan,
  };
}

function finalStartAssertion(
  args: CurrentStartAuthorizationArgs,
  onRefusal: (refusal: StartAuthorizationRefusal) => void,
): () => void {
  return () => {
    const authorization = currentLaserForAuthorizedStartNow(args);
    if (authorization.ok) return;
    onRefusal(authorization.refusal);
    throw new Error(startAuthorizationRefusalMessage(authorization.refusal));
  };
}

function confirmCncSetup(
  machineKind: MachineKind,
  gcode: string,
  overrides: OverrideValues | null,
): CncSetupAttestation | null | undefined {
  if (machineKind !== 'cnc') return undefined;
  const overrideAcknowledgement = reducedOverrideAcknowledgement(overrides);
  const prompt =
    overrideAcknowledgement === undefined
      ? CNC_SETUP_ATTESTATION_PROMPT
      : `${CNC_SETUP_ATTESTATION_PROMPT}\n\nConfirm these exact reduced controller overrides: feed ${overrideAcknowledgement.feed}%, rapid ${overrideAcknowledgement.rapid}%, spindle ${overrideAcknowledgement.spindle}%.`;
  if (!jobAwareConfirm(prompt)) return null;
  return createCncSetupAttestation(
    gcode,
    cncControllerEpochOf(useLaserStore.getState()),
    overrideAcknowledgement,
  );
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
