// runCncPassRecoveryFlow (ADR-215) — pass-boundary CNC recovery over the same
// sealed-capsule sandbox as laser recovery: everything is planned from the
// capsule's sealed artifact (never the open canvas), the recovery program is
// staged as a new attempt artifact and durably armed BEFORE any controller
// write, and the final wire-boundary authorization re-checks the live
// controller. Streaming reuses cnc-supervised-recovery-stream.ts unchanged.

import { buildCncPassResumeJob } from '../../core/recovery/cnc-pass-resume-job';
import { emitPreparedGcode } from '../../io/gcode';
import { reducedOverrideAcknowledgement } from '../state/cnc-accessory-readiness';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import {
  recoveryRepository,
  type ExecutionArtifactV1,
  type RecoveryCapsule,
  type RecoveryRepository,
} from '../state/recovery';
import { cncPassRecoveryDefaultPoint } from './cnc-pass-recovery-model';
import {
  cncPassRecoveryReviewIssue,
  isLaterThanDefault,
  latePickWarning,
  passRecoveryConfirmation,
  retainedPositionIssue,
  type CncPassRecoveryReview,
} from './cnc-pass-recovery-review';
import {
  claimCncRecoveryCapsule,
  streamCncRecoveryProgram,
  type CncRecoveryStreamPlan,
} from './cnc-supervised-recovery-stream';
import { prepareArchivedRecoverySource } from './start-job-source';

export async function runCncPassRecoveryFlow(
  capsule: RecoveryCapsule,
  review: CncPassRecoveryReview,
  repository: RecoveryRepository = recoveryRepository,
): Promise<boolean> {
  const artifact = sealedCncArtifact(capsule);
  if (artifact === null) return false;
  if (!confirmReview(capsule, review)) return false;
  const planned = planPassRecovery(capsule, artifact, review);
  if (planned === null) return false;
  const attestation = confirmRecoveryStart(planned);
  if (attestation === null) return false;
  const claimed = await claimCncRecoveryCapsule(capsule, repository);
  if (claimed === null) return false;
  return streamCncRecoveryProgram(planned, attestation, claimed, repository);
}

function sealedCncArtifact(capsule: RecoveryCapsule): ExecutionArtifactV1 | null {
  if (capsule.artifact.machineKind !== 'cnc') {
    jobAwareAlert('Cannot start CNC recovery:\n\nThe retained checkpoint is not a CNC job.');
    return null;
  }
  if (capsule.artifact.kind !== 'exact-execution') {
    jobAwareAlert(
      'Cannot start pass recovery:\n\nThis migrated fingerprint-only record has no sealed ' +
        'prepared job. Use the legacy recovery review instead.',
    );
    return null;
  }
  return capsule.artifact;
}

function confirmReview(capsule: RecoveryCapsule, review: CncPassRecoveryReview): boolean {
  const issue = cncPassRecoveryReviewIssue(review);
  if (issue !== null) {
    jobAwareAlert(`Cannot start CNC recovery:\n\n${issue}`);
    return false;
  }
  if (review.position.kind === 'retained-confirmed') {
    const positionIssue = retainedPositionIssue(capsule, useLaserStore.getState().wcoCache);
    if (positionIssue !== null) {
      jobAwareAlert(`Cannot use retained position:\n\n${positionIssue}`);
      return false;
    }
  }
  return true;
}

function planPassRecovery(
  capsule: RecoveryCapsule,
  artifact: ExecutionArtifactV1,
  review: CncPassRecoveryReview,
): CncRecoveryStreamPlan | null {
  const source = prepareArchivedRecoverySource(artifact);
  if (source === null) return null;
  const resumePoint = cncPassRecoveryDefaultPoint(capsule);
  if (isLaterThanDefault(review, resumePoint) && resumePoint?.kind === 'resume-at-pass') {
    if (!jobAwareConfirm(latePickWarning(resumePoint))) return null;
  }
  const resume = buildCncPassResumeJob(source.prepared.job, review.groupIndex, review.passIndex);
  if (resume.kind !== 'resume-job') {
    jobAwareAlert(`Cannot start CNC recovery:\n\n${describeResumeRefusal(resume.reason)}`);
    return null;
  }
  const emitted = emitPreparedGcode(
    { ...source.prepared, job: resume.job },
    {
      outputScope: capsule.artifact.outputScope,
      ...(source.jobOrigin === undefined ? {} : { jobOrigin: source.jobOrigin }),
      ...(source.preflightMotionOffset === undefined
        ? {}
        : { preflightMotionOffset: source.preflightMotionOffset }),
    },
  );
  if (!emitted.preflight.ok) {
    const messages = emitted.preflight.issues.map((issue) => `• ${issue.message}`).join('\n');
    jobAwareAlert(`Cannot start CNC recovery:\n\n${messages}`);
    return null;
  }
  if (!confirmWarnings(source.warnings)) return null;
  if (!confirmPlan(review, resume)) return null;
  return { source, recovery: { job: resume.job }, gcode: emitted.gcode };
}

function confirmPlan(
  review: CncPassRecoveryReview,
  resume: Extract<ReturnType<typeof buildCncPassResumeJob>, { kind: 'resume-job' }>,
): boolean {
  const boundaryGroup = resume.job.groups[0];
  if (boundaryGroup?.kind !== 'cnc') return false;
  return jobAwareConfirm(
    passRecoveryConfirmation(review, resume, {
      spindleRpm: boundaryGroup.spindleRpm,
      spindleSpinupSec: boundaryGroup.spindleSpinupSec,
    }),
  );
}

function confirmRecoveryStart(planned: CncRecoveryStreamPlan): CncSetupAttestation | null {
  if (!jobAwareConfirm(CNC_SETUP_ATTESTATION_PROMPT)) return null;
  const laser = useLaserStore.getState();
  return createCncSetupAttestation(
    planned.gcode,
    cncControllerEpochOf(laser),
    reducedOverrideAcknowledgement(laser.ovCache),
  );
}

function describeResumeRefusal(reason: 'invalid-resume-index' | 'non-cnc-group'): string {
  return reason === 'invalid-resume-index'
    ? 'The selected pass does not exist in the sealed prepared job.'
    : 'The sealed prepared job is not a pure CNC program.';
}

function confirmWarnings(warnings: ReadonlyArray<string>): boolean {
  if (warnings.length === 0) return true;
  const lines = warnings.map((warning) => `• ${warning}`).join('\n');
  return jobAwareConfirm(`Controller warning:\n\n${lines}\n\nContinue recovery?`);
}
