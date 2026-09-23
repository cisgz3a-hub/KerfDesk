// Job refill writes are the other half of the acknowledgement flood: one per
// acknowledged line. Counting them in the store's pendingTransportWrites made
// that field flip 0 -> 1 -> 0 on every ack, so every laser-store subscriber
// was woken twice more per line and any component selecting the counter
// re-rendered twice per line, mid-burn (ADR-352). They are counted here
// instead. The count is keyed on the write epoch: every site that zeroes the
// store counter advances the epoch first, so a session change forgets these
// writes exactly as it forgets the store's, and a late completion from a dead
// session cannot touch the new count.

export interface JobTransportLedger {
  readonly epoch: number;
  readonly count: number;
}

export type JobTransportLedgerRefs = {
  writeEpoch?: number;
  jobTransportWrites?: JobTransportLedger;
};

/** Count one job refill entering transport; returns the epoch it belongs to. */
export function beginJobTransportWrite(refs: JobTransportLedgerRefs): number {
  const epoch = refs.writeEpoch ?? 0;
  const ledger = refs.jobTransportWrites;
  const count = ledger !== undefined && ledger.epoch === epoch ? ledger.count : 0;
  refs.jobTransportWrites = { epoch, count: count + 1 };
  return epoch;
}

/** Settle one job refill that left transport (resolved or rejected). */
export function settleJobTransportWrite(refs: JobTransportLedgerRefs, epoch: number): void {
  const ledger = refs.jobTransportWrites;
  if (ledger === undefined || ledger.epoch !== epoch) return;
  refs.jobTransportWrites = { epoch, count: Math.max(0, ledger.count - 1) };
}

export function jobTransportWritesInFlight(refs: JobTransportLedgerRefs): number {
  const ledger = refs.jobTransportWrites;
  if (ledger === undefined || ledger.epoch !== (refs.writeEpoch ?? 0)) return 0;
  return ledger.count;
}

// The queue fence and the other state-only readers cannot import the store's
// refs without an import cycle, so the store binds its live refs here once.
let liveRefs: JobTransportLedgerRefs | null = null;

export function bindLiveJobTransportLedger(refs: JobTransportLedgerRefs): void {
  liveRefs = refs;
}

/** Job refills the live store still has in transport in its current session. */
export function liveJobTransportWritesInFlight(): number {
  return liveRefs === null ? 0 : jobTransportWritesInFlight(liveRefs);
}
