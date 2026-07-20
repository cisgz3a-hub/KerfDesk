import type { CncResumePoint } from '../../../core/recovery/cnc-resume-point';
import type { JobReviewAcknowledgement } from '../../laser/job-review/job-review-model';
import type { CncSetupAttestation } from '../cnc-setup-attestation';
import type { LaserModeStartEvidence } from '../laser-mode-start-evidence';

export type ExecutionWorkflowV2 =
  | {
      readonly kind: 'ordinary-start';
      readonly completedReplaySourceRunId?: string;
    }
  | {
      readonly kind: 'laser-recovery';
      readonly sourceRunId: string;
      readonly sourceRevision: number;
      readonly sourceAckedLines: number;
      readonly requestedFromLine: number;
      readonly effectiveFromLine: number;
    }
  | {
      readonly kind: 'cnc-supervised-recovery';
      readonly sourceRunId: string;
      readonly sourceRevision: number;
      readonly uncertaintyEventId: string;
      readonly reviewId: string;
      readonly clearedPathProofId: string;
      readonly completedPrefixProofId: string;
      readonly qualificationId: string;
    }
  | {
      readonly kind: 'cnc-pass-recovery';
      readonly sourceRunId: string;
      readonly sourceRevision: number;
      readonly selectedGroupIndex: number;
      readonly selectedPassIndex: number;
      readonly computedDefault: CncResumePoint | null;
    };

export type ControllerWarningsAcknowledgementV2 = 'not-required' | 'confirmed';

