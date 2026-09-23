// Stream acknowledgements that arrive together are applied together.
//
// The serial read loop hands the store every line of a chunk synchronously, and
// each stream-owned `ok` used to write the laser store, which wakes every
// mounted selector. A USB serial bridge delivers several acks per chunk at
// burn pace, and after the page was hidden or the thread was busy it delivers
// hundreds at once, which is where a late-job restore spent seconds per task.
// A plain stream ack is now counted and applied with the rest of its chunk in
// one store write and one refill write (ADR-352).
//
// Deferring must not change what any other line observes, so an ack is only
// deferred while ownership cannot depend on the streamer (no untracked ack is
// owed), nothing else consumes refills (no worker-hosted refill, no MPG hold),
// and the stream is certain to still be streaming afterwards: at least one of
// its lines stays in flight, so a deferred ack can never complete the job and
// start the post-job settle writes. Every other line flushes what is pending
// before it is handled, and the rest flushes in a microtask, before any timer,
// UI event or close handler can observe the store.

import { advanceStream, advanceStreamBy } from './laser-stream-ack';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { hostedRefillArmed } from './laser-hosted-refill';
import type { LaserState } from './laser-store';

export type StreamAckBatchRefs = {
  deferredStreamAcks?: number;
  streamAckFlushQueued?: boolean;
};

type BatchRefs = HandlerRefs & StreamAckBatchRefs;

export function mayDeferStreamAck(state: LaserState, refs: BatchRefs): boolean {
  const streamer = state.streamer;
  return (
    streamer !== null &&
    streamer.status === 'streaming' &&
    state.pendingUntrackedAcks === 0 &&
    state.mpgActive !== true &&
    !hostedRefillArmed(refs) &&
    (refs.deferredStreamAcks ?? 0) + 1 < streamer.inFlight.length
  );
}

export function deferStreamAck(
  set: SetFn,
  get: GetFn,
  refs: BatchRefs,
  safeWrite: SafeWriteFn,
): void {
  refs.deferredStreamAcks = (refs.deferredStreamAcks ?? 0) + 1;
  if (refs.streamAckFlushQueued === true) return;
  refs.streamAckFlushQueued = true;
  queueMicrotask(() => {
    refs.streamAckFlushQueued = false;
    flushDeferredStreamAcks(set, get, refs, safeWrite);
  });
}

export function flushDeferredStreamAcks(
  set: SetFn,
  get: GetFn,
  refs: BatchRefs,
  safeWrite: SafeWriteFn,
): void {
  let remaining = refs.deferredStreamAcks ?? 0;
  refs.deferredStreamAcks = 0;
  while (remaining > 0) remaining -= advanceStreamBy(set, get, refs, safeWrite, 'ok', remaining);
}

/** Applies held acks before any line that is not itself one more of them, so
 * every other line sees the store it always saw. */
export function flushStreamAcksBefore(
  set: SetFn,
  get: GetFn,
  refs: BatchRefs,
  safeWrite: SafeWriteFn,
  kind: string,
): void {
  if ((refs.deferredStreamAcks ?? 0) === 0) return;
  if (kind === 'ok' && mayDeferStreamAck(get(), refs)) return;
  flushDeferredStreamAcks(set, get, refs, safeWrite);
}

/** A stream-owned ok: held for its chunk when that is provably invisible,
 * otherwise applied now, after anything held before it. */
export function routeStreamAck(
  set: SetFn,
  get: GetFn,
  refs: BatchRefs,
  safeWrite: SafeWriteFn,
): void {
  if (mayDeferStreamAck(get(), refs)) {
    deferStreamAck(set, get, refs, safeWrite);
    return;
  }
  flushDeferredStreamAcks(set, get, refs, safeWrite);
  advanceStream(set, get, refs, safeWrite, 'ok');
}
