import type { ExecutionProvenanceV2 } from './execution-provenance';
import {
  hasValidGrblBuildInfo,
  hasValidNullableObservation,
} from './execution-provenance-controller-validation';
import {
  MAX_RAW_LINE_CHARS,
  MAX_WARNINGS,
  isBoundedString,
  isBoundedStringArray,
  isFiniteNonNegative,
  isIsoTimestamp,
  isOptionalRunId,
  isPositiveInteger,
  isRecord,
  isRunId,
  isSafeNonNegativeInteger,
} from './execution-provenance-validation-helpers';
import type { ExecutionWorkflowV2 } from './execution-workflow-evidence';

export function hasValidLegacyReview(value: unknown): boolean {
  if (!hasValidReviewBase(value) || !isRecord(value)) return false;
  if (!hasValidJobReviewAcknowledgement(value['acknowledgement'])) return false;
  return hasValidOptionalStartEvidence(value);
}

export function hasValidV2Review(provenance: ExecutionProvenanceV2): boolean {
  const value = provenance.review as unknown;
  if (!hasValidReviewBase(value) || !isRecord(value)) return false;
  if (!hasValidReviewAcknowledgement(value['acknowledgement'])) return false;
  if (!hasValidOptionalStartEvidence(value)) return false;
  if (!startEvidenceMatchesController(value, provenance.controller)) return false;
  return hasValidWorkflow(provenance.workflow) && workflowMatchesReview(provenance.workflow, value);
}

function startEvidenceMatchesController(
  review: Record<string, unknown>,
  controller: ExecutionProvenanceV2['controller'],
): boolean {
  const evidence = review['laserModeStartEvidence'];
  if (evidence === undefined) return true;
  if (!isRecord(evidence) || evidence['controllerSessionEpoch'] !== controller.sessionEpoch) {
    return false;
  }
  if (!sameObservation(evidence['settingsObservation'], controller.settingsObservation)) {
    return false;
  }
  const buildObservation = evidence['buildInfoObservation'];
  if (buildObservation === null) return controller.buildInfo === null;
  if (controller.buildInfo === null) return false;
  return (
    sameObservation(buildObservation, controller.buildInfo.observation) &&
    sameBuildInfo(evidence['controllerBuildInfo'], controller.buildInfo.parsed)
  );
}

function sameObservation(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  return (
    isRecord(left) &&
    isRecord(right) &&
    left['sessionEpoch'] === right['sessionEpoch'] &&
    left['observedAt'] === right['observedAt']
  );
}

function sameBuildInfo(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (!isRecord(left) || !isRecord(right)) return false;
  return (
    left['protocolVersion'] === right['protocolVersion'] &&
    left['buildRevision'] === right['buildRevision'] &&
    left['userInfo'] === right['userInfo'] &&
    left['plannerBufferBlocks'] === right['plannerBufferBlocks'] &&
    left['rxBufferBytes'] === right['rxBufferBytes'] &&
    sameStringArray(left['optionCodes'], right['optionCodes'])
  );
}

function sameStringArray(left: unknown, right: unknown): boolean {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasValidReviewBase(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIsoTimestamp(value['reviewedAtIso']) &&
    isBoundedStringArray(value['warningsShown'], MAX_WARNINGS, MAX_RAW_LINE_CHARS)
  );
}

function hasValidReviewAcknowledgement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (hasValidJobReviewAcknowledgement(value)) return true;
  if (!hasValidWarningsAcknowledgement(value['controllerWarnings'])) return false;
  switch (value['kind']) {
    case 'laser-recovery':
      return value['resumeConfirmed'] === true;
    case 'cnc-supervised-recovery':
      return hasValidSupervisedAcknowledgement(value);
    case 'cnc-pass-recovery':
      return hasValidPassAcknowledgement(value);
    default:
      return false;
  }
}

function hasValidWarningsAcknowledgement(value: unknown): boolean {
  return value === 'not-required' || value === 'confirmed';
}

function hasValidSupervisedAcknowledgement(value: Record<string, unknown>): boolean {
  return (
    value['recoveryPackageConfirmed'] === true &&
    value['cncSetupConfirmed'] === true &&
    hasValidSupervisedReview(value['review'])
  );
}

function hasValidPassAcknowledgement(value: Record<string, unknown>): boolean {
  const laterBoundary = value['laterBoundary'];
  return (
    (laterBoundary === 'not-required' || laterBoundary === 'confirmed') &&
    value['recoveryPlanConfirmed'] === true &&
    value['cncSetupConfirmed'] === true &&
    hasValidPassReview(value['review'])
  );
}

function hasValidJobReviewAcknowledgement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'laser-verified') return true;
  return (
    (value['kind'] === 'laser-unverified' || value['kind'] === 'cnc') &&
    isBoundedString(value['prompt'], 1)
  );
}