export type CncSupervisedRecoveryOperatorReviewV2 = {
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

export type CncPassRecoveryOperatorReviewV2 = {
  readonly cutterClear: boolean;
  readonly spindleStopped: boolean;
  readonly workholdingConfirmed: boolean;
  readonly toolConfirmed: boolean;
  readonly position: { readonly kind: 'retained-confirmed' | 're-zeroed' };
  readonly groupIndex: number;
  readonly passIndex: number;
};

export type ExecutionReviewAcknowledgementV2 =
  | JobReviewAcknowledgement
  | {
      readonly kind: 'laser-recovery';
      readonly controllerWarnings: ControllerWarningsAcknowledgementV2;
      readonly resumeConfirmed: true;
    }
  | {
      readonly kind: 'cnc-supervised-recovery';
      readonly controllerWarnings: ControllerWarningsAcknowledgementV2;
      readonly review: CncSupervisedRecoveryOperatorReviewV2;
      readonly recoveryPackageConfirmed: true;
      readonly cncSetupConfirmed: true;
    }
  | {
      readonly kind: 'cnc-pass-recovery';
      readonly controllerWarnings: ControllerWarningsAcknowledgementV2;
      readonly review: CncPassRecoveryOperatorReviewV2;
      readonly laterBoundary: 'not-required' | 'confirmed';
      readonly recoveryPlanConfirmed: true;
      readonly cncSetupConfirmed: true;
    };

export type ExecutionReviewEvidenceV2 = {
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly acknowledgement: ExecutionReviewAcknowledgementV2;
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
};

export type ExecutionProvenanceEvidenceV2 = {
  readonly workflow: ExecutionWorkflowV2;
  readonly review: ExecutionReviewEvidenceV2;
};

export function ordinaryExecutionEvidence(args: {
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly acknowledgement: JobReviewAcknowledgement;
  readonly completedReplaySourceRunId?: string;
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
}): ExecutionProvenanceEvidenceV2 {
  return {
    workflow: {
      kind: 'ordinary-start',
      ...(args.completedReplaySourceRunId === undefined
        ? {}
        : { completedReplaySourceRunId: args.completedReplaySourceRunId }),
    },
    review: commonReview(args),
  };
}

export function laserRecoveryExecutionEvidence(args: {
  readonly sourceRunId: string;
  readonly sourceRevision: number;
  readonly sourceAckedLines: number;
  readonly requestedFromLine: number;
  readonly effectiveFromLine: number;
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly laserModeStartEvidence: LaserModeStartEvidence;
}): ExecutionProvenanceEvidenceV2 {
  return {
    workflow: {
      kind: 'laser-recovery',
      sourceRunId: args.sourceRunId,
      sourceRevision: args.sourceRevision,
      sourceAckedLines: args.sourceAckedLines,
      requestedFromLine: args.requestedFromLine,
      effectiveFromLine: args.effectiveFromLine,
    },
    review: {
      reviewedAtIso: args.reviewedAtIso,
      warningsShown: [...args.warningsShown],
      acknowledgement: {
        kind: 'laser-recovery',
        controllerWarnings: warningsAcknowledgement(args.warningsShown),
        resumeConfirmed: true,
      },
      laserModeStartEvidence: args.laserModeStartEvidence,
    },
  };
}

export function cncSupervisedRecoveryExecutionEvidence(args: {
  readonly sourceRunId: string;
  readonly sourceRevision: number;
  readonly reviewId: string;
  readonly clearedPathProofId: string;
  readonly completedPrefixProofId: string;
  readonly review: CncSupervisedRecoveryOperatorReviewV2;
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly cncSetupAttestation: CncSetupAttestation;
}): ExecutionProvenanceEvidenceV2 {
  return {
    workflow: {
      kind: 'cnc-supervised-recovery',
      sourceRunId: args.sourceRunId,
      sourceRevision: args.sourceRevision,
      uncertaintyEventId: args.review.uncertaintyEventId,
      reviewId: args.reviewId,
      clearedPathProofId: args.clearedPathProofId,
      completedPrefixProofId: args.completedPrefixProofId,
      qualificationId: args.review.qualificationId,
    },
    review: {
      reviewedAtIso: args.reviewedAtIso,
      warningsShown: [...args.warningsShown],
      acknowledgement: {
        kind: 'cnc-supervised-recovery',
        controllerWarnings: warningsAcknowledgement(args.warningsShown),
        review: { ...args.review },
        recoveryPackageConfirmed: true,
        cncSetupConfirmed: true,
      },
      cncSetupAttestation: args.cncSetupAttestation,
    },
  };
}

export function cncPassRecoveryExecutionEvidence(args: {
  readonly sourceRunId: string;
  readonly sourceRevision: number;
  readonly computedDefault: CncResumePoint | null;
  readonly laterThanComputedDefault: boolean;
  readonly review: CncPassRecoveryOperatorReviewV2;
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly cncSetupAttestation: CncSetupAttestation;
}): ExecutionProvenanceEvidenceV2 {
  return {
    workflow: {
      kind: 'cnc-pass-recovery',
      sourceRunId: args.sourceRunId,
      sourceRevision: args.sourceRevision,
      selectedGroupIndex: args.review.groupIndex,
      selectedPassIndex: args.review.passIndex,
      computedDefault: args.computedDefault,
    },
    review: {
      reviewedAtIso: args.reviewedAtIso,
      warningsShown: [...args.warningsShown],
      acknowledgement: {
        kind: 'cnc-pass-recovery',
        controllerWarnings: warningsAcknowledgement(args.warningsShown),
        review: { ...args.review, position: { ...args.review.position } },
        laterBoundary: args.laterThanComputedDefault ? 'confirmed' : 'not-required',
        recoveryPlanConfirmed: true,
        cncSetupConfirmed: true,
      },
      cncSetupAttestation: args.cncSetupAttestation,
    },
  };
}

function commonReview(args: {
  readonly reviewedAtIso: string;
  readonly warningsShown: ReadonlyArray<string>;
  readonly acknowledgement: JobReviewAcknowledgement;
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
}): ExecutionReviewEvidenceV2 {
  return {
    reviewedAtIso: args.reviewedAtIso,
    warningsShown: [...args.warningsShown],
    acknowledgement: args.acknowledgement,
    ...(args.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: args.laserModeStartEvidence }),
    ...(args.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: args.cncSetupAttestation }),
  };
}

function warningsAcknowledgement(
  warnings: ReadonlyArray<string>,
): ControllerWarningsAcknowledgementV2 {
  return warnings.length === 0 ? 'not-required' : 'confirmed';
}
