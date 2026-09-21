import type { FramedRunCandidate } from '../state/framed-run';
import type { LaserState } from '../state/laser-store';
import type { ReviewedStartBundle } from './job-review';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { startPreparationCoordinateKey } from './start-preparation-coordinate-key';

/** Before physical Frame dispatch, controller observations matter only when
 * they alter the coordinate inputs that produced this candidate's bytes. */
export function reviewedFrameIsCurrent(
  bundle: ReviewedStartBundle,
  currentLaser: LaserState,
  authorizationContext: FramedRunCandidate['authorizationContext'],
): boolean {
  const transientProject = authorizationContext !== undefined;
  const coordinateContext = {
    jobPlacement: bundle.prepared.jobOrigin ?? {
      startFrom: 'absolute' as const,
      anchor: 'front-left' as const,
    },
    ...(bundle.prepared.jobOrigin === undefined
      ? {}
      : { resolvedJobOrigin: bundle.prepared.jobOrigin }),
  };
  return (
    (transientProject ||
      currentReplayExecutionSignature() === bundle.prepared.canvasPlan.retentionKey) &&
    controllerStartPreparationStillCurrent(bundle.laser, currentLaser, {
      ignoreAdvisoryControllerEvidence: true,
    }) &&
    startPreparationCoordinateKey(bundle.project.device, bundle.laser, coordinateContext) ===
      startPreparationCoordinateKey(bundle.project.device, currentLaser, coordinateContext)
  );
}
