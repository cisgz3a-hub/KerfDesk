import type { JobBounds } from '../../core/job';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import type { FrameMotionCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import type { LaserMotionOperation, LaserMotionOperationId } from '../state/laser-motion-operation';
import { useToastStore } from '../state/toast-store';
import { frameControllerQueueIssue } from './frame-controller-readiness';
import { reportStartBlockers } from './start-blocker-invalidation';

// Shared by the exact Frame (use-frame-action.ts) and the split Frame that
// traces a job's outline before its program exists (frame-trace-flow.ts,
// ADR-353). Both dispatch one physical Frame motion and wait for the store to
// publish its clean completion; only what completion publishes differs.

export const FRAME_SETUP_CHANGED_BEFORE_DISPATCH_MESSAGE =
  'The job or machine setup changed before Frame could run. Frame the current job again.';
export const FRAME_WORK_POSITION_UNKNOWN_MESSAGE =
  'The controller did not report a usable work position. Wait for a complete status report, then Frame again.';
export const FRAME_NOT_DISPATCHED_MESSAGE =
  'The controller did not dispatch framing motion. No job was authorized to start.';
export const FRAME_COMPLETED_BUT_CHANGED_MESSAGE =
  'Frame completed, but the job or machine setup changed. Frame the current job again before starting.';
export const FRAME_COMPLETE_MESSAGE =
  'Frame complete — press Start to review and run this exact job.';

export type FrameOutcome = {
  readonly result: Promise<boolean>;
  readonly cancel: () => void;
  readonly observeAfterDispatch: () => boolean;
};

/** Resolves true when the store publishes this candidate's clean completion
 * (a permit for an exact candidate, a trace for a deferred one); false on
 * cancel, failure, or an owned Frame that ends without publishing. */
export function waitForFrameOutcome(candidate: FrameMotionCandidate): FrameOutcome {
  let settled = false;
  let sawOwnedFrame = false;
  let operationId: LaserMotionOperationId | null = null;
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
      if (operationId !== null && ownedOperation.operationId !== operationId) {
        complete(false);
        return;
      }
      operationId = ownedOperation.operationId;
      sawOwnedFrame = true;
      if (ownedOperation.cancelRequested === true) {
        complete(false);
        return;
      }
    }
    if (completionPublishedFor(state, candidate)) {
      complete(true);
      return;
    }
    if (
      sawOwnedFrame &&
      candidateFrameOperation(previous.motionOperation, candidate) !== null &&
      ownedOperation === null
    ) {
      complete(false);
    }
  });
  const observeAfterDispatch = (): boolean => {
    const state = useLaserStore.getState();
    if (completionPublishedFor(state, candidate)) {
      complete(true);
      return true;
    }
    const operation = candidateFrameOperation(state.motionOperation, candidate);
    const dispatched =
      operation !== null &&
      operation.cancelRequested !== true &&
      (operationId === null || operation.operationId === operationId);
    if (!dispatched) complete(false);
    return dispatched;
  };
  return { result, cancel: () => complete(false), observeAfterDispatch };
}

function completionPublishedFor(
  state: ReturnType<typeof useLaserStore.getState>,
  candidate: FrameMotionCandidate,
): boolean {
  return state.framedRun?.candidate === candidate || state.frameTrace?.candidate === candidate;
}

export function candidateFrameOperation(
  operation: LaserMotionOperation | null,
  candidate: FrameMotionCandidate,
): (LaserMotionOperation & { readonly kind: 'frame' }) | null {
  return operation?.kind === 'frame' && operation.candidate === candidate ? operation : null;
}

export function currentWorkXy(
  laser: ReturnType<typeof useLaserStore.getState>,
): { readonly x: number; readonly y: number } | undefined {
  const position = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  return position === null ? undefined : { x: position.x, y: position.y };
}

/** CNC frames prove the traced XY bounds; laser frames prove the complete
 * emitted motion envelope, runways and scan offsets included. */
export function frameVerificationBounds(
  machineKind: 'laser' | 'cnc' | undefined,
  jobBounds: JobBounds,
  motionBounds: JobBounds,
): JobBounds {
  return machineKind === 'cnc' ? jobBounds : motionBounds;
}

export function reportFrameRefusal(messages: ReadonlyArray<string>): void {
  reportStartBlockers(messages, 'frame');
  useToastStore.getState().pushToast(messages[0] ?? 'The job cannot be framed.', 'error');
}

export function reportFramePreparationRefusal(
  messages: ReadonlyArray<string>,
  wcsNormalizationWarning: string | undefined,
): void {
  reportFrameRefusal(
    wcsNormalizationWarning === undefined ? messages : [...messages, wcsNormalizationWarning],
  );
}

export async function requireFrameControllerQueue(signal?: AbortSignal): Promise<boolean> {
  const issue = await frameControllerQueueIssue(signal);
  signal?.throwIfAborted();
  if (issue === null) return true;
  reportFrameRefusal([issue]);
  return false;
}
