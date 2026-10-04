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
import { isOutputPreparationAbort } from './output-preparation-errors';
import { assertMachineExecutionOwner } from '../state/machine-execution-owner';
import type { FramedStartOptions } from './framed-start-options';

export const FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE =
  'The framed coordinates or machine setup changed during review. Frame the job again.';

export const REVIEW_CHANGED_FRAMED_JOB_MESSAGE =
  'The reviewed program no longer matches the completed Frame or current settings. Review the current job again.';

// Process edits rebuild the dialog and need fresh affirmative approval of
// their exact bytes. Coordinate edits revoke the one-way spatial evidence;
// equal execution signatures cannot bring that physical Frame back.
export async function reviewFramedRunForStart(
  permit: FramedRunPermit,
  options: FramedStartOptions = {},
): Promise<{ readonly permit: FramedRunPermit; readonly review: FramedRunReviewEvidence } | null> {
  const candidate = permit.candidate;
  assertMachineExecutionOwner(options.executionOwner);
  const initial = await prepareFramedStartReview(permit, options.executionOwner?.signal).catch(
    (error: unknown) => {
      if (isOutputPreparationAbort(error)) return null;
      throw error;
    },
  );
  if (initial === null) return null;
  assertMachineExecutionOwner(options.executionOwner);
  const shouldAbandon = (): boolean => {
    const liveLaser = useLaserStore.getState();
    return (
      options.executionOwner?.signal?.aborted === true ||
      liveLaser.framedRun !== permit ||
      framedRunReadinessIssue(permit, undefined, liveLaser) !== null
    );
  };
  const review = await runJobReviewGate({
    initial,
    // Run again follows this Frame's resolved placement. Its receipt supplies
    // provenance and execution-input matching in the outer Start flow, rather
    // than restoring the previous run's translated origin or fingerprint.
    completedReceipt: null,
    shouldAbandon,
    onFrameMismatch: () => revokeOwnedCompletedFrame(permit),
    ...presenterOptions(options),
    purpose: candidate.authorizationContext === 'laser-second-pass' ? 'laser-second-pass' : 'start',
  });
  if (review === null) {
    if (shouldAbandon()) {
      useToastStore.getState().pushToast(FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE, 'warning');
    }
    return null;
  }
  assertMachineExecutionOwner(options.executionOwner);
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
function presenterOptions(options: FramedStartOptions) {
  return options.presenter === undefined ? {} : { presenter: options.presenter };
}
