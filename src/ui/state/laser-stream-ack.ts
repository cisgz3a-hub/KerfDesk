// laser-stream-ack — routes terminal controller acks into the streamer.
// Split from laser-line-handler when the untracked-ack attribution pushed
// that file past the 400-line cap.

import { onAck, step, type StreamerState } from '../../core/controllers/grbl';
import { beginPostJobSettle } from './laser-post-job-settle';
import type { LaserState } from './laser-store';
import { hasUnsettledStreamAcks, toolChangeHoldEntryPatch } from './laser-store-helpers';
import type { AckSettlement, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { containActiveStreamWriteFailure } from './laser-stream-heartbeat-containment';
import { consumeUntrackedAck } from './laser-untracked-ack-ledger';

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
  if (hasUnsettledStreamAcks(state.streamer)) return { owner: 'stream' };
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
  const s: StreamerState | null = get().streamer;
  if (s === null) return;
  const acked = onAck(s, ack);
  const stepped = step(acked.state);
  set((state) => ({
    streamer: stepped.state,
    ...(stepped.state.status === 'errored' ? liveCanvasLifecyclePatch(state, 'errored') : {}),
  }));
  // Entering a tool-change hold means a new bit is going in: the previous bit's
  // work Z0 no longer holds, so the operator must re-Zero-Z for the new tool
  // (the setup gate allows it during the hold). Invalidate so the no-work-zero
  // advisory is honest again until they do (Codex audit P1).
  if (s.status !== 'tool-change' && stepped.state.status === 'tool-change') {
    // New bit going in: void the prior Z0, require a FRESH Idle before the setup
    // gate / Continue unlock, and consume the next tool label so the pause UI can
    // name the bit (R5). Shared with the Continue entry site (F22).
    set((state) => toolChangeHoldEntryPatch(state));
  }
  if (s.status !== 'done' && stepped.state.status === 'done') {
    beginPostJobSettle(set, get, refs, safeWrite);
  }
  if (stepped.toSend.length > 0) {
    // Refills are the job stream continuing: tag them so the console's
    // "hide job stream" filter keeps hiding them. No action — the catch
    // below owns the failure notice.
    void safeWrite(stepped.toSend, undefined, 'job').catch(() => {
      // The shared helper freezes from the current store snapshot, then owns
      // reset/quarantine. Acks or onClose can land between dispatch and
      // rejection, so it never rolls back or resurrects terminal ownership.
      containActiveStreamWriteFailure(set, refs, safeWrite, 'stream');
    });
  }
}
