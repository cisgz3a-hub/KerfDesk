/**
 * T1-29: persisted unsafe-prior-state flag across reconnects.
 *
 * Set by `MachineService.startValidatedJob` at the moment a job begins —
 * the flag is the source of truth for "we attempted to start a job; if
 * you see this on next launch, something went wrong." Cleared on the
 * three clean-shutdown paths:
 *
 *   1. Job completion (any terminal status — completed / stopped / failed).
 *   2. `MachineService.disconnect()` — user-initiated disconnect. The
 *      service runs M5 S0 + controller disconnect first, so by the time
 *      the flag is cleared, the laser is off and the controller is
 *      released cleanly.
 *   3. Recovery acknowledgement on app startup — the user has been
 *      shown the recovery dialog and explicitly confirmed inspection.
 *
 * Read by `App.tsx` at startup. A non-null payload triggers the
 * recovery dialog before any normal connect flow can run. T1-25's
 * connect-time `getUnsafeAtConnect()` covers the case where firmware
 * still reports a non-safe state at the next connect; T1-29 covers
 * the orthogonal case where firmware finished the buffered job
 * cleanly during the dead window and reports clean idle, but the
 * user lost their session in the middle of a burn — the workpiece
 * may be partially burnt and the head may be in a dangerous position.
 *
 * Storage: `localStorage` directly (not the pluggable storage adapter).
 * Reason: the recovery flag must be readable BEFORE any service
 * initialization, ideally without async overhead. localStorage is
 * synchronous and available on every renderer.
 */

const UNSAFE_PRIOR_STATE_KEY = 'laserforge_unsafe_prior_state';

export type UnsafePriorStateKind = 'job-running';

export interface UnsafePriorState {
  kind: UnsafePriorStateKind;
  ticketId: string | null;
  startedAt: number;
}

/**
 * Persist the flag. Called from {@link MachineService.startValidatedJob}
 * at job-begin time. `localStorage.setItem` is synchronous so the write
 * is durable before the function returns; if the browser kills the
 * renderer mid-burn, the flag is already on disk.
 *
 * Storage failures (quota / private-mode / unsupported environment) are
 * swallowed — the safety contract degrades gracefully if storage
 * doesn't work, but T1-29 can't help in that environment. The console
 * log marks it for support diagnosis.
 */
export function setUnsafePriorState(state: UnsafePriorState): void {
  try {
    localStorage.setItem(UNSAFE_PRIOR_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[T1-29] Failed to persist unsafe-prior-state flag', err);
  }
}

/**
 * Read the flag. Returns null when no flag is present, when the flag
 * shape is malformed, or when storage is unavailable. Called once at
 * app startup by App.tsx; any non-null result triggers the recovery
 * dialog.
 */
export function getUnsafePriorState(): UnsafePriorState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(UNSAFE_PRIOR_STATE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UnsafePriorState>;
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      parsed.kind === 'job-running' &&
      typeof parsed.startedAt === 'number'
    ) {
      return {
        kind: 'job-running',
        ticketId: typeof parsed.ticketId === 'string' ? parsed.ticketId : null,
        startedAt: parsed.startedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear the flag. Called on every clean-shutdown path (job complete,
 * service disconnect, user acknowledged recovery).
 */
export function clearUnsafePriorState(): void {
  try {
    localStorage.removeItem(UNSAFE_PRIOR_STATE_KEY);
  } catch {
    /* ignore — same degradation as setUnsafePriorState */
  }
}

/** Exposed for tests. Production code MUST use the helpers above. */
export const UNSAFE_PRIOR_STATE_KEY_FOR_TESTS = UNSAFE_PRIOR_STATE_KEY;
