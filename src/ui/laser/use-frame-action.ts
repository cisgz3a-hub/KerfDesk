import { frameBoundsSignature } from '../../core/job';
import { currentOutputScope, useStore } from '../state';
import { framedRunControllerSnapshot, type FramedRunCandidate } from '../state/framed-run';
import { useCameraStore } from '../state/camera-store';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import type { LaserMotionOperation } from '../state/laser-motion-operation';
import { useToastStore } from '../state/toast-store';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import { CNC_FRAME_WORK_Z_REQUIRED_MESSAGE } from '../state/cnc-frame-lines';
import { resolveCameraSafeFramePlacement } from './camera-frame-placement';
import {
  frameControllerQueueIssue,
  normalizeFrameWorkCoordinateSystem,
} from './frame-controller-readiness';
import { waitForFreshIdleFramePosition } from './frame-position-readiness';
import { useStartBlockerStore } from './start-blocker-store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import {
  captureStartExternalEnvironment,
  startExternalEnvironmentMatches,
} from './start-job-external-environment';
import { prepareCurrentStartJob } from './start-job-source';
import { runJobReviewGate, type ConfirmedJobReview, type ReviewedStartBundle } from './job-review';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { preflightFrameCandidate } from './frame-candidate-preflight';
import { frameControllerSettingsIssues } from './frame-controller-settings';

export function useFrameAction(): () => void {
  return () => {
    void runFrameNow();
  };
}

/**
 * Prepare, review, and physically Frame one exact executable artifact. The
 * controller store promotes the candidate to `framedRun` only after the final
 * clean Idle; dispatch, cancel, Alarm, reset, or write failure earns no permit.
 */
export async function runFrameNow(): Promise<boolean> {
  ensureFramedRunInvalidationSubscriptions();
  useStartBlockerStore.getState().clear();
  const initial = await prepareFrameReviewBundle();
  if (initial === null) return false;
  const review = await runJobReviewGate({
    initial,
    checkpointToReplace: null,
    completedReceipt: null,
    purpose: 'frame',
  });
  if (review === null) return false;
  return dispatchReviewedFrame(review);
}

async function prepareFrameReviewBundle(): Promise<ReviewedStartBundle | null> {
  if (!(await requireFrameControllerQueue())) return null;
  const initialApp = useStore.getState();
  const initialLaser = useLaserStore.getState();
  const settingsIssues = frameControllerSettingsIssues(
    initialApp.project,
    initialLaser.controllerSettings,
    initialLaser.capabilities.settings,
  );
  if (settingsIssues.length > 0) {
    reportFramePreparationRefusal(settingsIssues, undefined);
    return null;
  }
  const wcsNormalization = await normalizeFrameWorkCoordinateSystem();
  if (!wcsNormalization.ok) {
    reportFramePreparationRefusal(wcsNormalization.messages, wcsNormalization.warning);
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
  const placement = resolveCameraSafeFramePlacement(app.project, app.jobPlacement, {
    statusReport: laser.statusReport,
    workOriginActive: laser.workOriginActive,
    wcoCache: laser.wcoCache,
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    reportInches: laser.controllerSettings?.reportInches === true,
  });
  if (!placement.ok) {
    reportFramePreparationRefusal(placement.messages, wcsNormalization.warning);
    return null;
  }
  const externalEnvironment = captureStartExternalEnvironment(app.project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
    placement.jobOrigin,
    false,
  );
  if (!prepared.ok) {
    reportFramePreparationRefusal(prepared.messages, wcsNormalization.warning);
    return null;
  }
  return {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    externalEnvironment,
    ...(wcsNormalization.warning === undefined
      ? {}
      : { frameWcsNormalizationWarning: wcsNormalization.warning }),
  };
}

async function dispatchReviewedFrame(review: ConfirmedJobReview): Promise<boolean> {
  const { bundle } = review;
  if (!(await requireFrameControllerQueue())) return false;
  const currentLaser = useLaserStore.getState();
  if (!reviewedFrameIsCurrent(bundle, currentLaser)) {
    reportFrameRefusal([
      'The job or machine setup changed during review. Review the current job and Frame again.',
    ]);
    return false;
  }

  const framePreflight = preflightFrameCandidate(bundle.prepared, {
    statusReport: currentLaser.statusReport,
    wcoCache: currentLaser.wcoCache,
    reportInches: currentLaser.controllerSettings?.reportInches === true,
  });
  if (!framePreflight.ok) {
    reportFrameRefusal(framePreflight.messages);
    return false;
  }
  const { jobBounds, motionBounds } = framePreflight;
  const returnToWorkPosition = currentWorkXy(currentLaser);
  if (returnToWorkPosition === undefined) {
    reportFrameRefusal([
      'The controller did not report a usable work position. Wait for a complete status report, then Frame again.',
    ]);
    return false;
  }
  const candidate: FramedRunCandidate = {
    preparedStart: bundle.prepared,
    project: bundle.project,
    outputScope: currentOutputScope(bundle.app),
    executionSignature: bundle.prepared.canvasPlan.retentionKey,
    controllerBeforeFrame: framedRunControllerSnapshot(currentLaser),
    externalEnvironment: bundle.externalEnvironment,
    frameVerification: {
      boundsSignature: frameBoundsSignature(jobBounds),
      wco: currentLaser.wcoCache,
      workOriginActive: currentLaser.workOriginActive,
    },
    returnToWorkPosition,
    ...(review.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: review.laserModeStartEvidence }),
    ...(review.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: review.cncSetupAttestation }),
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
    reportFrameRefusal([
      'The controller did not dispatch framing motion. No job was authorized to start.',
    ]);
    return false;
  }
  return reportFrameCompletion(candidate, await completion.result);
}

