// ADR-237: the single Job Review runs at Start. An ordinary Frame mints a
// review-pending permit; this module opens the review for it against the
// permit's exact prepared artifact plus live controller state, and enforces
// the exact-artifact backstop when an in-review edit re-prepares the job.

import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useStore } from '../state';
import { runJobReviewGate } from './job-review';

export const FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE =
  'The job or machine setup changed during review. Frame the exact job again.';

export const REVIEW_CHANGED_FRAMED_JOB_MESSAGE =
  'The reviewed job no longer matches the framed one. Frame the exact job again.';

// Builds the Start review against the LIVE stores plus the permit's exact
// prepared artifact: permit invalidation guarantees the live project still
// produces this artifact, while live controller state keeps the warnings
// current. A rebuild inside the dialog (settings edit) yields a different
// execution signature, which voids the permit — the operator Frames again.
export async function reviewFramedRunForStart(
  permit: FramedRunPermit,
): Promise<FramedRunReviewEvidence | null> {
  const candidate = permit.candidate;
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const review = await runJobReviewGate({
    initial: {
      app,
      project: candidate.project,
      laser,
      prepared: candidate.preparedStart,
      laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      externalEnvironment: candidate.externalEnvironment,
      ...(candidate.frameWcsNormalizationWarning === undefined
        ? {}
        : { frameWcsNormalizationWarning: candidate.frameWcsNormalizationWarning }),
    },
    checkpointToReplace: null,
    completedReceipt: null,
  });
  if (review === null) return null;
  if (review.bundle.prepared.canvasPlan.retentionKey !== candidate.executionSignature) {
    useLaserStore.setState({ framedRun: null, frameVerification: null });
    useToastStore.getState().pushToast(REVIEW_CHANGED_FRAMED_JOB_MESSAGE, 'warning');
    return null;
  }
  return {
    reviewedAtIso: review.reviewedAtIso,
    reviewModel: review.reviewModel,
    ...(review.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: review.laserModeStartEvidence }),
    ...(review.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: review.cncSetupAttestation }),
  };
}
