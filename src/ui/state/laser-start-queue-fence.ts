import type { LaserState } from './laser-store';

export function hasPendingControllerWrite(state: LaserState): boolean {
  return state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0;
}

export function startPendingControllerMessage(state: LaserState): string {
  const transportWrites = state.pendingTransportWrites ?? 0;
  const terminalAcks = state.pendingUntrackedAcks;
  const blockers: string[] = [];
  if (transportWrites > 0) {
    blockers.push(
      `${transportWrites} controller ${transportWrites === 1 ? 'write is' : 'writes are'} still in transport`,
    );
  }
  if (terminalAcks > 0) {
    blockers.push(
      `${terminalAcks} terminal ${terminalAcks === 1 ? 'acknowledgement is' : 'acknowledgements are'} still owed`,
    );
  }
  const detail = blockers.length > 0 ? blockers.join('; ') : 'the controller queue is not settled';
  return (
    `Controller queue is not settled: ${detail}. Start was blocked so a late completion or response ` +
    'cannot corrupt the job stream — check the connection and try again.'
  );
}
