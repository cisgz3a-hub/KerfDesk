import { hasUnsettledStreamAcks, isActiveJob } from './laser-store-helpers';
import type { LaserState, LiveRefs } from './laser-store';

export function controllerOperationOwnsPolling(state: LaserState): boolean {
  const operation = state.controllerOperation;
  if (operation?.kind === 'start-arming') return true;
  return operation?.kind === 'recovery' && operation.phase === 'reset';
}

export function canSendQueuedStatusQuery(
  state: LaserState,
  refs: LiveRefs,
  pollTick: number,
  idlePollDivisor: number,
): boolean {
  if (hasUnsettledStreamAcks(state.streamer)) return false;
  if (state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0) return false;
  if (refs.controllerCommand !== null) return false;
  return shouldFastPoll(state) || pollTick % idlePollDivisor === 0;
}

export function shouldFastPoll(state: LaserState): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.motionOperation !== null ||
    state.controllerOperation !== null ||
    state.autofocusBusy ||
    state.probeBusy
  );
}
