import { frameBoundsSignature } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import {
  framedRunControllerSnapshot,
  type FramedRunCandidate,
  type FramedRunPermit,
  type FramedRunReviewEvidence,
} from '../state/framed-run';
import { useCameraStore } from '../state/camera-store';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  framePreparationCancelled,
  registerFramePreparationAbort,
  runOwnedFrame,
} from '../state/frame-preparation-store';
import { isOutputPreparationAbort } from './output-preparation-errors';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import { CNC_FRAME_WORK_Z_REQUIRED_MESSAGE } from '../state/cnc-frame-lines';
import { resolveLiveFramePlacement } from './camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from './frame-controller-readiness';
import {
  waitForAbsoluteFrameOffset,
  waitForFreshIdleFramePosition,
} from './frame-position-readiness';
import { ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE } from '../job-placement';
import { clearStartBlockers } from './start-blocker-invalidation';
import { clearFrameExpiryNote } from './frame-expiry-note';
import { type ConfirmedJobReview, type ReviewedStartBundle } from './job-review';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { resolveFrameCandidate } from './frame-candidate';
import { reviewedFrameIsCurrent } from './reviewed-frame-current';
import { traceableFrameBoundsPreview } from './frame-bounds-preview';
import { offerFrameBlockerFixes } from './frame-blocker-repair';
import {
  currentWorkXy,
  FRAME_COMPLETE_MESSAGE,
  FRAME_COMPLETED_BUT_CHANGED_MESSAGE,
  FRAME_NOT_DISPATCHED_MESSAGE,
  FRAME_SETUP_CHANGED_BEFORE_DISPATCH_MESSAGE,
  FRAME_WORK_POSITION_UNKNOWN_MESSAGE,
  frameVerificationBounds,
  reportFramePreparationRefusal,
  reportFrameRefusal,
  requireFrameControllerQueue,
  waitForFrameOutcome,
} from './frame-dispatch-support';
import {
  dispatchTracedFrame,
  startExactFramePreparation,
  type FrameContext,
} from './frame-trace-flow';
import type { StartJobPreparation } from './start-job-readiness';

export function useFrameAction(): () => void {
  return () => {
    void runFrameNow();
  };
}

/**
 * Prepare and physically Frame one exact executable artifact, dialog-free
 * (ADR-237: the single Job Review runs at Start, which claims the permit).
 * The controller store promotes the candidate to `framedRun` only after the
 * final clean Idle; dispatch, cancel, Alarm, reset, or write failure earns
 * no permit.
 *
 * A job prepared off-thread reports its outline as soon as it is compiled,
 * seconds before its exact program on a dense fill. That outline is traced
 * at once and the permit is minted when the program arrives and reproduces
 * it (ADR-353). Everything else Frames the exact program as before.
 */
export function runFrameNow(): Promise<boolean> {
  return runOwnedFrame(async () => {
    ensureFramedRunInvalidationSubscriptions();
    clearStartBlockers();
    clearFrameExpiryNote();
    if (!(await offerFrameBlockerFixes())) return false;
    const context = await prepareFrameContext();
    if (context === null) return false;
    const preparation = startExactFramePreparation(context);
    const release = registerFramePreparationAbort(preparation.abort);
    try {
      const preview = traceableFrameBoundsPreview(await preparation.earlyBounds);
      if (preview !== null) return await dispatchTracedFrame(context, preview, preparation);
      const bundle = exactFrameBundle(context, await preparation.program);
      return bundle === null ? false : await dispatchPreparedFrame(bundle);
    } catch (error) {
      return operatorCancelledPreparation(error);
    } finally {
      release();
    }
  });
}

// The operator's Cancel ends the Frame quietly; any other failure propagates.
function operatorCancelledPreparation(error: unknown): false {
  if (!isOutputPreparationAbort(error) || !framePreparationCancelled()) throw error;
  useToastStore.getState().pushToast('Frame preparation cancelled. Nothing was sent.', 'info');
  return false;
}

export type TransientFrameControllerPreparation = {
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly wcsNormalizationWarning?: string;
};

/** Own the same queue/WCS/setup boundary as an ordinary exact Frame without
 * replacing the open project. The caller can then compile its immutable
 * transient project against this returned controller snapshot. */
