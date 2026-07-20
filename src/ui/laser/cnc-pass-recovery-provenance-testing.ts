import { expect } from 'vitest';
import type { RecoveryCapsule, RecoveryRepository } from '../state/recovery';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';

export function expectCncPassRecoveryProvenance(
  repository: RecoveryRepository,
  capsule: RecoveryCapsule,
  review: CncPassRecoveryReview,
): void {
  expect(repository.getSnapshot().activeRun?.artifact.provenance).toMatchObject({
    schemaVersion: 2,
    workflow: {
      kind: 'cnc-pass-recovery',
      sourceRunId: capsule.runId,
      selectedGroupIndex: review.groupIndex,
      selectedPassIndex: review.passIndex,
      computedDefault: {
        kind: 'resume-at-pass',
        groupIndex: review.groupIndex,
        passIndex: review.passIndex,
      },
    },
    review: {
      acknowledgement: {
        kind: 'cnc-pass-recovery',
        review,
        laterBoundary: 'not-required',
        recoveryPlanConfirmed: true,
        cncSetupConfirmed: true,
      },
    },
  });
}
