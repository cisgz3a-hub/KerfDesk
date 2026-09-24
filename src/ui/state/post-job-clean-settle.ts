// The one definition of a run that finished cleanly: its stream ended 'done'
// while the post-job settle was awaiting Idle, and the release came from a
// connected controller reporting Idle. The recovery ledger records a run as
// completed only on this evidence, and "advance variables after a successful
// stream" uses the same rule. It used to accept any 'done' stream released at
// Idle, so a serial number advanced for a run whose settle had failed while
// the ledger recorded it as interrupted (controller audit gap-start-6).

import type { StreamerStatus } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

type SettleSnapshot = Pick<LaserState, 'streamer' | 'controllerOperation'>;

/** The prior state was the settle's own wait for Idle after a 'done' stream. */
export function awaitingCleanSettle(prior: SettleSnapshot | undefined): boolean {
  return (
    prior?.streamer?.status === 'done' &&
    prior.controllerOperation?.kind === 'post-job-settle' &&
    prior.controllerOperation.phase === 'awaiting-idle'
  );
}

export function settledCleanly(
  state: Pick<LaserState, 'connection' | 'statusReport'>,
  prior: SettleSnapshot | undefined,
  previousStatus: StreamerStatus,
): boolean {
  return (
    previousStatus === 'done' &&
    awaitingCleanSettle(prior) &&
    state.connection.kind === 'connected' &&
    state.statusReport?.state === 'Idle'
  );
}
