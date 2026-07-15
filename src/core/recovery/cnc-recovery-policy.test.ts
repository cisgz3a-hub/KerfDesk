import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessCncRecovery, type CncRecoveryEvidence } from './cnc-recovery-policy';

const PACKAGE_DIGEST = `sha256:${'a'.repeat(64)}`;
const controllerReviewEvidence = {
  kind: 'controller-owned-review-evidence',
  controllerSessionId: 'session-4',
  stableHoldProofId: 'hold-12',
  exclusiveOwnerProofId: 'owner-3',
} as const;

const completeReviewEvidence: CncRecoveryEvidence = {
  incident: { kind: 'controlled-hold' },
  cutter: { kind: 'engaged' },
  toolCondition: { kind: 'inspected-intact', inspectionId: 'inspection-2' },
  spindle: { kind: 'physical-running', feedbackId: 'vfd-run-7' },
  position: { kind: 'retained', controllerSessionId: 'session-4' },
  workholding: { kind: 'confirmed-unchanged' },
  recoveryPackage: { kind: 'exact-match', digest: PACKAGE_DIGEST },
  controller: controllerReviewEvidence,
  operatorReview: { kind: 'missing' },
};

describe('assessCncRecovery', () => {
  it('requires manual intervention when a stopped cutter may be embedded', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      spindle: { kind: 'stopped' },
    });
    expect(result.kind).toBe('manual-intervention-required');
  });

  it('does not treat commanded spindle state as physical rotation proof', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      spindle: { kind: 'commanded-running-only' },
    });
    expect(result.kind).toBe('manual-intervention-required');
  });

  it('reports only a non-executable escape review with complete same-session evidence', () => {
    expect(assessCncRecovery(completeReviewEvidence)).toEqual({
      kind: 'controller-escape-review-candidate',
      executable: false,
      controllerSessionId: 'session-4',
      stableHoldProofId: 'hold-12',
      exclusiveOwnerProofId: 'owner-3',
      spindleFeedbackId: 'vfd-run-7',
      toolInspectionId: 'inspection-2',
    });
    const mismatched = {
      ...completeReviewEvidence,
      position: { kind: 'retained', controllerSessionId: 'older-session' } as const,
    };
    expect(assessCncRecovery(mismatched).kind).toBe('manual-intervention-required');
  });

  it('authorizes only a new supervised recovery job after the cutter is clear and setup is requalified', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      incident: { kind: 'interruption' },
      cutter: { kind: 'clear' },
      spindle: { kind: 'stopped' },
      position: { kind: 'requalified' },
      controller: { kind: 'manual-only' },
      operatorReview: {
        kind: 'complete',
        reviewId: 'review-8',
        clearedPathProofId: 'cleared-through-cut-2',
        completedPrefixProofId: 'complete-before-cut-3',
        runwayQualificationId: 'air-cut-2026-07-15',
      },
    });
    expect(result).toEqual({
      kind: 'supervised-recovery-authorized',
      executable: true,
      recoveryPackageDigest: PACKAGE_DIGEST,
      toolInspectionId: 'inspection-2',
      reviewId: 'review-8',
      clearedPathProofId: 'cleared-through-cut-2',
      completedPrefixProofId: 'complete-before-cut-3',
      runwayQualificationId: 'air-cut-2026-07-15',
    });
  });

  it('does not authorize clear-cutter recovery without the complete operator review', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      spindle: { kind: 'stopped' },
      position: { kind: 'requalified' },
      controller: { kind: 'manual-only' },
    });
    expect(result).toEqual({
      kind: 'requalification-required',
      reasons: [
        'operator-review-missing',
        'cleared-path-unproved',
        'completed-prefix-unproved',
        'runway-profile-unqualified',
      ],
    });
  });

  it('requires fresh requalification instead of trusting a retained session for a new job', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      spindle: { kind: 'stopped' },
      position: { kind: 'retained', controllerSessionId: 'session-4' },
      controller: { kind: 'manual-only' },
      operatorReview: {
        kind: 'complete',
        reviewId: 'review-8',
        clearedPathProofId: 'cleared-through-cut-2',
        completedPrefixProofId: 'complete-before-cut-3',
        runwayQualificationId: 'air-cut-2026-07-15',
      },
    });
    expect(result).toEqual({
      kind: 'requalification-required',
      reasons: ['position-unproved'],
    });
  });

  it('refuses a recovery review when physical tool condition is unproved', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      spindle: { kind: 'stopped' },
      toolCondition: { kind: 'unknown-or-damaged' },
      position: { kind: 'requalified' },
      operatorReview: {
        kind: 'complete',
        reviewId: 'review-8',
        clearedPathProofId: 'cleared-through-cut-2',
        completedPrefixProofId: 'complete-before-cut-3',
        runwayQualificationId: 'air-cut-2026-07-15',
      },
    });
    expect(result).toEqual({
      kind: 'requalification-required',
      reasons: ['tool-condition-unproved'],
    });
  });

  it('refuses a new recovery job unless the spindle is confirmed stopped', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      spindle: { kind: 'unknown' },
      position: { kind: 'requalified' },
      controller: { kind: 'manual-only' },
      operatorReview: {
        kind: 'complete',
        reviewId: 'review-8',
        clearedPathProofId: 'cleared-through-cut-2',
        completedPrefixProofId: 'complete-before-cut-3',
        runwayQualificationId: 'air-cut-2026-07-15',
      },
    });
    expect(result).toEqual({
      kind: 'requalification-required',
      reasons: ['spindle-stop-unproved'],
    });
  });

  it('requires requalification when clear-tool recovery evidence is incomplete', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      position: { kind: 'unknown' },
      workholding: { kind: 'unknown-or-changed' },
      recoveryPackage: { kind: 'missing-or-mismatch' },
    });
    expect(result.kind).toBe('requalification-required');
    if (result.kind !== 'requalification-required') return;
    expect(result.reasons).toEqual(
      expect.arrayContaining(['position-unproved', 'workholding-unproved', 'package-mismatch']),
    );
  });

  it('never qualifies escape without physical-running spindle evidence', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'stopped' | 'unknown' | 'commanded-running-only'>(
          'stopped',
          'unknown',
          'commanded-running-only',
        ),
        (kind) => {
          const result = assessCncRecovery({
            ...completeReviewEvidence,
            spindle: { kind },
          });
          expect(result.kind).not.toBe('controller-escape-review-candidate');
        },
      ),
    );
  });

  it('requires the exact package and non-empty physical/controller proof IDs for escape', () => {
    const cases: ReadonlyArray<CncRecoveryEvidence> = [
      { ...completeReviewEvidence, recoveryPackage: { kind: 'missing-or-mismatch' } },
      { ...completeReviewEvidence, recoveryPackage: { kind: 'exact-match', digest: '' } },
      {
        ...completeReviewEvidence,
        spindle: { kind: 'physical-running', feedbackId: '' },
      },
      {
        ...completeReviewEvidence,
        controller: { ...controllerReviewEvidence, stableHoldProofId: '' },
      },
      {
        ...completeReviewEvidence,
        controller: { ...controllerReviewEvidence, exclusiveOwnerProofId: '' },
      },
    ];
    for (const evidence of cases) {
      expect(assessCncRecovery(evidence).kind).toBe('manual-intervention-required');
    }
  });

  it('rejects a malformed package digest even when the cutter is clear', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      position: { kind: 'requalified' },
      recoveryPackage: { kind: 'exact-match', digest: 'sha256:not-a-digest' },
    });
    expect(result.kind).toBe('requalification-required');
  });
});
