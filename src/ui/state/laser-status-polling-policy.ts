import { hasUnsettledStreamAcks, isActiveJob } from './laser-store-helpers';
import type { LaserState, LiveRefs } from './laser-store';

export function controllerOperationOwnsPolling(state: LaserState): boolean {
  const operation = state.controllerOperation;
  if (operation?.kind === 'start-arming') return true;
  // Settings/build-info workflows are terminal-only interactive exchanges.
  // Realtime Alarm reports invalidate controller commands globally, so the
  // background poll must not cancel the exact read that owns this interval.
  if (
    operation?.kind === 'interactive-command' &&
    operation.pollingOwnership === 'terminal-exchange'
  ) {
    return true;
  }
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