export async function prepareTransientFrameController(
  project: Project,
): Promise<TransientFrameControllerPreparation | null> {
  ensureFramedRunInvalidationSubscriptions();
  clearStartBlockers();
  if (!(await requireFrameControllerQueue())) return null;
  const wcsNormalization = await normalizeFrameWorkCoordinateSystem();
  if (!wcsNormalization.ok) {
    reportFramePreparationRefusal(wcsNormalization.messages, wcsNormalization.warning);
    return null;
  }
  const laser = await prepareFrameLaser(
    project.machine?.kind === 'cnc',
    useLaserStore.getState(),
    wcsNormalization.warning,
  );
  if (laser === null) return null;
  return {
    laser,
    ...(wcsNormalization.warning === undefined
      ? {}
      : { wcsNormalizationWarning: wcsNormalization.warning }),
  };
}

/** Physically Frame an already-reviewed transient camera project. Success
 * returns the exact completion-issued permit; dispatch alone returns null. */
export async function dispatchTransientReviewedFrame(
  review: ConfirmedJobReview,
  outputScope: OutputScope,
): Promise<FramedRunPermit | null> {
  const accepted = await dispatchPreparedFrame(review.bundle, {
    review: reviewEvidenceOf(review),
    authorizationContext: 'transient-camera',
    outputScope,
  });
  if (!accepted) return null;
  const permit = useLaserStore.getState().framedRun;
  return permit?.candidate.authorizationContext === 'transient-camera' &&
    permit.candidate.project === review.bundle.project
    ? permit
    : null;
}

/** Immutable derived laser jobs use the ordinary dialog-free Frame, then the
 * ordinary Start-time review, without replacing the operator's open canvas. */
export async function dispatchLaserSecondPassFrame(
  bundle: ReviewedStartBundle,
  outputScope: OutputScope,
): Promise<FramedRunPermit | null> {
  const accepted = await dispatchPreparedFrame(bundle, {
    authorizationContext: 'laser-second-pass',
    outputScope,
  });
  const permit = useLaserStore.getState().framedRun;
  return accepted &&
    permit?.candidate.authorizationContext === 'laser-second-pass' &&
    permit.candidate.preparedStart === bundle.prepared
    ? permit
    : null;
}

/** The queue, WCS, controller and placement boundary every ordinary Frame
 * owns before compiling anything. */
async function prepareFrameContext(): Promise<FrameContext | null> {
  if (!(await requireFrameControllerQueue())) return null;
  const wcsNormalization = await normalizeFrameWorkCoordinateSystem();
  if (!wcsNormalization.ok) {
    reportFramePreparationRefusal(wcsNormalization.messages, wcsNormalization.warning);
    return null;
  }
  if (!(await waitForAbsoluteFrameOffset(useStore.getState().jobPlacement))) {
    reportFramePreparationRefusal(
      [ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE],
      wcsNormalization.warning,
    );
    return null;
  }
  const app = useStore.getState();
  const laser = await prepareFrameLaser(
    app.project.machine?.kind === 'cnc',
    useLaserStore.getState(),
    wcsNormalization.warning,
  );
  if (laser === null) return null;
  const camera = useCameraStore.getState();
  const placement = resolveLiveFramePlacement(app, laser);
  if (!placement.ok) {
    reportFramePreparationRefusal(placement.messages, wcsNormalization.warning);
    return null;
  }
  return {
    app,
    laser,
    camera,
    jobOrigin: placement.jobOrigin,
    ...(wcsNormalization.warning === undefined
      ? {}
      : { wcsNormalizationWarning: wcsNormalization.warning }),
  };
}

function exactFrameBundle(
  context: FrameContext,
  prepared: StartJobPreparation,
): ReviewedStartBundle | null {
  if (!prepared.ok) {
    reportFramePreparationRefusal(prepared.messages, context.wcsNormalizationWarning);
    return null;
  }
  return {
    app: context.app,
    project: context.app.project,
    laser: context.laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(context.laser),
    ...(context.wcsNormalizationWarning === undefined
      ? {}
      : { frameWcsNormalizationWarning: context.wcsNormalizationWarning }),
  };
}

type PreparedFrameDispatchOptions = {
  readonly review?: FramedRunReviewEvidence;
  readonly authorizationContext?: FramedRunCandidate['authorizationContext'];
  readonly outputScope?: OutputScope;
};

