// ADR-237/565: ordinary Start prepares and reviews the current exact program.
// Its coordinates must still match the completed Frame's footprint and
// placement; the execution permit binds only the artifact finally affirmed.

import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import type { LastCompletedReceipt } from '../state/recovery';
import type { ReviewCarriedOverV2 } from '../state/recovery/execution-workflow-evidence';
import { runJobReviewGate, type ConfirmedJobReview } from './job-review';
import { runAgainReviewCarry, type RunAgainReviewCarry } from './run-again-review-carry';
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
//
// `completedReceipt` is the run a Run again repeats. An unchanged laser job
// whose review is the one already confirmed for that run starts without the
// dialog (ADR-237 Amendment 3); ordinary Start passes none and always shows it.
export async function reviewFramedRunForStart(
  permit: FramedRunPermit,
  options: FramedStartOptions = {},
  completedReceipt: LastCompletedReceipt | null = null,
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
  const gate: ReviewGateArgs = {
    initial,
    // Run again follows this Frame's resolved placement. Its receipt supplies
    // provenance and execution-input matching in the outer Start flow, rather
    // than restoring the previous run's translated origin or fingerprint.
    completedReceipt: null,
    shouldAbandon,
    onFrameMismatch: () => revokeOwnedCompletedFrame(permit),
    ...presenterOptions(options),
    purpose: candidate.authorizationContext === 'laser-second-pass' ? 'laser-second-pass' : 'start',
  };
  const carry = runAgainReviewCarry({ permit, initial, completedReceipt, options });
  const { review, carriedOver } = await reviewOrCarry(gate, carry, shouldAbandon);
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
  return { permit: rebound, review: reviewEvidence(review, carriedOver) };
}

function reviewEvidence(
  review: ConfirmedJobReview,
  carriedOver: ReviewCarriedOverV2 | null,
): FramedRunReviewEvidence {
  return {
    reviewedAtIso: review.reviewedAtIso,
    reviewModel: review.reviewModel,
    ...(review.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: review.laserModeStartEvidence }),
    ...(review.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: review.cncSetupAttestation }),
    ...(carriedOver === null ? {} : { carriedOver }),
  };
}

type ReviewGateArgs = Parameters<typeof runJobReviewGate>[0];

// With no earlier confirmation to carry, the gate shows the dialog. With one
// (Run again, ADR-237 Amendment 3), the gate runs once with a presenter that
// either shows the dialog or stands in for it. If the stand-in's answer did
// not hold, the dialog opens as it does for an ordinary Start; a lost permit
// is left to the caller's own message.
async function reviewOrCarry(
  gate: ReviewGateArgs,
  carry: RunAgainReviewCarry | null,
  shouldAbandon: () => boolean,
): Promise<{
  readonly review: ConfirmedJobReview | null;
  readonly carriedOver: ReviewCarriedOverV2 | null;
}> {
  if (carry === null) return { review: await runJobReviewGate(gate), carriedOver: null };
  const answered = await runJobReviewGate({
    ...gate,
    presenter: carry.presenter,
    // A stand-in that is refused changes nothing: the operator's own click in
    // the dialog that opens next is what may revoke the Frame.
    onFrameMismatch: () => {
      if (!carry.stoodInForDialog()) gate.onFrameMismatch?.();
    },
  });
  if (!carry.stoodInForDialog()) return { review: answered, carriedOver: null };
  const carriedOver = answered === null ? null : carry.carriedOver(answered);
  if (answered !== null && carriedOver !== null) return { review: answered, carriedOver };
  if (shouldAbandon()) return { review: null, carriedOver: null };
  return { review: await runJobReviewGate(gate), carriedOver: null };
}

function presenterOptions(options: FramedStartOptions) {
  return options.presenter === undefined ? {} : { presenter: options.presenter };
}