function hasValidSupervisedReview(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value['uncertaintyEventId'], 1) &&
    isBoundedString(value['qualificationId'], 1) &&
    value['cutterClear'] === true &&
    value['spindleStopped'] === true &&
    value['positionRequalified'] === true &&
    value['toolInspected'] === true &&
    value['workholdingConfirmed'] === true &&
    value['priorWorkConfirmed'] === true &&
    value['clearedPathConfirmed'] === true
  );
}

function hasValidPassReview(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value['position'])) return false;
  return (
    value['cutterClear'] === true &&
    value['spindleStopped'] === true &&
    value['workholdingConfirmed'] === true &&
    value['toolConfirmed'] === true &&
    hasValidPositionKind(value['position']['kind']) &&
    isSafeNonNegativeInteger(value['groupIndex']) &&
    isSafeNonNegativeInteger(value['passIndex'])
  );
}

function hasValidPositionKind(value: unknown): boolean {
  return value === 'retained-confirmed' || value === 're-zeroed';
}

function hasValidOptionalStartEvidence(review: Record<string, unknown>): boolean {
  const laserEvidence = review['laserModeStartEvidence'];
  const cncAttestation = review['cncSetupAttestation'];
  if (laserEvidence !== undefined && !hasValidLaserModeEvidence(laserEvidence)) return false;
  return cncAttestation === undefined || hasValidCncSetupAttestation(cncAttestation);
}

function hasValidLaserModeEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasValidLaserSnapshot(value) && hasValidLaserRequirements(value);
}

function hasValidLaserSnapshot(value: Record<string, unknown>): boolean {
  if (!isSafeNonNegativeInteger(value['controllerSessionEpoch'])) return false;
  if (!hasValidSettingsCapability(value['settingsCapability'])) return false;
  if (!hasValidNullableObservation(value['settingsObservation'])) return false;
  if (!isOptionalBoolean(value['laserModeEnabled'])) return false;
  if (!isOptionalFiniteNonNegative(value['maxPowerS'])) return false;
  if (
    value['controllerBuildInfo'] !== null &&
    !hasValidGrblBuildInfo(value['controllerBuildInfo'])
  ) {
    return false;
  }
  return hasValidNullableObservation(value['buildInfoObservation']);
}

function hasValidLaserRequirements(value: Record<string, unknown>): boolean {
  return (
    isFiniteNonNegative(value['expectedMaxPowerS']) &&
    typeof value['m7Required'] === 'boolean' &&
    typeof value['unverifiedAcknowledged'] === 'boolean'
  );
}

function hasValidSettingsCapability(value: unknown): boolean {
  return value === 'grbl-dollar' || value === 'readonly-dump' || value === 'none';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalFiniteNonNegative(value: unknown): boolean {
  return value === undefined || isFiniteNonNegative(value);
}

function hasValidCncSetupAttestation(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value['controllerEpoch'])) return false;
  return (
    value['workholdingSecured'] === true &&
    value['motionEnvelopeClear'] === true &&
    value['setupHardwareRemoved'] === true &&
    value['exclusiveControllerAccess'] === true &&
    isSafeNonNegativeInteger(value['controllerEpoch']['trustedPosition']) &&
    isSafeNonNegativeInteger(value['controllerEpoch']['workZReference']) &&
    hasValidFingerprint(value['programFingerprint']) &&
    hasValidOptionalOverrides(value['acknowledgedReducedOverrides'])
  );
}

function hasValidFingerprint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isSafeNonNegativeInteger(value['fnv1a']) || value['fnv1a'] > 0xffff_ffff) return false;
  if (!isSafeNonNegativeInteger(value['chars'])) return false;
  return isSafeNonNegativeInteger(value['lines']) && value['lines'] >= 1;
}

function hasValidOptionalOverrides(value: unknown): boolean {
  return value === undefined || hasValidOverrides(value);
}

function hasValidOverrides(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['feed', 'rapid', 'spindle'].every(
    (key) => isFiniteNonNegative(value[key]) && Number(value[key]) <= 1_000,
  );
}

function hasValidWorkflow(value: unknown): value is ExecutionWorkflowV2 {
  if (!isRecord(value)) return false;
  switch (value['kind']) {
    case 'ordinary-start':
      return isOptionalRunId(value['completedReplaySourceRunId']);
    case 'laser-recovery':
      return hasValidLaserRecoveryWorkflow(value);
    case 'cnc-supervised-recovery':
      return hasValidSupervisedWorkflow(value);
    case 'cnc-pass-recovery':
      return hasValidPassWorkflow(value);
    default:
      return false;
  }
}

