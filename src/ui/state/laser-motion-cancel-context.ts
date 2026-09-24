import type { ControllerDriver } from '../../core/controllers';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { GetFn, SafeWriteFn, SetFn } from './laser-line-shared';
import type { LaserMotionOperation, LaserMotionOperationId } from './laser-motion-operation';
import { pushLog, serialWriteErrorMessage } from './laser-store-helpers';

/** The live refs a cancel settlement needs. Both the store's LiveRefs and the
 * line handler's HandlerRefs satisfy it, so the status pipeline can start the
 * same settlement an operator Cancel runs. */
export type MotionCancelRefs = ControllerLifecycleRefs & {
  readonly driver: ControllerDriver;
};

export type CancelContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: MotionCancelRefs;
  readonly safeWrite: SafeWriteFn;
  readonly operationId: LaserMotionOperationId | undefined;
  readonly attemptId: symbol;
  readonly sessionEpoch: number;
  readonly positionEpoch: number;
  readonly writeEpoch: number;
  /** Operator-facing heading for a failed settlement. */
  readonly failureHeading: string;
};

export const OPERATOR_CANCEL_FAILURE_HEADING = 'Motion cancellation needs attention';

export function createCancelContext(
  set: SetFn,
  get: GetFn,
  refs: MotionCancelRefs,
  safeWrite: SafeWriteFn,
  failureHeading = OPERATOR_CANCEL_FAILURE_HEADING,
): CancelContext {
  const state = get();
  return {
    set,
    get,
    refs,
    safeWrite,
    operationId: state.motionOperation?.operationId,
    attemptId: Symbol('motion-cancel'),
    sessionEpoch: state.controllerSessionEpoch,
    positionEpoch: state.trustedPositionEpoch ?? 0,
    writeEpoch: refs.writeEpoch ?? 0,
    failureHeading,
  };
}

export function assertCancelContext(context: CancelContext, allowCompleted = false): void {
  const state = context.get();
  if (!sameCancelSession(context)) {
    throw new Error(
      'Motion cancellation was interrupted by a controller or motion-control change.',
    );
  }
  if (state.mpgActive === true) {
    throw new Error(
      'Cancel Jog cannot target motion while the pendant/MPG owns control. Return control to KerfDesk and wait for MPG:0.',
    );
  }
  const operation = state.motionOperation;
  if (allowCompleted && operation === null) return;
  if (
    context.operationId === undefined
      ? operation === null
      : operation?.operationId === context.operationId &&
        operation.cancelAttemptId === context.attemptId
  ) {
    return;
  }
  throw new Error('Motion cancellation was replaced before its confirmation completed.');
}

export function publishCancelFailure(context: CancelContext, error: unknown): void {
  const ownedOperation = endCancelAttempt(context);
  // A rejected old adapter promise or status waiter must not overwrite a new
  // connection's notice, or the newer MPG interruption/recovery message.
  if (!sameCancelSession(context)) return;
  if (context.get().motionOperation !== null && !ownedOperation) return;
  const message = `${context.failureHeading}: ${serialWriteErrorMessage(error)}`;
  context.set((state) => ({
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  }));
}

/** The failed attempt no longer owns the marker -> status boundary. Hand the
 * cancelled owner back so background status polling resumes and a later fresh
 * Idle can settle and release it; keeping the attempt id froze the DRO on the
 * last report and left the owner unreleasable (audit job-lifecycle-5). Returns
 * whether this attempt still owned the operation. */
function endCancelAttempt(context: CancelContext): boolean {
  const operation = context.get().motionOperation;
  if (
    operation === null ||
    operation.operationId !== context.operationId ||
    operation.cancelAttemptId !== context.attemptId
  ) {
    return false;
  }
  context.set((state) =>
    state.motionOperation === operation ? { motionOperation: withoutCancelAttempt(operation) } : {},
  );
  return true;
}

function withoutCancelAttempt(operation: LaserMotionOperation): LaserMotionOperation {
  const { cancelAttemptId: endedAttempt, ...rest } = operation;
  void endedAttempt;
  return rest;
}

function sameCancelSession(context: CancelContext): boolean {
  const state = context.get();
  return (
    state.controllerSessionEpoch === context.sessionEpoch &&
    (state.trustedPositionEpoch ?? 0) === context.positionEpoch &&
    (context.refs.writeEpoch ?? 0) === context.writeEpoch
  );
}
