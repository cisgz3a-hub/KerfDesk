export type CncCutterEvidence =
  | { readonly kind: 'clear' }
  | { readonly kind: 'engaged' }
  | { readonly kind: 'unknown' };

export type CncToolConditionEvidence =
  | { readonly kind: 'inspected-intact'; readonly inspectionId: string }
  | { readonly kind: 'unknown-or-damaged' };

export type CncSpindleEvidence =
  | { readonly kind: 'physical-running'; readonly feedbackId: string }
  | { readonly kind: 'commanded-running-only' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'unknown' };

export type CncPositionEvidence =
  | { readonly kind: 'retained'; readonly controllerSessionId: string }
  | { readonly kind: 'requalified' }
  | { readonly kind: 'unknown' };

export type CncControllerRecoveryEvidence =
  | { readonly kind: 'manual-only' }
  | {
      readonly kind: 'controller-owned-review-evidence';
      readonly controllerSessionId: string;
      readonly stableHoldProofId: string;
      readonly exclusiveOwnerProofId: string;
    };

export type CncRecoveryEvidence = {
  readonly incident: { readonly kind: 'controlled-hold' } | { readonly kind: 'interruption' };
  readonly cutter: CncCutterEvidence;
  readonly toolCondition: CncToolConditionEvidence;
  readonly spindle: CncSpindleEvidence;
  readonly position: CncPositionEvidence;
  readonly workholding:
    | { readonly kind: 'confirmed-unchanged' }
    | { readonly kind: 'unknown-or-changed' };
  readonly recoveryPackage:
    | { readonly kind: 'exact-match'; readonly digest: string }
    | { readonly kind: 'missing-or-mismatch' };
  readonly controller: CncControllerRecoveryEvidence;
};

export type CncRecoveryRefusalReason =
  | 'tool-engagement-unproved'
  | 'tool-condition-unproved'
  | 'physical-spindle-unproved'
  | 'incident-not-controlled-hold'
  | 'position-unproved'
  | 'workholding-unproved'
  | 'controller-review-evidence-missing'
  | 'controller-session-mismatch'
  | 'package-mismatch';

export type CncRecoveryDecision =
  | {
      readonly kind: 'manual-intervention-required';
      readonly reasons: ReadonlyArray<CncRecoveryRefusalReason>;
    }
  | {
      readonly kind: 'requalification-required';
      readonly reasons: ReadonlyArray<CncRecoveryRefusalReason>;
    }
  | {
      readonly kind: 'controller-escape-review-candidate';
      readonly executable: false;
      readonly controllerSessionId: string;
      readonly stableHoldProofId: string;
      readonly exclusiveOwnerProofId: string;
      readonly spindleFeedbackId: string;
      readonly toolInspectionId: string;
    }
  | {
      readonly kind: 'supervised-recovery-review-candidate';
      readonly executable: false;
      readonly recoveryPackageDigest: string;
      readonly toolInspectionId: string;
    };

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Classifies evidence for review only; no result authorizes machine execution. */
export function assessCncRecovery(evidence: CncRecoveryEvidence): CncRecoveryDecision {
  if (evidence.cutter.kind !== 'clear') return assessPossibleEngagement(evidence);
  return assessClearCutterRecovery(evidence);
}

function assessPossibleEngagement(evidence: CncRecoveryEvidence): CncRecoveryDecision {
  const reasons = possibleEngagementReasons(evidence);
  if (reasons.length > 0 || evidence.controller.kind !== 'controller-owned-review-evidence') {
    return { kind: 'manual-intervention-required', reasons };
  }
  return {
    kind: 'controller-escape-review-candidate',
    executable: false,
    controllerSessionId: evidence.controller.controllerSessionId,
    stableHoldProofId: evidence.controller.stableHoldProofId,
    exclusiveOwnerProofId: evidence.controller.exclusiveOwnerProofId,
    spindleFeedbackId: physicalSpindleFeedbackId(evidence.spindle),
    toolInspectionId: inspectedToolId(evidence.toolCondition),
  };
}

