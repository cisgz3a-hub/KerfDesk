import { frameBoundsSignature, type JobOriginPlacement } from '../../core/job';
import { currentOutputScope, type useStore } from '../state';
import type { useCameraStore } from '../state/camera-store';
import { publishFramePreparationStage } from '../state/frame-preparation-store';
import {
  framedRunControllerSnapshot,
  mintDeferredFramedRunPermit,
  type FramedRunPermit,
  type FrameTrace,
  type FrameTraceCandidate,
} from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  frameBoundsPreviewMatches,
  type FrameBoundsPreview,
  type TraceableFrameBoundsPreview,
} from './frame-bounds-preview';
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
import { frameTraceReadinessIssue, transientMachineActivity } from './framed-run-invalidation';
import { frameInputsAreCurrent } from './reviewed-frame-current';
import { ownFramePreparationMotion } from './frame-preparation-motion-owner';
import type { StartJobPreparation } from './start-job-readiness';
import { prepareCurrentStartJob } from './start-job-source';
import { STALE_START_PREPARATION_MESSAGE } from './start-preparation-owner';
import type { StartPreparationPlacement } from './start-preparation-coordinate-key';

/**
 * The split Frame (ADR-353). A dense job's outline is known as soon as the
 * job is compiled — seconds before its exact program is emitted, preflighted,
 * timed and packed. The exact preparation runs off-thread as before; the
 * moment it reports the outline, the physical Frame traces it. When the
 * program arrives, its own frame bounds must reproduce the traced ones and
 * nothing may have drifted since the trace's clean completion; only then is
 * the permit minted, from the trace's completion evidence and the exact
 * program. Frame stays the only Start guard, and a permit still names exact
 * bytes: this changes when the operator waits, not what is authorized.
 */

/** Everything an ordinary Frame owns before it compiles anything. */
export type FrameContext = {
  readonly app: ReturnType<typeof useStore.getState>;
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly camera: ReturnType<typeof useCameraStore.getState>;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly wcsNormalizationWarning?: string;
};

export type ExactFramePreparation = {
  readonly program: Promise<StartJobPreparation>;
  /** The outline as soon as the preparation reports it, or null once the
   * program settles without reporting one (main-thread preparation, an early
   * refusal, or a preparation that failed outright). */
  readonly earlyBounds: Promise<FrameBoundsPreview | null>;
  readonly signal: AbortSignal;
  readonly claimTrace: (candidate: FrameTraceCandidate) => void;
  readonly abort: () => void;
};

export const FRAME_TRACE_PROGRAM_REFUSED_MESSAGE =
  "Frame traced the job's outline, but the exact job could not be prepared. No Start permit was issued.";
export const FRAME_TRACE_PROGRAM_MISMATCH_MESSAGE =
  "The exact job's motion envelope differs from the outline Frame traced. No Start permit was issued; Frame the job again.";

export function startExactFramePreparation(context: FrameContext): ExactFramePreparation {
  const controller = new AbortController();
  const motionOwner = ownFramePreparationMotion(context.laser);
  let deliver: (preview: FrameBoundsPreview | null) => void = () => undefined;
  const earlyBounds = new Promise<FrameBoundsPreview | null>((resolve) => {
    deliver = resolve;
  });
  const program = prepareCurrentStartJob(
    context.app,
    context.laser,
    context.camera,
    context.jobOrigin,
    false,
    controller.signal,
    { onFrameBounds: (preview) => deliver(preview), frameMotionOwner: motionOwner },
  );
  // Without an early outline the program itself is the first thing to arrive.
  void program.then(
    () => deliver(null),
    () => deliver(null),
  );
  return {
    program,
    earlyBounds,
    signal: controller.signal,
    claimTrace: motionOwner.claim,
    abort: () => controller.abort(),
  };
}

/** Trace the outline now; bind the exact program when it arrives. */
export async function dispatchTracedFrame(
  context: FrameContext,
  preview: TraceableFrameBoundsPreview,
  preparation: ExactFramePreparation,
): Promise<boolean> {
  const trace = await traceFrameOutline(context, preview, preparation);
  if (trace === null) {
    // No permit can follow a trace that did not complete cleanly, so the
    // program being prepared for it has no owner; free the worker for the
    // operator's next Frame.
    preparation.abort();
    await settleQuietly(preparation.program);
    return false;
  }
  publishFramePreparationStage('finishing');
  let prepared: StartJobPreparation;
  try {
    prepared = await preparation.program;
    preparation.signal.throwIfAborted();
  } catch (error) {
    discardTrace(trace);
    throw error;
  }
  return bindExactProgramToTrace(context, trace, preview, prepared);
}

