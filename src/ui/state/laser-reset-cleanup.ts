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

import type { ControllerDriver } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserControllerOperation } from './laser-controller-operation';

export const RESET_CLEANUP_BANNER_TIMEOUT_MS = 500;

type PendingResetCleanup = {
  readonly lines: ReadonlyArray<string>;
  readonly timer: ReturnType<typeof setTimeout> | null;
  readonly options: ResetCleanupOptions;
  readonly write: CleanupWriteFn | null;
};

export type ResetCleanupOptions = {
  readonly requireResetBoundary?: boolean;
  readonly onResetBoundary?: () => void;
  readonly onComplete?: (error: unknown | null) => void;
  readonly onCancel?: () => void;
};

export type ResetCleanupRefs = {
  pendingResetCleanup: PendingResetCleanup | null;
  /** Also retires cleanup already flushing when its pending timer is gone. */
  resetCleanupGeneration?: number;
};

type CleanupWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

export function hasOwnedControllerReset(operation: LaserControllerOperation | null): boolean {
  return operation?.kind === 'recovery' && operation.phase === 'reset';
}

export function hasUnconfirmedResetCleanup(
  refs: ResetCleanupRefs,
  operation: LaserControllerOperation | null,
): boolean {
  return (
    refs.pendingResetCleanup?.options.requireResetBoundary === true &&
    hasOwnedControllerReset(operation)
  );
}

/** Cleanup after a controller reset must explicitly include spindle/laser off.
 * Stock GRBL profiles may expose only M9 as their ordinary stopLaserLines. */
export function resetCleanupLines(driver: ControllerDriver): ReadonlyArray<string> {
  const lines = driver.commands.stopLaserLines;
  return lines.some((line) => line.trim().toUpperCase() === 'M5') ? lines : ['M5', ...lines];
}

/** Arm the cleanup lines to be flushed on the next welcome banner (or after
 *  the fallback timeout). Re-arming replaces any previously armed lines. */
export function armResetCleanup(
  refs: ResetCleanupRefs,
  safeWrite: CleanupWriteFn,
  lines: ReadonlyArray<string>,
  options: ResetCleanupOptions = {},
): void {
  cancelResetCleanup(refs);
  if (lines.length === 0) return;
  const timer = options.requireResetBoundary
    ? null
    : setTimeout(() => {
        flushResetCleanup(refs, safeWrite);
      }, RESET_CLEANUP_BANNER_TIMEOUT_MS);
  refs.pendingResetCleanup = {
    lines,
    timer,
    options,
    write: options.requireResetBoundary ? safeWrite : null,
  };
}

/** Best-effort cleanup reports failure to its owner without throwing into the
 * line pipeline. Transport acceptance does not prove physical beam-off. */
export function flushResetCleanup(
  refs: ResetCleanupRefs,
  safeWrite: CleanupWriteFn,
  cause: 'reset-boundary' | 'fallback' = 'fallback',
): void {
  const pending = refs.pendingResetCleanup;
  if (pending === null) return;
  if (cause === 'reset-boundary') pending.options.onResetBoundary?.();
  if (pending.timer !== null) clearTimeout(pending.timer);
  refs.pendingResetCleanup = null;
  const generation = refs.resetCleanupGeneration;
  void (async () => {
    for (const line of pending.lines) {
      if (refs.resetCleanupGeneration !== generation) return;
      await (pending.write ?? safeWrite)(`${line}\n`, 'stop');
    }
  })()
    .then(
      () => {
        if (refs.resetCleanupGeneration !== generation) pending.options.onCancel?.();
        else pending.options.onComplete?.(null);
      },
      (error: unknown) => pending.options.onComplete?.(error),
    )
    .catch(() => undefined);
}

/** Drop armed cleanup without writing (port teardown). */
export function cancelResetCleanup(refs: ResetCleanupRefs): void {
  refs.resetCleanupGeneration = (refs.resetCleanupGeneration ?? 0) + 1;
  const pending = refs.pendingResetCleanup;
  if (pending === null) return;
  if (pending.timer !== null) clearTimeout(pending.timer);
  refs.pendingResetCleanup = null;
  pending.options.onCancel?.();
}