function reviewEvidenceOf(review: ConfirmedJobReview): FramedRunReviewEvidence {
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

async function dispatchPreparedFrame(
  bundle: ReviewedStartBundle,
  options: PreparedFrameDispatchOptions = {},
): Promise<boolean> {
  if (!(await requireFrameControllerQueue())) return false;
  const currentLaser = useLaserStore.getState();
  if (!reviewedFrameIsCurrent(bundle, currentLaser, options.authorizationContext)) {
    reportFrameRefusal([FRAME_SETUP_CHANGED_BEFORE_DISPATCH_MESSAGE]);
    return false;
  }
  const frameCandidate = resolveFrameCandidate(bundle.prepared);
  if (!frameCandidate.ok) {
    reportFrameRefusal(frameCandidate.messages);
    return false;
  }
  const { jobBounds, motionBounds } = frameCandidate;
  const verificationBounds = frameVerificationBounds(
    bundle.project.machine?.kind,
    jobBounds,
    motionBounds,
  );
  const returnToWorkPosition = currentWorkXy(currentLaser);
  if (returnToWorkPosition === undefined) {
    reportFrameRefusal([FRAME_WORK_POSITION_UNKNOWN_MESSAGE]);
    return false;
  }
  const candidateOptions = reviewedFrameCandidateOptions(bundle, options);
  const candidate: FramedRunCandidate = {
    preparedStart: bundle.prepared,
    project: bundle.project,
    ...candidateOptions,
    executionSignature: bundle.prepared.canvasPlan.retentionKey,
    controllerBeforeFrame: framedRunControllerSnapshot(currentLaser),
    frameVerification: {
      boundsSignature: frameBoundsSignature(verificationBounds),
      wco: currentLaser.wcoCache,
      workOriginActive: currentLaser.workOriginActive,
    },
    returnToWorkPosition,
    ...(options.review === undefined ? {} : { review: options.review }),
    ...(bundle.frameWcsNormalizationWarning === undefined
      ? {}
      : { frameWcsNormalizationWarning: bundle.frameWcsNormalizationWarning }),
  };

  const completion = waitForFrameOutcome(candidate);
  try {
    await currentLaser.frame(motionBounds, bundle.project.device.framingFeedMmPerMin, candidate);
  } catch (error) {
    completion.cancel();
    reportFrameRefusal([error instanceof Error ? error.message : String(error)]);
    return false;
  }
  if (!completion.observeAfterDispatch()) {
    reportFrameRefusal([FRAME_NOT_DISPATCHED_MESSAGE]);
    return false;
  }
  return reportFrameCompletion(candidate, await completion.result);
}

function reviewedFrameCandidateOptions(
  bundle: ReviewedStartBundle,
  options: PreparedFrameDispatchOptions,
): Pick<FramedRunCandidate, 'outputScope' | 'authorizationContext'> {
  const outputScope =
    options.outputScope === undefined ? currentOutputScope(bundle.app) : options.outputScope;
  return options.authorizationContext === undefined
    ? { outputScope }
    : { outputScope, authorizationContext: options.authorizationContext };
}

function reportFrameCompletion(candidate: FramedRunCandidate, accepted: boolean): boolean {
  if (!accepted) return false;
  if (useLaserStore.getState().framedRun?.candidate !== candidate) {
    useToastStore.getState().pushToast(FRAME_COMPLETED_BUT_CHANGED_MESSAGE, 'warning');
    return false;
  }
  useToastStore.getState().pushToast(FRAME_COMPLETE_MESSAGE, 'success');
  return true;
}

async function prepareFrameLaser(
  isCnc: boolean,
  laser: ReturnType<typeof useLaserStore.getState>,
  wcsNormalizationWarning: string | undefined,
): Promise<ReturnType<typeof useLaserStore.getState> | null> {
  if (!isCnc) return laser;
  if (
    isWorkZEvidenceCurrentForStart(
      laser.workZZeroEvidence,
      laser.workZReferenceEpoch,
      laser.controllerSessionEpoch,
    )
  ) {
    return laser;
  }
  const zeroHere = jobAwareConfirm(
    `${CNC_FRAME_WORK_Z_REQUIRED_MESSAGE}\n\n` +
      'If the bit is touching the stock-top Z reference now, choose OK to set Work Z zero and continue preparing Frame. Choose Cancel to jog or probe first.',
  );
  if (!zeroHere) {
    reportFramePreparationRefusal([CNC_FRAME_WORK_Z_REQUIRED_MESSAGE], wcsNormalizationWarning);
    return null;
  }
  try {
    const positionSequenceBeforeZero = laser.statusSequence;
    await laser.zeroZHere();
    if (!(await waitForFreshIdleFramePosition(positionSequenceBeforeZero))) {
      reportFramePreparationRefusal(
        [
          'Work Z was set, but the controller did not report the fresh Idle position needed to build an exact Frame. Wait for a complete status report, then Frame again.',
        ],
        wcsNormalizationWarning,
      );
      return null;
    }
    return useLaserStore.getState();
  } catch (error) {
    reportFramePreparationRefusal(
      [error instanceof Error ? error.message : String(error)],
      wcsNormalizationWarning,
    );
    return null;
  }
}