function reportFrameCompletion(candidate: FramedRunCandidate, accepted: boolean): boolean {
  if (!accepted) return false;
  if (useLaserStore.getState().framedRun?.candidate !== candidate) {
    useToastStore
      .getState()
      .pushToast(
        'Frame completed, but the job or machine setup changed. Frame the current job again before starting.',
        'warning',
      );
    return false;
  }
  useToastStore
    .getState()
    .pushToast('Frame complete — this exact job is ready to start.', 'success');
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

function reviewedFrameIsCurrent(
  bundle: ReviewedStartBundle,
  currentLaser: ReturnType<typeof useLaserStore.getState>,
): boolean {
  return (
    currentReplayExecutionSignature() === bundle.prepared.canvasPlan.retentionKey &&
    startExternalEnvironmentMatches(
      bundle.externalEnvironment,
      useStore.getState().project,
      useCameraStore.getState(),
    ) &&
    controllerStartPreparationStillCurrent(bundle.laser, currentLaser)
  );
}

function currentWorkXy(
  laser: ReturnType<typeof useLaserStore.getState>,
): { readonly x: number; readonly y: number } | undefined {
  const position = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  return position === null ? undefined : { x: position.x, y: position.y };
}

function waitForFrameOutcome(candidate: FramedRunCandidate): {
  readonly result: Promise<boolean>;
  readonly cancel: () => void;
  readonly observeAfterDispatch: () => boolean;
} {
  let settled = false;
  let sawOwnedFrame = false;
  let finish: (value: boolean) => void = () => undefined;
  const result = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const complete = (value: boolean): void => {
    if (settled) return;
    settled = true;
    unsubscribe();
    finish(value);
  };
  const unsubscribe = useLaserStore.subscribe((state, previous) => {
    const ownedOperation = candidateFrameOperation(state.motionOperation, candidate);
    if (ownedOperation !== null) {
      sawOwnedFrame = true;
      if (ownedOperation.cancelRequested === true) {
        complete(false);
        return;
      }
    }
    if (state.framedRun?.candidate === candidate) {
      complete(true);
      return;
    }
    if (
      sawOwnedFrame &&
      candidateFrameOperation(previous.motionOperation, candidate) !== null &&
      state.motionOperation === null
    ) {
      complete(false);
    }
  });
  const observeAfterDispatch = (): boolean => {
    const state = useLaserStore.getState();
    if (state.framedRun?.candidate === candidate) {
      complete(true);
      return true;
    }
    const operation = candidateFrameOperation(state.motionOperation, candidate);
    const dispatched = operation !== null && operation.cancelRequested !== true;
    if (!dispatched) complete(false);
    return dispatched;
  };
  return { result, cancel: () => complete(false), observeAfterDispatch };
}

function candidateFrameOperation(
  operation: LaserMotionOperation | null,
  candidate: FramedRunCandidate,
): (LaserMotionOperation & { readonly kind: 'frame' }) | null {
  return operation?.kind === 'frame' && operation.candidate === candidate ? operation : null;
}

function reportFrameRefusal(messages: ReadonlyArray<string>): void {
  useStartBlockerStore.getState().report(messages);
  useToastStore.getState().pushToast(messages[0] ?? 'The job cannot be framed.', 'error');
}

function reportFramePreparationRefusal(
  messages: ReadonlyArray<string>,
  wcsNormalizationWarning: string | undefined,
): void {
  reportFrameRefusal(
    wcsNormalizationWarning === undefined ? messages : [...messages, wcsNormalizationWarning],
  );
}

async function requireFrameControllerQueue(): Promise<boolean> {
  const issue = await frameControllerQueueIssue();
  if (issue === null) return true;
  reportFrameRefusal([issue]);
  return false;
}
