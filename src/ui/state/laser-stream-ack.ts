// laser-stream-ack — routes terminal controller acks into the streamer.
// Split from laser-line-handler when the untracked-ack attribution pushed
// that file past the 400-line cap.

import {
  onAck,
  pause as pauseStreamer,
  step,
  type StreamerState,
} from '../../core/controllers/grbl';
import { beginPostJobSettle } from './laser-post-job-settle';
import type { LaserState } from './laser-store';
import { hasUnsettledStreamAcks, streamerCanPauseForMpg } from './laser-store-helpers';
import { steppedStreamerPatch } from './tool-change-hold-entry';
import type { AckSettlement, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import {
  containActiveStreamWriteFailure,
  streamWriteOwner,
} from './laser-stream-heartbeat-containment';
import { consumeUntrackedAck } from './laser-untracked-ack-ledger';
import { hostedRefillArmed, releaseHostedRefill } from './laser-hosted-refill';

// Every queued non-job write owes exactly one terminal ok/error, in strict
// receive order. While the streamer still has unsettled acks, the earliest
// terminal ack belongs to the stream (job lines hit the wire before any
// stop-cleanup write), so the untracked ledger must NOT settle on it — one
// physical ok settling both ledgers made the counter reach zero while a
// real untracked ack was still in flight, so Start's arming gate opened one
// ack early and the stale ok phantom-advanced the next job (audit F1). Only
// an ack the stream cannot own settles the counter; it must then not reach
// advanceStream either — a stale ok fed to a fresh job stream frees RX
// budget GRBL has not freed (phantom refill past the real buffer).
/**
 * Whether the next terminal ok/error on the wire belongs to the job stream.
 * Pure mirror of the ownership branch in `settleUntrackedAck` below, for the
 * callers that must know BEFORE the ledger settles — the transcript tags and
 * buffers a stream-owned acknowledgement rather than publishing it per line
 * (ADR-333). `laser-stream-ack.test.ts` pins the two against each other over a
 * state matrix so they cannot drift.
 */
export function streamOwnsTerminalAck(
  state: Pick<LaserState, 'streamer' | 'pendingUntrackedAcks'>,
): boolean {
  if (state.streamer?.status === 'disconnected') return false;
  if (state.pendingUntrackedAcks === 0) return true;
  return streamAwaitsTerminalAck(state.streamer);
}

// A paused stream whose lines were all answered is owed nothing: the next
// terminal ack belongs to a line written after the pause, such as the beam-off
// a Marlin Pause queues behind the buffered motion (MA-1). Left to the stream,
// that ack settled nothing and the untracked ledger owed it forever.
function streamAwaitsTerminalAck(streamer: StreamerState | null): boolean {
  if (streamer?.status === 'paused' && streamer.inFlight.length === 0) return false;
  return hasUnsettledStreamAcks(streamer);
}

export function settleUntrackedAck(
  set: SetFn,
  state: LaserState,
  clsKind: string,
  refs: HandlerRefs,
): AckSettlement {
  const isTerminalAck = clsKind === 'ok' || clsKind === 'error';
  if (!isTerminalAck) return { owner: 'stream' };
  // The disconnected stream is retained only as recovery evidence. Replies on
  // a replacement serial session must never advance its unconfirmed lines.
  // When a reconnect command owns an ack, settle that ledger; otherwise treat
  // a late terminal response as non-stream traffic and drop it here.
  if (state.streamer?.status === 'disconnected') {
    if (state.pendingUntrackedAcks > 0) {
      const motionOperationId = consumeUntrackedAck(refs);
      set((s) => ({ pendingUntrackedAcks: Math.max(0, s.pendingUntrackedAcks - 1) }));
      return { owner: 'untracked', motionOperationId };
    }
    return { owner: 'untracked', motionOperationId: null };
  }
  if (state.pendingUntrackedAcks === 0) return { owner: 'stream' };
  if (streamAwaitsTerminalAck(state.streamer)) return { owner: 'stream' };
  const motionOperationId = consumeUntrackedAck(refs);
  set((s) => ({ pendingUntrackedAcks: Math.max(0, s.pendingUntrackedAcks - 1) }));
  return { owner: 'untracked', motionOperationId };
}

export function advanceStream(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  ack: 'ok' | 'error' | 'alarm',
): void {
  advanceStreamBy(set, get, refs, safeWrite, ack, 1);
}

/**
 * Applies up to `count` consecutive acknowledgements of one kind exactly as that
 * many advanceStream calls would, with one store write and one refill write.
 * The pure onAck/step sequence is the same; it stops after the first ack that
 * changes the stream's status, so every transition keeps its side effects in
 * order. Returns how many it applied (ADR-352).
 */
export function advanceStreamBy(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  ack: 'ok' | 'error' | 'alarm',
  count: number,
): number {
  const s: StreamerState | null = get().streamer;
  if (s === null) return count;
  const writeOwner = streamWriteOwner(get());
  const stepped = stepAcks(s, ack, count, get().mpgActive === true);
  const finishedStreaming = s.status !== 'done' && stepped.state.status === 'done';
  // An ack refill that reaches an M0 enters the tool-change hold: the shared
  // patch voids the previous bit's Z0, re-arms the fresh-Idle latch and names
  // the incoming bit in the same update (ADR-171, Codex audit P1, R5).
  // stepAcks stops at the first status change, so comparing with the streamer
  // the batch started from detects exactly the step that entered the hold.
  set((state) => ({
    ...steppedStreamerPatch(state, s, stepped.state),
    ...(stepped.state.status === 'errored' ? liveCanvasLifecyclePatch(state, 'errored') : {}),
  }));
  if (finishedStreaming) {
    beginPostJobSettle(set, get, refs, safeWrite);
  }
  // While the worker owns the refill it has already written these bytes from
  // the same pure step on the same line, so writing them here would duplicate
  // them (ADR-334). Handing back happens the moment the status leaves
  // 'streaming', because every status change is this side's decision.
  if (hostedRefillArmed(refs) && stepped.state.status !== 'streaming') {
    void releaseHostedRefill(refs);
  } else if (stepped.toSend.length > 0 && !hostedRefillArmed(refs)) {
    // Refills are the job stream continuing: tag them so the console's
    // "hide job stream" filter keeps hiding them. No action — the catch
    // below owns the failure notice.
    void safeWrite(stepped.toSend, undefined, 'job').catch(() => {
      // The shared helper freezes from the current store snapshot, then owns
      // reset/quarantine. Acks or onClose can land between dispatch and
      // rejection, so it never rolls back or resurrects terminal ownership.
      containActiveStreamWriteFailure(set, refs, safeWrite, 'stream', writeOwner);
    });
  }
  return stepped.applied;
}

// The same pure onAck -> step pair advanceStream ran per acknowledgement,
// repeated until one of them changes the stream's status. The refill bytes of
// every step are concatenated in order, so the controller receives exactly the
// bytes the per-ack path would have written, in one write.
function stepAcks(
  initial: StreamerState,
  ack: 'ok' | 'error' | 'alarm',
  count: number,
  mpgActive: boolean,
): { readonly state: StreamerState; readonly toSend: string; readonly applied: number } {
  let state = initial;
  let toSend = '';
  let applied = 0;
  while (applied < count) {
    const acked = onAck(state, ack);
    const stepped = step(
      mpgActive && streamerCanPauseForMpg(acked.state) ? pauseStreamer(acked.state) : acked.state,
    );
    state = stepped.state;
    toSend += stepped.toSend;
    applied += 1;
    if (state.status !== initial.status) break;
  }
  return { state, toSend, applied };
}
