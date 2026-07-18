import { markMotionOperationDispatched } from './laser-motion-operation';
import type { LaserState } from './laser-store';
import type { SafeWriteFn, SetFn } from './laser-line-shared';

export function dispatchQueuedMotionLine(
  set: SetFn,
  get: () => LaserState,
  safeWrite: SafeWriteFn,
  line: string,
  operationId: number,
): void {
  const operation = get().motionOperation;
  if (operation?.operationId !== operationId || operation.cancelRequested === true) return;
  const kind = operation.kind;
  void safeWrite(line, kind)
    .then(() => {
      set((state) => ({
        motionOperation: markMotionOperationDispatched(state.motionOperation, kind, operationId),
      }));
    })
    .catch(() => {
      set((state) =>
        state.motionOperation?.operationId === operationId
          ? {
              motionOperation: { ...state.motionOperation, cancelRequested: true },
              frameVerification: null,
              framedRun: null,
            }
          : {},
      );
    });
}
