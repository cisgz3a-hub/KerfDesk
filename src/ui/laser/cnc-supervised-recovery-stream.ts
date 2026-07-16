import { streamingModeForController } from '../../core/devices';
import type { CncSupervisedRecoveryJob } from '../../core/recovery/cnc-supervised-recovery-job';
import { cncToolPlan } from '../state/cnc-tool-plan';
import type { CncSetupAttestation } from '../state/cnc-setup-attestation';
import { rebuildCanvasPlanForGcode, reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import {
  createExecutionArtifact,
  createRunId,
  type RecoveryCapsule,
  type RecoveryRepository,
} from '../state/recovery';
import type { PreparedRecoverySource } from './start-job-source';
import { cleanupRejectedRecoveryAttempt } from './recovery-attempt-cleanup';
import { finalRecoveryStartAssertion } from './recovery-start-authorization';

export type CncRecoveryStreamPlan = {
  readonly source: PreparedRecoverySource;
  readonly recovery: CncSupervisedRecoveryJob;
  readonly gcode: string;
};

export async function claimCncRecoveryCapsule(
  capsule: RecoveryCapsule,
  repository: RecoveryRepository,
): Promise<RecoveryCapsule | null> {
  const claimed = await repository.claimRecovery({
    runId: capsule.runId,
    revision: capsule.revision,
    attemptId: createAttemptId(),
  });
  if (claimed.ok) return claimed.value;
  jobAwareAlert(
    'Cannot start CNC recovery:\n\nThe saved recovery changed or was claimed in another window. Re-open the current recovery card.',
  );
  return null;
}

export async function streamCncRecoveryProgram(
  planned: CncRecoveryStreamPlan,
  cncSetupAttestation: CncSetupAttestation,
  claimedCapsule: RecoveryCapsule,
  repository: RecoveryRepository,
): Promise<boolean> {
  const laser = useLaserStore.getState();
  const recoveryRunId = createRunId();
  const canvasPlan = recoveryCanvasPlan(planned, laser);
  const staged = await stageRecoveryAttempt(
    planned,
    claimedCapsule,
    recoveryRunId,
    canvasPlan,
    laser,
    repository,
  );
  if (!staged) return false;

  try {
    await laser.startJob(planned.gcode, {
      runId: recoveryRunId,
      assertFinalStartAuthorized: finalRecoveryStartAssertion(laser),
      streamingMode: streamingModeForController(
        planned.source.project.device.controllerKind,
        planned.source.project.device.streamingMode,
      ),
      rxBufferBytes: planned.source.project.device.rxBufferBytes,
      machineKind: 'cnc',
      cncSetupAttestation,
      ...toolPlanOption(planned.recovery),
      canvasPlan,
    });
  } catch (error) {
    await resolveFailedRecoveryAttempt(claimedCapsule, recoveryRunId, error, repository);
    return false;
  }

  const activated = await repository.activateClaimedRecovery({
    sourceRunId: claimedCapsule.runId,
    sourceRevision: claimedCapsule.revision,
    attemptId: claimedCapsule.claim?.attemptId ?? '',
    recoveryRunId,
  });
  if (!activated.ok || !activated.value) {
    await repository.noteUntrackedRunAccepted();
    jobAwareAlert(
      'CNC recovery started, but recovery tracking is unavailable for this attempt. Supervise the machine continuously and use the physical E-stop if unsafe.',
    );
  }
  return true;
}

async function stageRecoveryAttempt(
  planned: CncRecoveryStreamPlan,
  claimedCapsule: RecoveryCapsule,
  recoveryRunId: string,
  canvasPlan: ReturnType<typeof recoveryCanvasPlan>,
  laser: ReturnType<typeof useLaserStore.getState>,
  repository: RecoveryRepository,
): Promise<boolean> {
  const toolPlan = cncToolPlan(planned.recovery.job);
  const staged = await repository.stageArtifact(
    createExecutionArtifact({
      runId: recoveryRunId,
      gcode: planned.gcode,
      prepared: { ...planned.source.prepared, job: planned.recovery.job },
      outputScope: claimedCapsule.artifact.outputScope,
      ...(planned.source.jobOrigin === undefined ? {} : { jobOrigin: planned.source.jobOrigin }),
      canvasPlan,
      ...(toolPlan.length === 0 ? {} : { cncToolPlan: toolPlan }),
      controllerSettings: laser.controllerSettings,
      controllerObservation: controllerObservation(laser),
      createdAtIso: new Date().toISOString(),
    }),
  );
  if (staged.ok && staged.value === recoveryRunId) {
    const armed = await repository.armClaimedRecoveryStart({
      sourceRunId: claimedCapsule.runId,
      sourceRevision: claimedCapsule.revision,
      attemptId: claimedCapsule.claim?.attemptId ?? '',
      recoveryRunId,
    });
    if (armed.ok && armed.value) return true;
  }

  const cleanup = await cleanupRejectedRecoveryAttempt({
    repository,
    sourceRunId: claimedCapsule.runId,
    attemptId: claimedCapsule.claim?.attemptId ?? '',
    stagedRunId: recoveryRunId,
  });
  jobAwareAlert(
    cleanup.retryable
      ? 'Cannot start CNC recovery:\n\nThe recovery attempt could not be stored or durably armed. The saved job remains retryable and no controller command was sent.'
      : 'Cannot start CNC recovery:\n\nNo controller command was sent, but the durable Start handoff or recovery claim could not be cleared. Reload after recovery storage is available; do not assume this capsule is retryable yet.',
  );
  return false;
}

function recoveryCanvasPlan(
  planned: CncRecoveryStreamPlan,
  laser: ReturnType<typeof useLaserStore.getState>,
) {
  const initialPosition = reportedWorkPositionMm(
    laser,
    laser.controllerSettings?.reportInches === true,
  );
  return rebuildCanvasPlanForGcode(
    planned.source.canvasPlan,
    planned.gcode,
    initialPosition ?? undefined,
  );
}

function toolPlanOption(recovery: CncSupervisedRecoveryJob) {
  const plan = cncToolPlan(recovery.job);
  return plan.length === 0 ? {} : { cncToolPlan: plan };
}

function controllerObservation(laser: ReturnType<typeof useLaserStore.getState>) {
  return {
    statusReport: laser.statusReport,
    wco: laser.wcoCache,
    overrides: laser.ovCache,
    accessories: laser.accessoryCache ?? null,
    workZZeroEvidence: laser.workZZeroEvidence,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
    controllerSessionEpoch: laser.controllerSessionEpoch,
  };
}

async function resolveFailedRecoveryAttempt(
  claimedCapsule: RecoveryCapsule,
  recoveryRunId: string,
  error: unknown,
  repository: RecoveryRepository,
): Promise<void> {
  const state = useLaserStore.getState();
  const attemptId = claimedCapsule.claim?.attemptId ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (state.streamer === null || state.activeRunId !== recoveryRunId) {
    const cleanup = await cleanupRejectedRecoveryAttempt({
      repository,
      sourceRunId: claimedCapsule.runId,
      attemptId,
      stagedRunId: recoveryRunId,
    });
    jobAwareAlert(
      cleanup.retryable
        ? `Could not start CNC recovery:\n\n${message}`
        : `Could not start CNC recovery:\n\n${message}\n\nNo controller command was accepted, but the durable Start handoff or recovery claim could not be cleared. Reload after recovery storage is available.`,
    );
    return;
  }

  const activated = await repository.activateClaimedRecovery({
    sourceRunId: claimedCapsule.runId,
    sourceRevision: claimedCapsule.revision,
    attemptId,
    recoveryRunId,
  });
  if (activated.ok && activated.value) {
    await repository.interruptRun(recoveryRunId, state.streamer.completed, {
      kind: 'write-failed',
      message,
    });
  } else {
    await repository.noteUntrackedRunAccepted();
  }
  jobAwareAlert(
    `CNC recovery transmission became uncertain:\n\n${message}\n\nUse the physical E-stop if unsafe, then inspect and requalify the machine.`,
  );
}

function createAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `cnc-recovery-attempt-${uuid}`;
}