function possibleEngagementReasons(
  evidence: CncRecoveryEvidence,
): ReadonlyArray<CncRecoveryRefusalReason> {
  const possibleReasons: ReadonlyArray<CncRecoveryRefusalReason | null> = [
    evidence.cutter.kind === 'unknown' ? 'tool-engagement-unproved' : null,
    toolConditionReason(evidence),
    spindleReason(evidence),
    evidence.incident.kind === 'controlled-hold' ? null : 'incident-not-controlled-hold',
    positionReason(evidence),
    evidence.workholding.kind === 'confirmed-unchanged' ? null : 'workholding-unproved',
    hasExactPackage(evidence) ? null : 'package-mismatch',
    controllerReason(evidence),
  ];
  return possibleReasons.filter(isRefusalReason);
}

function spindleReason(evidence: CncRecoveryEvidence): CncRecoveryRefusalReason | null {
  if (evidence.spindle.kind !== 'physical-running') return 'physical-spindle-unproved';
  return hasProofValue(evidence.spindle.feedbackId) ? null : 'physical-spindle-unproved';
}

function positionReason(evidence: CncRecoveryEvidence): CncRecoveryRefusalReason | null {
  if (evidence.position.kind !== 'retained') return 'position-unproved';
  return hasProofValue(evidence.position.controllerSessionId) ? null : 'position-unproved';
}

function toolConditionReason(evidence: CncRecoveryEvidence): CncRecoveryRefusalReason | null {
  return inspectedToolId(evidence.toolCondition) === '' ? 'tool-condition-unproved' : null;
}

function controllerReason(evidence: CncRecoveryEvidence): CncRecoveryRefusalReason | null {
  if (!hasControllerReviewEvidence(evidence.controller)) {
    return 'controller-review-evidence-missing';
  }
  if (evidence.position.kind !== 'retained') return null;
  return evidence.controller.controllerSessionId === evidence.position.controllerSessionId
    ? null
    : 'controller-session-mismatch';
}

function isRefusalReason(
  reason: CncRecoveryRefusalReason | null,
): reason is CncRecoveryRefusalReason {
  return reason !== null;
}

function assessClearCutterRecovery(evidence: CncRecoveryEvidence): CncRecoveryDecision {
  const reasons: CncRecoveryRefusalReason[] = [];
  if (toolConditionReason(evidence) !== null) reasons.push('tool-condition-unproved');
  if (
    evidence.position.kind === 'unknown' ||
    (evidence.position.kind === 'retained' && !hasProofValue(evidence.position.controllerSessionId))
  ) {
    reasons.push('position-unproved');
  }
  if (evidence.workholding.kind !== 'confirmed-unchanged') reasons.push('workholding-unproved');
  if (!hasExactPackage(evidence)) reasons.push('package-mismatch');
  if (reasons.length > 0 || evidence.recoveryPackage.kind !== 'exact-match') {
    return { kind: 'requalification-required', reasons };
  }
  return {
    kind: 'supervised-recovery-review-candidate',
    executable: false,
    recoveryPackageDigest: evidence.recoveryPackage.digest,
    toolInspectionId: inspectedToolId(evidence.toolCondition),
  };
}

function hasControllerReviewEvidence(
  controller: CncControllerRecoveryEvidence,
): controller is Extract<
  CncControllerRecoveryEvidence,
  { readonly kind: 'controller-owned-review-evidence' }
> {
  return (
    controller.kind === 'controller-owned-review-evidence' &&
    hasProofValue(controller.controllerSessionId) &&
    hasProofValue(controller.stableHoldProofId) &&
    hasProofValue(controller.exclusiveOwnerProofId)
  );
}

function hasExactPackage(evidence: CncRecoveryEvidence): boolean {
  return (
    evidence.recoveryPackage.kind === 'exact-match' &&
    SHA256_DIGEST_PATTERN.test(evidence.recoveryPackage.digest)
  );
}

function hasProofValue(value: string): boolean {
  return value.trim().length > 0;
}

function physicalSpindleFeedbackId(spindle: CncSpindleEvidence): string {
  return spindle.kind === 'physical-running' ? spindle.feedbackId : '';
}

function inspectedToolId(tool: CncToolConditionEvidence): string {
  return tool.kind === 'inspected-intact' && hasProofValue(tool.inspectionId)
    ? tool.inspectionId
    : '';
}
