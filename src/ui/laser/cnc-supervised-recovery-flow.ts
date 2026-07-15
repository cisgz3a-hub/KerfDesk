import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import {
  assessCncRecovery,
  buildCncRecoveryEventManifest,
  type CncContourRunwayPlan,
  type CncRecoveryEventManifest,
  type CncRunwayProfile,
} from '../../core/recovery/cnc';
import { createCncSupervisedRecoveryPackageIdentity } from '../../core/recovery/cnc-recovery-package';
import { recoveryEventsEqual } from '../../core/recovery/cnc-contour-runway-source';
import {
  buildCncSupervisedRecoveryJob,
  cncSupervisedRecoveryRunwayProfile,
  type CncSupervisedRecoveryJob,
} from '../../core/recovery/cnc-supervised-recovery-job';
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
  type RecoveryCapsule,
  type RecoveryRepository,
} from '../state/recovery';
import {
  claimCncRecoveryCapsule,
  streamCncRecoveryProgram,
} from './cnc-supervised-recovery-stream';
import {
  prepareArchivedRecoverySource,
  prepareRecoverySource,
  type PreparedRecoverySource,
} from './start-job-source';

export type CncSupervisedRecoveryReview = {
  readonly uncertaintyEventId: string;
  readonly qualificationId: string;
  readonly cutterClear: boolean;
  readonly spindleStopped: boolean;
  readonly positionRequalified: boolean;
  readonly toolInspected: boolean;
  readonly workholdingConfirmed: boolean;
  readonly priorWorkConfirmed: boolean;
  readonly clearedPathConfirmed: boolean;
};

type RecoverySource = PreparedRecoverySource;
type RecoveryContext = {
  readonly source: RecoverySource;
  readonly manifest: CncRecoveryEventManifest;
  readonly reviewId: string;
  readonly clearedPathProofId: string;
  readonly completedPrefixProofId: string;
  readonly profile: CncRunwayProfile;
  readonly uncertaintyEventId: string;
};
type PlannedRecovery = RecoveryContext & {
  readonly recovery: CncSupervisedRecoveryJob;
  readonly gcode: string;
};

export async function runCncSupervisedRecoveryFlow(
  capsule: RecoveryCapsule,
  review: CncSupervisedRecoveryReview,
  repository: RecoveryRepository = recoveryRepository,
): Promise<boolean> {
  const context = prepareRecoveryContext(capsule, review);
  if (context === null) return false;
  const planned = planRecoveryProgram(capsule, context);
  if (planned === null) return false;
  if (!(await authorizeRecoveryPackage(planned))) return false;
  const attestation = confirmRecoveryStart(planned);
  if (attestation === null) return false;
  const claimed = await claimCncRecoveryCapsule(capsule, repository);
  if (claimed === null) return false;
  return streamCncRecoveryProgram(planned, attestation, claimed, repository);
}

function prepareRecoveryContext(
  capsule: RecoveryCapsule,
  review: CncSupervisedRecoveryReview,
): RecoveryContext | null {
  if (capsule.artifact.machineKind !== 'cnc') {
    jobAwareAlert('Cannot start CNC recovery:\n\nThe retained checkpoint is not a CNC job.');
    return null;
  }
  const reviewIssue = validateReview(review);
  if (reviewIssue !== null) {
    jobAwareAlert(`Cannot start CNC recovery:\n\n${reviewIssue}`);
    return null;
  }
  const source = recoverySource(capsule);
  if (source === null) return null;
  const manifest = recoveryManifest(capsule, source);
  if (manifest === null) return null;
  const priorEventId = priorCutEventId(review.uncertaintyEventId);
  if (priorEventId === null) {
    jobAwareAlert(
      'Cannot start CNC recovery:\n\nThe first contour segment has no proven tangent runway. ' +
        'Select a later uncertain segment or create a separately reviewed new job.',
    );
    return null;
  }
  const reviewId = createReviewId();
  return {
    source,
    manifest,
    reviewId,
    clearedPathProofId: `${reviewId}/clear-through/${priorEventId}`,
    completedPrefixProofId: `${reviewId}/complete-before/${review.uncertaintyEventId}`,
    uncertaintyEventId: review.uncertaintyEventId,
    profile: cncSupervisedRecoveryRunwayProfile(
      source.project.device.accelMmPerSec2,
      review.qualificationId,
    ),
  };
}

