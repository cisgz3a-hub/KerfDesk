import { useLaserStore } from '../state/laser-store';
import type { OwnedMachineOperation } from './machine-operation-state';
import { RemoteFault } from './fault';

export function settledMachineMotion(operation: OwnedMachineOperation): Promise<void> {
  let interrupted = false;
  let priorWriteError = useLaserStore.getState().lastWriteError;
  return observeSettlement(operation, () => {
    const state = useLaserStore.getState();
    const motion = state.motionOperation;
    if (state.lastWriteError !== null && state.lastWriteError !== priorWriteError)
      interrupted = true;
    priorWriteError = state.lastWriteError;
    if (motion !== null && motion.operationId === operation.motionId) {
      if (motion.cancelRequested === true || motion.interruptedByMpg === true) interrupted = true;
      return false;
    }
    if (interrupted) throw new RemoteFault('cancelled');
    if (state.motionOperation !== null || state.statusReport?.state !== 'Idle')
      throw new RemoteFault('unavailable');
    return true;
  });
}
export function settledMachineJob(operation: OwnedMachineOperation): Promise<void> {
  return observeSettlement(
    operation,
    () => {
      const state = useLaserStore.getState();
      if (state.streamerEpoch !== operation.streamerEpoch || state.activeRunId !== operation.runId)
        throw new RemoteFault('unavailable');
      if (
        state.streamer === null ||
        ['cancelled', 'errored', 'disconnected'].includes(state.streamer.status)
      )
        throw new RemoteFault('unavailable');
      return state.streamer.status === 'done' && state.statusReport?.state === 'Idle';
    },
    false,
  );
}
function observeSettlement(
  operation: OwnedMachineOperation,
  isSettled: () => boolean,
  cancelOnGrantLoss = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const abort = () => {
      if (cancelOnGrantLoss) finish(new RemoteFault('cancelled'));
    };
    const finish = (error?: unknown) => {
      unsubscribe();
      operation.controller.signal.removeEventListener('abort', abort);
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new RemoteFault('unavailable'));
    };
    const observe = () => {
      try {
        if (useLaserStore.getState().controllerSessionEpoch !== operation.controllerEpoch)
          throw new RemoteFault('unavailable');
        if (cancelOnGrantLoss) operation.controller.signal.throwIfAborted();
        if (isSettled()) finish();
      } catch (error) {
        finish(error);
      }
    };
    unsubscribe = useLaserStore.subscribe(observe);
    operation.controller.signal.addEventListener('abort', abort, { once: true });
    observe();
  });
}
