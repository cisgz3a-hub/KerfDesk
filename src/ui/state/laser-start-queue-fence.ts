import { liveJobTransportWritesInFlight } from './laser-job-transport-ledger';
import type { LaserState } from './laser-store';

/** Controller writes still in transport: the store's counted writes plus the
 * job refills kept off the store so they do not wake it per line (ADR-349). */
export function pendingTransportWriteCount(
  state: Pick<LaserState, 'pendingTransportWrites'>,
): number {
  return (state.pendingTransportWrites ?? 0) + liveJobTransportWritesInFlight();
}

export function hasPendingControllerWrite(state: LaserState): boolean {
  return state.pendingUntrackedAcks > 0 || pendingTransportWriteCount(state) > 0;
}

export function startPendingControllerMessage(state: LaserState): string {
  const transportWrites = pendingTransportWriteCount(state);
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
