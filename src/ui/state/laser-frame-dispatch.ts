import {
  markMotionOperationDispatched,
  type LaserMotionOperationId,
} from './laser-motion-operation';
import type { LaserState } from './laser-store';
import type { SafeWriteFn, SetFn } from './laser-line-shared';
import { assertMachineExecutionOwner, ownedMachineWrite } from './machine-execution-owner';

export function dispatchQueuedMotionLine(
  set: SetFn,
  get: () => LaserState,
  safeWrite: SafeWriteFn,
  line: string,
  operationId: LaserMotionOperationId,
): void {
  const operation = get().motionOperation;
  if (operation?.operationId !== operationId || operation.cancelRequested === true) return;
  const kind = operation.kind;
  const mpgInterruptionId = operation.mpgInterruptionId;
  void Promise.resolve()
    .then(() => {
      const current = get().motionOperation;
      if (
        current?.operationId !== operationId ||
        current.cancelRequested === true ||
        current.mpgInterruptionId !== mpgInterruptionId
      )
        return;
      assertMachineExecutionOwner(operation.executionOwner);
      operation.executionOwner?.onDispatch?.();
      return ownedMachineWrite(safeWrite, {
        assertCurrent: () => {
          const live = get().motionOperation;
          if (
            live?.operationId !== operationId ||
            live.cancelRequested === true ||
            live.mpgInterruptionId !== mpgInterruptionId
          )
            throw new Error('The motion owner changed before dispatch.');
          assertMachineExecutionOwner(operation.executionOwner);
        },
      })(line, kind);
    })
    .then(() => {
      set((state) => ({
        motionOperation: markMotionOperationDispatched(state.motionOperation, kind, operationId),
      }));
    })
    .catch(() => {
      set((state) =>
        state.motionOperation?.operationId === operationId &&
        state.motionOperation.mpgInterruptionId === mpgInterruptionId
          ? {
              motionOperation: { ...state.motionOperation, cancelRequested: true },
              frameVerification: null,
              framedRun: null,
              frameTrace: null,
            }
          : {},
      );
    });
}
