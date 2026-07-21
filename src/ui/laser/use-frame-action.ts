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
import { type ConfirmedJobReview, type ReviewedStartBundle } from './job-review';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { resolveFrameCandidate } from './frame-candidate';

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
 */
export async function runFrameNow(): Promise<boolean> {
  ensureFramedRunInvalidationSubscriptions();
  useStartBlockerStore.getState().clear();
  const initial = await prepareFrameReviewBundle();
  if (initial === null) return false;
  return dispatchPreparedFrame(initial);
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
  useStartBlockerStore.getState().clear();
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

async function prepareFrameReviewBundle(): Promise<ReviewedStartBundle | null> {
  if (!(await requireFrameControllerQueue())) return null;
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

type PreparedFrameDispatchOptions = {
  readonly review?: FramedRunReviewEvidence;
  readonly authorizationContext?: 'transient-camera';
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
    reportFrameRefusal([
      'The job or machine setup changed before Frame could run. Frame the current job again.',
    ]);
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
    reportFrameRefusal([
      'The controller did not report a usable work position. Wait for a complete status report, then Frame again.',
    ]);
    return false;
  }
  const candidateOptions = reviewedFrameCandidateOptions(bundle, options);
  const candidate: FramedRunCandidate = {
    preparedStart: bundle.prepared,
    project: bundle.project,
    ...candidateOptions,
    executionSignature: bundle.prepared.canvasPlan.retentionKey,
    controllerBeforeFrame: framedRunControllerSnapshot(currentLaser),
    externalEnvironment: bundle.externalEnvironment,
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
    reportFrameRefusal([
      'The controller did not dispatch framing motion. No job was authorized to start.',
    ]);
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

function frameVerificationBounds(
  machineKind: 'laser' | 'cnc' | undefined,
  jobBounds: Parameters<typeof frameBoundsSignature>[0],
  motionBounds: Parameters<typeof frameBoundsSignature>[0],
): Parameters<typeof frameBoundsSignature>[0] {
  return machineKind === 'cnc' ? jobBounds : motionBounds;
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
    .pushToast('Frame complete — press Start to review and run this exact job.', 'success');
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
  authorizationContext: 'transient-camera' | undefined,
): boolean {
  const transientProject = authorizationContext === 'transient-camera';
  return (
    (transientProject ||
      currentReplayExecutionSignature() === bundle.prepared.canvasPlan.retentionKey) &&
    startExternalEnvironmentMatches(
      bundle.externalEnvironment,
      transientProject ? bundle.project : useStore.getState().project,
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