function planRecoveryProgram(
  capsule: RecoveryCapsule,
  context: RecoveryContext,
): PlannedRecovery | null {
  const recovery = buildCncSupervisedRecoveryJob({
    job: context.source.prepared.job,
    manifest: context.manifest,
    uncertaintyEventId: context.uncertaintyEventId,
    profile: context.profile,
    clearedPathEvidence: clearedPathEvidence(context),
  });
  if (recovery.kind !== 'recovery-job') {
    jobAwareAlert(`Cannot start CNC recovery:\n\n${describeRecoveryRefusal(recovery.reason)}`);
    return null;
  }
  const emitted = emitPreparedGcode(
    { ...context.source.prepared, job: recovery.job },
    recoveryEmitOptions(capsule, context.source),
  );
  if (!emitted.preflight.ok) {
    const messages = emitted.preflight.issues.map((issue) => `• ${issue.message}`).join('\n');
    jobAwareAlert(`Cannot start CNC recovery:\n\n${messages}`);
    return null;
  }
  return { ...context, recovery, gcode: emitted.gcode };
}

function clearedPathEvidence(context: RecoveryContext) {
  const eventId = priorCutEventId(context.uncertaintyEventId);
  return {
    kind: 'operator-confirmed-through-event' as const,
    eventId: eventId ?? '',
    proofId: context.clearedPathProofId,
  };
}

function recoveryEmitOptions(capsule: RecoveryCapsule, source: RecoverySource) {
  return {
    outputScope: capsule.artifact.outputScope,
    ...(source.jobOrigin === undefined ? {} : { jobOrigin: source.jobOrigin }),
    ...(source.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: source.preflightMotionOffset }),
  };
}

async function authorizeRecoveryPackage(planned: PlannedRecovery): Promise<boolean> {
  const packageIdentity = await createCncSupervisedRecoveryPackageIdentity({
    sourceGcode: planned.source.gcode,
    recoveryGcode: planned.gcode,
    plan: planned.recovery.plan,
    profile: planned.profile,
    reviewId: planned.reviewId,
    clearedPathProofId: planned.clearedPathProofId,
    completedPrefixProofId: planned.completedPrefixProofId,
  });
  if (packageIdentity.kind !== 'ok') {
    jobAwareAlert(
      'Cannot start CNC recovery:\n\nThe exact SHA-256 recovery package could not be created.',
    );
    return false;
  }
  const decision = assessCncRecovery({
    incident: { kind: 'interruption' },
    cutter: { kind: 'clear' },
    toolCondition: { kind: 'inspected-intact', inspectionId: planned.reviewId },
    spindle: { kind: 'stopped' },
    position: { kind: 'requalified' },
    workholding: { kind: 'confirmed-unchanged' },
    recoveryPackage: { kind: 'exact-match', digest: packageIdentity.identity.digest },
    controller: { kind: 'manual-only' },
    operatorReview: {
      kind: 'complete',
      reviewId: planned.reviewId,
      clearedPathProofId: planned.clearedPathProofId,
      completedPrefixProofId: planned.completedPrefixProofId,
      runwayQualificationId: planned.profile.qualificationId,
    },
  });
  if (decision.kind === 'supervised-recovery-authorized' && decision.executable) return true;
  jobAwareAlert('Cannot start CNC recovery:\n\nThe fail-closed recovery policy refused execution.');
  return false;
}

function confirmRecoveryStart(planned: PlannedRecovery): CncSetupAttestation | null {
  if (!confirmWarnings(planned.source.warnings)) return null;
  if (
    !jobAwareConfirm(recoveryConfirmation(planned.recovery.plan, planned.profile.qualificationId))
  ) {
    return null;
  }
  if (!jobAwareConfirm(CNC_SETUP_ATTESTATION_PROMPT)) return null;
  const laser = useLaserStore.getState();
  return createCncSetupAttestation(
    planned.gcode,
    cncControllerEpochOf(laser),
    reducedOverrideAcknowledgement(laser.ovCache),
  );
}

function recoverySource(capsule: RecoveryCapsule): RecoverySource | null {
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
      'Cannot start legacy CNC recovery:\n\nThe current project does not reproduce the saved G-code fingerprint. No controller command was sent.',
    );
    return null;
  }
  return source;
}