async function traceFrameOutline(
  context: FrameContext,
  preview: TraceableFrameBoundsPreview,
  preparation: ExactFramePreparation,
): Promise<FrameTrace | null> {
  if (!(await requireFrameControllerQueue(preparation.signal))) return null;
  preparation.signal.throwIfAborted();
  const currentLaser = useLaserStore.getState();
  if (
    !frameInputsAreCurrent({
      device: context.app.project.device,
      preparedAgainst: context.laser,
      executionSignature: preview.retentionKey,
      coordinateContext: traceCoordinateContext(context),
      currentLaser,
    })
  ) {
    reportFrameRefusal([FRAME_SETUP_CHANGED_BEFORE_DISPATCH_MESSAGE]);
    return null;
  }
  const returnToWorkPosition = currentWorkXy(currentLaser);
  if (returnToWorkPosition === undefined) {
    reportFrameRefusal([FRAME_WORK_POSITION_UNKNOWN_MESSAGE]);
    return null;
  }
  const candidate = traceCandidate(context, preview, currentLaser, returnToWorkPosition);
  preparation.claimTrace(candidate);
  publishFramePreparationStage('tracing');
  const completion = waitForFrameOutcome(candidate);
  try {
    await currentLaser.traceFrame(
      preview.frameMotionBounds,
      context.app.project.device.framingFeedMmPerMin,
      candidate,
    );
  } catch (error) {
    completion.cancel();
    reportFrameRefusal([error instanceof Error ? error.message : String(error)]);
    return null;
  }
  if (!completion.observeAfterDispatch()) {
    reportFrameRefusal([FRAME_NOT_DISPATCHED_MESSAGE]);
    return null;
  }
  if (!(await completion.result)) return null;
  const trace = useLaserStore.getState().frameTrace ?? null;
  if (trace?.candidate !== candidate) {
    useToastStore.getState().pushToast(FRAME_COMPLETED_BUT_CHANGED_MESSAGE, 'warning');
    return null;
  }
  return trace;
}

function traceCandidate(
  context: FrameContext,
  preview: TraceableFrameBoundsPreview,
  currentLaser: ReturnType<typeof useLaserStore.getState>,
  returnToWorkPosition: { readonly x: number; readonly y: number },
): FrameTraceCandidate {
  const verificationBounds = frameVerificationBounds(
    context.app.project.machine?.kind,
    preview.frameJobBounds,
    preview.frameMotionBounds,
  );
  return {
    exactProgram: 'deferred',
    project: context.app.project,
    outputScope: currentOutputScope(context.app),
    executionSignature: preview.retentionKey,
    controllerBeforeFrame: framedRunControllerSnapshot(currentLaser),
    frameVerification: {
      boundsSignature: frameBoundsSignature(verificationBounds),
      wco: currentLaser.wcoCache,
      workOriginActive: currentLaser.workOriginActive,
    },
    returnToWorkPosition,
    ...(context.wcsNormalizationWarning === undefined
      ? {}
      : { frameWcsNormalizationWarning: context.wcsNormalizationWarning }),
  };
}

/** The coordinate inputs this Frame's preparation started from; identical to
 * what the preparation owner watches while the compile runs. */
function traceCoordinateContext(context: FrameContext): StartPreparationPlacement {
  return {
    jobPlacement: context.app.jobPlacement,
    ...(context.jobOrigin === undefined ? {} : { resolvedJobOrigin: context.jobOrigin }),
  };
}

function bindExactProgramToTrace(
  context: FrameContext,
  trace: FrameTrace,
  preview: TraceableFrameBoundsPreview,
  prepared: StartJobPreparation,
): boolean {
  if (!prepared.ok) {
    discardTrace(trace);
    if (prepared.messages.includes(STALE_START_PREPARATION_MESSAGE)) {
      useToastStore.getState().pushToast(FRAME_COMPLETED_BUT_CHANGED_MESSAGE, 'warning');
      return false;
    }
    reportFramePreparationRefusal(
      [FRAME_TRACE_PROGRAM_REFUSED_MESSAGE, ...prepared.messages],
      context.wcsNormalizationWarning,
    );
    return false;
  }
  if (!frameBoundsPreviewMatches(preview, prepared)) {
    discardTrace(trace);
    reportFrameRefusal([FRAME_TRACE_PROGRAM_MISMATCH_MESSAGE]);
    return false;
  }
  const permit = mintDeferredFramedRunPermit(trace, prepared);
  if (!claimTraceAsPermit(trace, permit)) {
    useToastStore.getState().pushToast(FRAME_COMPLETED_BUT_CHANGED_MESSAGE, 'warning');
    return false;
  }
  useToastStore.getState().pushToast(FRAME_COMPLETE_MESSAGE, 'success');
  return true;
}

/** One synchronous exchange: the trace the store still holds becomes the
 * permit, or nothing changes. The expiry subscription voids a trace on any
 * drift; the same conditions are re-checked here so a mint can never outrun
 * an expiry queued for the same store change. */
function claimTraceAsPermit(trace: FrameTrace, permit: FramedRunPermit): boolean {
  let minted = false;
  useLaserStore.setState((current) => {
    if (current.frameTrace !== trace) return {};
    if (
      transientMachineActivity(current, false) ||
      frameTraceReadinessIssue(trace, current) !== null
    ) {
      return { frameTrace: null };
    }
    minted = true;
    return {
      framedRun: permit,
      frameTrace: null,
      frameVerification: permit.candidate.frameVerification,
    };
  });
  return minted;
}

function discardTrace(trace: FrameTrace): void {
  useLaserStore.setState((current) => (current.frameTrace === trace ? { frameTrace: null } : {}));
}

async function settleQuietly(program: Promise<unknown>): Promise<void> {
  await program.then(
    () => undefined,
    () => undefined,
  );
}
