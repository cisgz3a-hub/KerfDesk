// laser-reset-cleanup — beam-off cleanup lines owed after a COMMANDED soft
// reset (Stop, auto-stop after a stream error). A soft reset wipes the
// controller's RX buffer and reboots it, so cleanup written immediately races
// the boot two ways (audit F2):
//   - a byte landing mid-init can be swallowed — its ack never arrives and
//     the untracked-ack counter would stay stuck, blocking Start;
//   - a byte that survives is acked AFTER the welcome banner has already
//     reset the untracked ledger — an orphaned ok that can phantom-advance
//     the next job's stream.
// Deferring the write until the banner arrives makes the cleanup acks
// unambiguous: banner → ledger reset → cleanup written → ack settles. A
// fallback timer still flushes if no banner ever arrives (dead link), which
// is exactly as best-effort as the old inline writes were.

import type { LaserSafetyAction } from './laser-safety-notice';

export const RESET_CLEANUP_BANNER_TIMEOUT_MS = 500;

type PendingResetCleanup = {
  readonly lines: ReadonlyArray<string>;
  readonly timer: ReturnType<typeof setTimeout>;
};

export type ResetCleanupRefs = {
  pendingResetCleanup: PendingResetCleanup | null;
};

type CleanupWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

/** Arm the cleanup lines to be flushed on the next welcome banner (or after
 *  the fallback timeout). Re-arming replaces any previously armed lines. */
export function armResetCleanup(
  refs: ResetCleanupRefs,
  safeWrite: CleanupWriteFn,
  lines: ReadonlyArray<string>,
): void {
  cancelResetCleanup(refs);
  if (lines.length === 0) return;
  const timer = setTimeout(() => {
    flushResetCleanup(refs, safeWrite);
  }, RESET_CLEANUP_BANNER_TIMEOUT_MS);
  refs.pendingResetCleanup = { lines, timer };
}

/** Write the armed cleanup lines now (banner arrived, or fallback fired).
 *  Best effort: a failed write must not throw into the line pipeline — the
 *  reset itself already de-energized laser and coolant on the controller. */
export function flushResetCleanup(refs: ResetCleanupRefs, safeWrite: CleanupWriteFn): void {
  const pending = refs.pendingResetCleanup;
  if (pending === null) return;
  clearTimeout(pending.timer);
  refs.pendingResetCleanup = null;
  void (async () => {
    for (const line of pending.lines) {
      await safeWrite(`${line}\n`, 'stop');
    }
  })().catch(() => undefined);
}

/** Drop armed cleanup without writing (port teardown). */
export function cancelResetCleanup(refs: ResetCleanupRefs): void {
  const pending = refs.pendingResetCleanup;
  if (pending === null) return;
  clearTimeout(pending.timer);
  refs.pendingResetCleanup = null;
}