function recoveryManifest(
  capsule: RecoveryCapsule,
  source: RecoverySource,
): CncRecoveryEventManifest | null {
  if (capsule.artifact.kind === 'legacy-fingerprint-only') {
    return buildCncRecoveryEventManifest(source.prepared.job);
  }
  const archived = capsule.artifact.cncRecoveryManifest;
  const rebuilt = buildCncRecoveryEventManifest(source.prepared.job);
  if (
    archived !== undefined &&
    archived.events.length === rebuilt.events.length &&
    archived.events.every((event, index) => {
      const rebuiltEvent = rebuilt.events[index];
      return rebuiltEvent !== undefined && recoveryEventsEqual(event, rebuiltEvent);
    })
  ) {
    return archived;
  }
  jobAwareAlert(
    'Cannot start CNC recovery:\n\nThe sealed semantic recovery manifest is missing or inconsistent with its archived prepared job.',
  );
  return null;
}

function validateReview(review: CncSupervisedRecoveryReview): string | null {
  if (!review.cutterClear) return 'Confirm that the cutter is physically clear before any motion.';
  if (!review.spindleStopped) return 'Confirm that the spindle is physically stopped.';
  if (!review.positionRequalified)
    return 'Re-home or otherwise requalify position, WCS, and Z zero.';
  if (!review.toolInspected)
    return 'Inspect the installed tool and confirm it is intact and correct.';
  if (!review.workholdingConfirmed)
    return 'Confirm that stock and workholding are unchanged and secure.';
  if (!review.priorWorkConfirmed)
    return 'Confirm that all machining before the selected uncertainty segment is complete.';
  if (!review.clearedPathConfirmed)
    return 'Confirm that the selected tangent runway is physically clear.';
  if (review.qualificationId.trim() === '') {
    return 'Enter the machine-specific air-cut or scrap-test qualification record for this runway profile.';
  }
  if (review.uncertaintyEventId.trim() === '') return 'Select the first uncertain contour segment.';
  return null;
}

function priorCutEventId(eventId: string): string | null {
  const match = /^(.*\/cut-)(\d+)$/.exec(eventId);
  if (match === null) return null;
  const segment = Number(match[2]);
  return Number.isInteger(segment) && segment > 1 ? `${match[1]}${segment - 1}` : null;
}

function createReviewId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `operator-review:${uuid ?? new Date().toISOString()}`;
}

function confirmWarnings(warnings: ReadonlyArray<string>): boolean {
  if (warnings.length === 0) return true;
  const lines = warnings.map((warning) => `• ${warning}`).join('\n');
  return jobAwareConfirm(`Controller warning:\n\n${lines}\n\nContinue recovery review?`);
}

function recoveryConfirmation(plan: CncContourRunwayPlan, qualificationId: string): string {
  return (
    'START SUPERVISED CNC RECOVERY?\n\n' +
    `Selected event: ${plan.eventId}\n` +
    `Runway: ${plan.requiredRunwayMm.toFixed(2)} mm at ${plan.motion.feedMmPerMin} mm/min\n` +
    `Cut depth: ${plan.motion.cutZMm.toFixed(3)} mm; safe Z: ${plan.motion.safeZMm.toFixed(3)} mm\n` +
    `Spindle: ${plan.motion.spindleRpm} rpm with ${plan.motion.spindleSpinupSec} s dwell\n` +
    `Qualification record: ${qualificationId.trim()}\n\n` +
    'All machining before the selected event will be omitted and must already be complete.\n\n' +
    'The machine will retract to safe Z, start and dwell the spindle, move to the confirmed-clear ' +
    'runway, plunge there, and replay the selected uncertainty zone plus all later work. Keep the ' +
    'physical E-stop reachable and supervise the entire re-entry.'
  );
}

function describeRecoveryRefusal(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    'first-segment-unproved': 'The first segment has no preceding cleared runway.',
    'cleared-path-unproved': 'The selected preceding contour segment was not confirmed clear.',
    'insufficient-cleared-distance': 'The selected segment has too little straight cleared runway.',
    'non-tangent-runway':
      'The available cleared path turns before re-entry and cannot be a runway.',
    'event-not-runway-eligible': 'This operation is not supported by supervised contour recovery.',
    'invalid-profile': 'The runway qualification reference or parameters are invalid.',
  };
  return labels[reason] ?? `Recovery planning was refused (${reason}).`;
}
