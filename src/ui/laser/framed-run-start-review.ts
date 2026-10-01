// ADR-237/565: ordinary Start prepares and reviews the current exact program.
// Its coordinates must still match the completed Frame's footprint and
// placement; the execution permit binds only the artifact finally affirmed.

import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { runJobReviewGate } from './job-review';
import { framedRunReadinessIssue } from './framed-run-readiness';
import {
  prepareFramedStartReview,
  preparedMatchesCompletedFrame,
  rebindReviewedFramedRun,
  revokeOwnedCompletedFrame,
} from './framed-start-preparation';
import type { LastCompletedReceipt } from '../state/recovery';
import { isOutputPreparationAbort } from './output-preparation-errors';

export const FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE =
  'The framed coordinates or machine setup changed during review. Frame the job again.';

export const REVIEW_CHANGED_FRAMED_JOB_MESSAGE =
  'The reviewed program no longer matches the completed Frame or current settings. Review the current job again.';

// Process edits rebuild the dialog and need fresh affirmative approval of
// their exact bytes. Coordinate edits revoke the one-way spatial evidence;
// equal execution signatures cannot bring that physical Frame back.
export async function reviewFramedRunForStart(
  permit: FramedRunPermit,
  completedReceipt: LastCompletedReceipt | null = null,
): Promise<{ readonly permit: FramedRunPermit; readonly review: FramedRunReviewEvidence } | null> {
  const candidate = permit.candidate;
  const initial = await prepareFramedStartReview(permit).catch((error: unknown) => {
    if (isOutputPreparationAbort(error)) return null;
    throw error;
  });
  if (initial === null) return null;
  const shouldAbandon = (): boolean => {
    const liveLaser = useLaserStore.getState();
    return (
      liveLaser.framedRun !== permit ||
      framedRunReadinessIssue(permit, undefined, liveLaser) !== null
    );
  };
  const review = await runJobReviewGate({
    initial,
    completedReceipt,
    shouldAbandon,
    onFrameMismatch: () => revokeOwnedCompletedFrame(permit),
    ...(candidate.authorizationContext === 'laser-second-pass'
      ? { purpose: 'laser-second-pass' }
      : {}),
  });
  if (review === null) {
    if (shouldAbandon()) {
      useToastStore.getState().pushToast(FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE, 'warning');
    }
    return null;
  }
  const rebound = rebindReviewedFramedRun(permit, review.bundle);
  if (rebound === null) {
    if (
      !preparedMatchesCompletedFrame(permit, review.bundle.prepared) ||
      framedRunReadinessIssue(permit) !== null
    )
      revokeOwnedCompletedFrame(permit);
    useToastStore.getState().pushToast(REVIEW_CHANGED_FRAMED_JOB_MESSAGE, 'warning');
    return null;
  }
  return {
    permit: rebound,
    review: {
      reviewedAtIso: review.reviewedAtIso,
      reviewModel: review.reviewModel,
      ...(review.laserModeStartEvidence === undefined
        ? {}
        : { laserModeStartEvidence: review.laserModeStartEvidence }),
      ...(review.cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation: review.cncSetupAttestation }),
    },
  };
}
