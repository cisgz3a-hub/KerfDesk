// laser-stream-ack — routes terminal controller acks into the streamer.
// Split from laser-line-handler when the untracked-ack attribution pushed
// that file past the 400-line cap.

import { markErrored, onAck, step, type StreamerState } from '../../core/controllers/grbl';
import { beginPostJobSettle } from './laser-post-job-settle';
import { writeFailedNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { hasUnsettledStreamAcks } from './laser-store-helpers';
import type { AckOwner, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';

// Every queued non-job write owes exactly one terminal ok/error, in strict
// receive order. Settle the pending counter for this line — whichever
// consumer ends up handling it — so startJob can gate on the drain. When the
// streamer has no acks outstanding, a pending untracked write owns this ack
// outright and it must not reach advanceStream: a stale ok fed to a fresh
// job stream frees RX budget GRBL has not freed (phantom refill past the
// real buffer).
export function settleUntrackedAck(set: SetFn, state: LaserState, clsKind: string): AckOwner {
  const isTerminalAck = clsKind === 'ok' || clsKind === 'error';
  if (!isTerminalAck || state.pendingUntrackedAcks === 0) return 'stream';
  set((s) => ({ pendingUntrackedAcks: Math.max(0, s.pendingUntrackedAcks - 1) }));
  return hasUnsettledStreamAcks(state.streamer) ? 'stream' : 'untracked';
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
  set({ streamer: stepped.state });
  if (s.status !== 'done' && stepped.state.status === 'done') {
    beginPostJobSettle(set, get, refs, safeWrite);
  }
  if (stepped.toSend.length > 0) {
    // Refills are the job stream continuing: tag them so the console's
    // "hide job stream" filter keeps hiding them. No action — the catch
    // below owns the failure notice.
    void safeWrite(stepped.toSend, undefined, 'job').catch(() => {
      // markErrored, not disconnect: 'disconnected' falls outside
      // isActiveJob, which unmounts the Stop button and drops the
      // soft-reset stop command while GRBL may still be executing
      // buffered lines on a live port (same R-H2 rationale as
      // runResumeJob). A genuine port loss follows up via onClose, which
      // owns the disconnect wording. Functional set: acks can land
      // between dispatch and rejection, so no snapshot rollback.
      set((current) => ({
        streamer: current.streamer === null ? current.streamer : markErrored(current.streamer),
        safetyNotice: writeFailedNotice('stream'),
      }));
    });
  }
}