function hasValidLaserRecoveryWorkflow(value: Record<string, unknown>): boolean {
  return (
    isRunId(value['sourceRunId']) &&
    isSafeNonNegativeInteger(value['sourceRevision']) &&
    isSafeNonNegativeInteger(value['sourceAckedLines']) &&
    isPositiveInteger(value['requestedFromLine']) &&
    isPositiveInteger(value['effectiveFromLine'])
  );
}

function hasValidSupervisedWorkflow(value: Record<string, unknown>): boolean {
  if (!isRunId(value['sourceRunId']) || !isSafeNonNegativeInteger(value['sourceRevision'])) {
    return false;
  }
  const evidenceIds = [
    'uncertaintyEventId',
    'reviewId',
    'clearedPathProofId',
    'completedPrefixProofId',
    'qualificationId',
  ];
  return evidenceIds.every((key) => isBoundedString(value[key], 1));
}

function hasValidPassWorkflow(value: Record<string, unknown>): boolean {
  return (
    isRunId(value['sourceRunId']) &&
    isSafeNonNegativeInteger(value['sourceRevision']) &&
    isSafeNonNegativeInteger(value['selectedGroupIndex']) &&
    isSafeNonNegativeInteger(value['selectedPassIndex']) &&
    hasValidComputedDefault(value['computedDefault'])
  );
}

function hasValidComputedDefault(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (hasTerminalDefaultKind(value['kind'])) return true;
  if (value['kind'] !== 'resume-at-pass') return false;
  return hasValidResumeAtPass(value);
}

function hasTerminalDefaultKind(value: unknown): boolean {
  return value === 'after-last-pass' || value === 'no-pass-spans' || value === 'invalid-spans';
}

function hasValidResumeAtPass(value: Record<string, unknown>): boolean {
  return (
    isSafeNonNegativeInteger(value['groupIndex']) &&
    isSafeNonNegativeInteger(value['passIndex']) &&
    isSafeNonNegativeInteger(value['provenCompletePassCount']) &&
    isPositiveInteger(value['firstUnprovenRawLine']) &&
    isPositiveInteger(value['lastPossiblyExecutedRawLine'])
  );
}

function workflowMatchesReview(
  workflow: ExecutionWorkflowV2,
  review: Record<string, unknown>,
): boolean {
  const acknowledgement = review['acknowledgement'];
  if (!isRecord(acknowledgement)) return false;
  switch (workflow.kind) {
    case 'ordinary-start':
      return ordinaryWorkflowMatchesReview(acknowledgement, review);
    case 'laser-recovery':
      return laserWorkflowMatchesReview(acknowledgement, review);
    case 'cnc-supervised-recovery':
      return supervisedWorkflowMatchesReview(workflow, acknowledgement, review);
    case 'cnc-pass-recovery':
      return passWorkflowMatchesReview(workflow, acknowledgement, review);
  }
}

function ordinaryWorkflowMatchesReview(
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  if (!hasValidJobReviewAcknowledgement(acknowledgement)) return false;
  return acknowledgement['kind'] === 'cnc'
    ? review['cncSetupAttestation'] !== undefined && review['laserModeStartEvidence'] === undefined
    : review['laserModeStartEvidence'] !== undefined && review['cncSetupAttestation'] === undefined;
}

function laserWorkflowMatchesReview(
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  return (
    acknowledgement['kind'] === 'laser-recovery' &&
    review['laserModeStartEvidence'] !== undefined &&
    review['cncSetupAttestation'] === undefined
  );
}

function supervisedWorkflowMatchesReview(
  workflow: Extract<ExecutionWorkflowV2, { readonly kind: 'cnc-supervised-recovery' }>,
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  if (!commonCncWorkflowReviewMatches('cnc-supervised-recovery', acknowledgement, review)) {
    return false;
  }
  const operatorReview = acknowledgement['review'];
  return (
    isRecord(operatorReview) &&
    operatorReview['uncertaintyEventId'] === workflow.uncertaintyEventId &&
    operatorReview['qualificationId'] === workflow.qualificationId
  );
}

function passWorkflowMatchesReview(
  workflow: Extract<ExecutionWorkflowV2, { readonly kind: 'cnc-pass-recovery' }>,
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  if (!commonCncWorkflowReviewMatches('cnc-pass-recovery', acknowledgement, review)) return false;
  const operatorReview = acknowledgement['review'];
  return (
    isRecord(operatorReview) &&
    operatorReview['groupIndex'] === workflow.selectedGroupIndex &&
    operatorReview['passIndex'] === workflow.selectedPassIndex
  );
}

function commonCncWorkflowReviewMatches(
  kind: 'cnc-supervised-recovery' | 'cnc-pass-recovery',
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  return (
    acknowledgement['kind'] === kind &&
    review['cncSetupAttestation'] !== undefined &&
    review['laserModeStartEvidence'] === undefined
  );
}
