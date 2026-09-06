import type { GetFn, SafeWriteFn, SetFn } from './laser-line-shared';
import type { LaserMotionOperationId } from './laser-motion-operation';
import type { LiveRefs } from './laser-store';
import { pushLog, serialWriteErrorMessage } from './laser-store-helpers';

export type CancelContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: LiveRefs;
  readonly safeWrite: SafeWriteFn;
  readonly operationId: LaserMotionOperationId | undefined;
  readonly attemptId: symbol;
  readonly sessionEpoch: number;
  readonly positionEpoch: number;
  readonly writeEpoch: number;
};

export function createCancelContext(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
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
  // A rejected old adapter promise or status waiter must not overwrite a new
  // connection's notice, or the newer MPG interruption/recovery message.
  if (!sameCancelSession(context)) return;
  const operation = context.get().motionOperation;
  if (
    operation !== null &&
    (operation.operationId !== context.operationId ||
      operation.cancelAttemptId !== context.attemptId)
  ) {
    return;
  }
  const message = `Motion cancellation needs attention: ${serialWriteErrorMessage(error)}`;
  context.set((state) => ({
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  }));
}

function sameCancelSession(context: CancelContext): boolean {
  const state = context.get();
  return (
    state.controllerSessionEpoch === context.sessionEpoch &&
    (state.trustedPositionEpoch ?? 0) === context.positionEpoch &&
    (context.refs.writeEpoch ?? 0) === context.writeEpoch
  );
}
