import { buildResumeProgram } from '../../core/controllers/grbl';
import { streamingModeForController } from '../../core/devices';
import { fingerprintGcode, fingerprintsEqual, rawResumeLine } from '../../core/recovery';
import { rebuildCanvasPlanForGcode, reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import {
  createExecutionArtifact,
  createRunId,
  recoveryRepository,
  type RecoveryCapsule,
  type RecoveryRepository,
} from '../state/recovery';
import {
  prepareArchivedRecoverySource,
  prepareRecoverySource,
  type PreparedRecoverySource,
} from './start-job-source';
import { resumeConfirmation } from './resume-confirmation';

const LASER_RESUME_PLUNGE_MM_PER_MIN = 300;

/** Final, explicit activation for the sealed laser recovery dialog. Review and
 * cancellation never call this function and therefore cannot claim a capsule. */
export async function runLaserRecoveryCapsuleFlow(
  capsule: RecoveryCapsule,
  repository: RecoveryRepository = recoveryRepository,
): Promise<boolean> {
  const planned = planLaserRecovery(capsule);
  if (planned === null) return false;
  const claim = await claimLaserRecovery(capsule, repository);
  if (claim === null) return false;
  const attempt = await stageLaserRecoveryAttempt(planned, claim, repository);
  return attempt === null ? false : streamLaserRecoveryAttempt(attempt, repository);
}

type PlannedLaserRecovery = {
  readonly capsule: RecoveryCapsule;
  readonly source: PreparedRecoverySource;
  readonly resumeGcode: string;
};

type ClaimedLaserRecovery = {
  readonly attemptId: string;
  readonly capsule: RecoveryCapsule;
};

type StagedLaserRecovery = PlannedLaserRecovery &
  ClaimedLaserRecovery & {
    readonly recoveryRunId: string;
    readonly canvasPlan: ReturnType<typeof rebuildCanvasPlanForGcode>;
    readonly laser: ReturnType<typeof useLaserStore.getState>;
  };

function planLaserRecovery(capsule: RecoveryCapsule): PlannedLaserRecovery | null {
  if (capsule.artifact.machineKind !== 'laser') {
    jobAwareAlert('Cannot start laser recovery:\n\nThe saved artifact is not a laser job.');
    return null;
  }
  const source = recoverySource(capsule);
  if (source === null) return null;
  const fromLine = rawResumeLine(source.gcode, capsule.ackedLines);
  const resume = buildResumeProgram(source.gcode, fromLine, {
    machineKind: 'laser',
    safeZMm: 0,
    spindleSpinupSec: 0,
    plungeMmPerMin: LASER_RESUME_PLUNGE_MM_PER_MIN,
  });
  if (resume.kind === 'error') {
    jobAwareAlert(`Cannot resume from line ${fromLine}:\n\n${resume.reason}`);
    return null;
  }
  if (!confirmWarnings(source.warnings)) return null;
  if (!jobAwareConfirm(resumeConfirmation('laser', fromLine, resume.fromLine))) return null;
  return { capsule, source, resumeGcode: resume.lines.join('\n') };
}

async function claimLaserRecovery(
  capsule: RecoveryCapsule,
  repository: RecoveryRepository,
): Promise<ClaimedLaserRecovery | null> {
  const attemptId = createAttemptId();
  const claimed = await repository.claimRecovery({
    runId: capsule.runId,
    revision: capsule.revision,
    attemptId,
  });
  if (!claimed.ok) {
    jobAwareAlert(
      'Cannot start laser recovery:\n\nThe saved recovery changed or was claimed in another window. Re-open the current recovery card.',
    );
    return null;
  }
  return { attemptId, capsule: claimed.value };
}

async function stageLaserRecoveryAttempt(
  planned: PlannedLaserRecovery,
  claim: ClaimedLaserRecovery,
  repository: RecoveryRepository,
): Promise<StagedLaserRecovery | null> {
  const laser = useLaserStore.getState();
  const initialPosition = reportedWorkPositionMm(
    laser,
    laser.controllerSettings?.reportInches === true,
  );
  const canvasPlan = rebuildCanvasPlanForGcode(
    planned.source.canvasPlan,
    planned.resumeGcode,
    initialPosition ?? undefined,
  );
  const recoveryRunId = createRunId();
  const artifact = createExecutionArtifact({
    runId: recoveryRunId,
    gcode: planned.resumeGcode,
    prepared: planned.source.prepared,
    outputScope: planned.capsule.artifact.outputScope,
    ...(planned.source.jobOrigin === undefined ? {} : { jobOrigin: planned.source.jobOrigin }),
    canvasPlan,
    controllerSettings: laser.controllerSettings,
    controllerObservation: controllerObservation(laser),
    createdAtIso: new Date().toISOString(),
  });
  const staged = await repository.stageArtifact(artifact);
  if (!staged.ok) {
    await repository.releaseRecoveryClaim(planned.capsule.runId, claim.attemptId);
    jobAwareAlert(
      'Cannot start supervised recovery:\n\nThe recovery attempt could not be stored safely. The saved job remains available and no controller command was sent.',
    );
    return null;
  }
  return { ...planned, ...claim, recoveryRunId, canvasPlan, laser };
}

async function streamLaserRecoveryAttempt(
  attempt: StagedLaserRecovery,
  repository: RecoveryRepository,
): Promise<boolean> {
  try {
    await attempt.laser.startJob(attempt.resumeGcode, {
      runId: attempt.recoveryRunId,
      streamingMode: streamingModeForController(
        attempt.source.project.device.controllerKind,
        attempt.source.project.device.streamingMode,
      ),
      rxBufferBytes: attempt.source.project.device.rxBufferBytes,
      machineKind: 'laser',
      canvasPlan: attempt.canvasPlan,
    });
  } catch (error) {
    await resolveFailedAttempt({
      repository,
      sourceCapsule: attempt.capsule,
      attemptId: attempt.attemptId,
      recoveryRunId: attempt.recoveryRunId,
      error,
    });
    return false;
  }

  const activated = await repository.activateClaimedRecovery({
    sourceRunId: attempt.capsule.runId,
    sourceRevision: attempt.capsule.revision,
    attemptId: attempt.attemptId,
    recoveryRunId: attempt.recoveryRunId,
  });
  if (!activated.ok || !activated.value) {
    await repository.noteUntrackedRunAccepted();
    jobAwareAlert(
      'Laser recovery started, but recovery tracking is unavailable for this attempt. Supervise the machine and use Abort if anything is unsafe.',
    );
  }
  return true;
}

function recoverySource(capsule: RecoveryCapsule) {
  if (capsule.artifact.kind === 'exact-execution') {
    return prepareArchivedRecoverySource(capsule.artifact);
  }
  const source = prepareRecoverySource({
    outputScope: capsule.artifact.outputScope,
    ...(capsule.artifact.jobOrigin === undefined ? {} : { jobOrigin: capsule.artifact.jobOrigin }),
  });
  if (source === null) return null;
  if (!fingerprintsEqual(fingerprintGcode(source.gcode), capsule.artifact.fingerprint)) {
    jobAwareAlert(
      'Cannot start legacy laser recovery:\n\nThe current project does not reproduce the saved G-code fingerprint. No controller command was sent.',
    );
    return null;
  }
  return source;
}

async function resolveFailedAttempt(args: {
  readonly repository: RecoveryRepository;
  readonly sourceCapsule: RecoveryCapsule;
  readonly attemptId: string;
  readonly recoveryRunId: string;
  readonly error: unknown;
}): Promise<void> {
  const state = useLaserStore.getState();
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  if (state.streamer === null || state.activeRunId !== args.recoveryRunId) {
    await args.repository.releaseRecoveryClaim(args.sourceCapsule.runId, args.attemptId);
    await args.repository.discardStagedRun(args.recoveryRunId);
    jobAwareAlert(`Could not start laser recovery:\n\n${message}`);
    return;
  }
  const activated = await args.repository.activateClaimedRecovery({
    sourceRunId: args.sourceCapsule.runId,
    sourceRevision: args.sourceCapsule.revision,
    attemptId: args.attemptId,
    recoveryRunId: args.recoveryRunId,
  });
  if (activated.ok && activated.value) {
    await args.repository.interruptRun(args.recoveryRunId, state.streamer.completed, {
      kind: 'write-failed',
      message,
    });
  } else {
    await args.repository.noteUntrackedRunAccepted();
  }
  jobAwareAlert(
    `Laser recovery transmission became uncertain:\n\n${message}\n\nInspect and requalify the machine before any further motion.`,
  );
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

function confirmWarnings(warnings: ReadonlyArray<string>): boolean {
  if (warnings.length === 0) return true;
  return jobAwareConfirm(
    `Controller warning:\n\n${warnings.map((warning) => `• ${warning}`).join('\n')}\n\nContinue recovery?`,
  );
}

function createAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `recovery-attempt-${uuid}`;
}
