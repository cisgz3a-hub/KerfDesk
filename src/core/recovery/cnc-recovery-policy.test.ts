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

  it('reports a supervised recovery review candidate only after the cutter is clear', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      incident: { kind: 'interruption' },
      cutter: { kind: 'clear' },
      spindle: { kind: 'stopped' },
      position: { kind: 'requalified' },
      controller: { kind: 'manual-only' },
    });
    expect(result).toEqual({
      kind: 'supervised-recovery-review-candidate',
      executable: false,
      recoveryPackageDigest: PACKAGE_DIGEST,
      toolInspectionId: 'inspection-2',
    });
  });

  it('refuses a recovery review when physical tool condition is unproved', () => {
    const result = assessCncRecovery({
      ...completeReviewEvidence,
      cutter: { kind: 'clear' },
      toolCondition: { kind: 'unknown-or-damaged' },
      position: { kind: 'requalified' },
    });
    expect(result).toEqual({
      kind: 'requalification-required',
      reasons: ['tool-condition-unproved'],
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
