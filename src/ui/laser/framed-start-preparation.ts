import { frameBoundsSignature } from '../../core/job';
import { currentOutputScope, useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import {
  framedRunControllerSnapshot,
  type FramedRunPermit,
  type PreparedStartProgram,
} from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { frameProofReset } from '../state/laser-session-reset';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { prepareCurrentStartJob } from './start-job-source';
import { frameVerificationBounds, reportFrameRefusal } from './frame-dispatch-support';
import type { ReviewedStartBundle } from './job-review';
import { laserPowerScaleStillCurrent } from './connected-laser-power-scale';

export const PREPARED_FRAME_COORDINATES_CHANGED_MESSAGE =
  'The current job has different motion coordinates or placement from the completed Frame. Frame the updated job again.';

/** The exact permit is replaceable, but only the store's existing spatial
 * evidence can authorize its replacement. Consumed permits never resurrect
 * evidence which a coordinate mutation revoked. */
export function armPermitFromCompletedFrame(permit: FramedRunPermit): boolean {
  let armed = false;
  useLaserStore.setState((state) => {
    if (state.framedRunStartClaim !== null) return {};
    if (state.framedRun === permit) {
      armed = true;
      return {};
    }
    if (
      state.framedRun !== null ||
      state.completedFrame !== permit ||
      framedRunReadinessIssue(permit, undefined, state) !== null
    )
      return {};
    armed = true;
    return { framedRun: permit };
  });
  return armed;
}

export function revokeOwnedCompletedFrame(permit: FramedRunPermit): void {
  useLaserStore.setState((state) =>
    state.framedRun === permit || state.completedFrame === permit ? frameProofReset() : {},
  );
}

/** Fresh compile before the dialog opens, using the Frame's resolved origin.
 * This refreshes F/S, warnings, timing and the actual head approach together. */
export async function prepareFramedStartReview(
  permit: FramedRunPermit,
): Promise<ReviewedStartBundle | null> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const candidate = permit.candidate;
  const prepared =
    candidate.authorizationContext === undefined
      ? await prepareCurrentStartJob(
          app,
          laser,
          useCameraStore.getState(),
          candidate.preparedStart.jobOrigin,
          false,
        )
      : candidate.preparedStart;
  if (useLaserStore.getState().framedRun !== permit) return null;
  if (!prepared.ok) {
    reportFrameRefusal(prepared.messages);
    return null;
  }
  if (!preparedMatchesCompletedFrame(permit, prepared)) {
    revokeOwnedCompletedFrame(permit);
    reportFrameRefusal([PREPARED_FRAME_COORDINATES_CHANGED_MESSAGE]);
    return null;
  }
  return {
    app,
    project: candidate.authorizationContext === undefined ? app.project : candidate.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    outputScope:
      candidate.authorizationContext === undefined
        ? currentOutputScope(app)
        : candidate.outputScope,
    ...(candidate.frameWcsNormalizationWarning === undefined
      ? {}
      : { frameWcsNormalizationWarning: candidate.frameWcsNormalizationWarning }),
  };
}

export function preparedMatchesCompletedFrame(
  permit: FramedRunPermit,
  prepared: PreparedStartProgram,
): boolean {
  const bounds = prepared.metrics.frameJobBounds;
  if (bounds === null) return false;
  const verificationBounds = frameVerificationBounds(
    prepared.prepared.project.machine?.kind,
    bounds,
    prepared.metrics.frameMotionBounds ?? bounds,
  );
  return (
    frameBoundsSignature(verificationBounds) ===
      permit.candidate.frameVerification.boundsSignature &&
    JSON.stringify(prepared.jobOrigin) === JSON.stringify(permit.candidate.preparedStart.jobOrigin)
  );
}

/** Atomically bind the last displayed and affirmed artifact to the reusable
 * proof. The next gate still compares its exact execution signature at wire. */
export function rebindReviewedFramedRun(
  permit: FramedRunPermit,
  bundle: ReviewedStartBundle,
): FramedRunPermit | null {
  const transient = permit.candidate.authorizationContext !== undefined;
  if (
    !preparedMatchesCompletedFrame(permit, bundle.prepared) ||
    (!transient && currentReplayExecutionSignature() !== bundle.prepared.canvasPlan.retentionKey)
  )
    return null;
  let rebound: FramedRunPermit | null = null;
  useLaserStore.setState((state) => {
    if (state.framedRun !== permit || framedRunReadinessIssue(permit, undefined, state) !== null)
      return {};
    if (
      !laserPowerScaleStillCurrent(bundle.project, bundle.prepared.laserPowerScale, {
        ...state,
        connected: state.connection.kind === 'connected',
      })
    )
      return {};
    if (transient) {
      // The tool's Cancel/Edit handler owns this exact immutable permit.
      // Replacing it would leave the handler unable to revoke a pending Start.
      if (bundle.prepared !== permit.candidate.preparedStart) return {};
      rebound = permit;
      return {};
    }
    rebound = {
      ...permit,
      controller: framedRunControllerSnapshot(state),
      candidate: {
        ...permit.candidate,
        preparedStart: bundle.prepared,
        project: bundle.project,
        outputScope: bundle.outputScope ?? currentOutputScope(bundle.app),
        executionSignature: bundle.prepared.canvasPlan.retentionKey,
      },
    };
    return {
      framedRun: rebound,
      completedFrame: rebound,
      completedFrameRunOwner: null,
    };
  });
  return rebound;
}
