import type { DeviceProfile } from '../../core/devices';
import type { FramedRunCandidate } from '../state/framed-run';
import type { LaserState } from '../state/laser-store';
import type { ReviewedStartBundle } from './job-review';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import {
  startPreparationCoordinateKey,
  type StartPreparationPlacement,
} from './start-preparation-coordinate-key';

/** Before physical Frame dispatch, controller observations matter only when
 * they alter the coordinate inputs that produced this candidate's bytes. */
export function reviewedFrameIsCurrent(
  bundle: ReviewedStartBundle,
  currentLaser: LaserState,
  authorizationContext: FramedRunCandidate['authorizationContext'],
): boolean {
  const transientProject = authorizationContext !== undefined;
  return frameInputsAreCurrent({
    device: bundle.project.device,
    preparedAgainst: bundle.laser,
    executionSignature: transientProject ? null : bundle.prepared.canvasPlan.retentionKey,
    coordinateContext: {
      jobPlacement: bundle.prepared.jobOrigin ?? {
        startFrom: 'absolute' as const,
        anchor: 'front-left' as const,
      },
      ...(bundle.prepared.jobOrigin === undefined
        ? {}
        : { resolvedJobOrigin: bundle.prepared.jobOrigin }),
    },
    currentLaser,
  });
}

/** The same currency rule for a Frame whose exact program is still being
 * prepared (ADR-353): the open job still has the signature the preparation
 * will carry, and the controller inputs that shape its coordinates are the
 * ones the preparation started from. A null signature skips the project
 * check (transient projects own immutable bytes). */
export function frameInputsAreCurrent(args: {
  readonly device: DeviceProfile;
  readonly preparedAgainst: LaserState;
  readonly executionSignature: string | null;
  readonly coordinateContext: StartPreparationPlacement;
  readonly currentLaser: LaserState;
}): boolean {
  const { device, preparedAgainst, coordinateContext, currentLaser } = args;
  return (
    (args.executionSignature === null ||
      currentReplayExecutionSignature() === args.executionSignature) &&
    controllerStartPreparationStillCurrent(preparedAgainst, currentLaser, {
      ignoreAdvisoryControllerEvidence: true,
    }) &&
    startPreparationCoordinateKey(device, preparedAgainst, coordinateContext) ===
      startPreparationCoordinateKey(device, currentLaser, coordinateContext)
  );
}
