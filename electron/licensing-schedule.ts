import { CLOCK_TOLERANCE } from './licensing-clock.js';

/** How often an open KerfDesk repeats its quiet licence check (ADR-523 Amendment 2). */
export const LICENCE_CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Whether a quiet check should ask the licence service now. A trial is
 * confirmed about daily, so its three-day check-in rarely shows; paid and
 * developer rights about weekly, the cadence the privacy notice states. A paid
 * licence needs no confirmation to keep working (ADR-623 Amendment 2), so the
 * weekly ask only bounds how soon a refund reaches a connected computer. An
 * overdue trial asks at once (ADR-592). So does a device whose clock is now
 * earlier than it was last seen, because winding the clock back must not put
 * off the next confirmation, which is how a refund reaches it. A failed
 * attempt saves nothing, so an offline device tries again at each check.
 */
export function licenceRefreshDue(
  current: { readonly state: string; readonly tier: string | null },
  saved: { readonly refreshedAt?: number; readonly lastSeenAt: number },
  now: number,
): boolean {
  if (current.state === 'checkin-required') return true;
  if (!['ready', 'updates-expired', 'clock-error'].includes(current.state)) return false;
  const interval = current.tier === 'trial' ? 86_400 : 7 * 86_400;
  const refreshedAt = saved.refreshedAt ?? 0;
  return (
    now - refreshedAt >= interval || now + CLOCK_TOLERANCE < Math.max(refreshedAt, saved.lastSeenAt)
  );
}

export type RepeatingTimer = {
  /** Lets the process exit while the timer is still set. */
  readonly unref: () => void;
  readonly clear: () => void;
};
export type StartTimer = (run: () => void, ms: number) => RepeatingTimer;

const nodeTimer: StartTimer = (run, ms) => {
  const handle = setInterval(run, ms);
  return { unref: () => handle.unref(), clear: () => clearInterval(handle) };
};

/**
 * Repeats `check` every 30 minutes while KerfDesk runs, so a long session still
 * gets its weekly licence confirmation and a clock mark keeps moving.
 * The timer never keeps KerfDesk from quitting, a slow check is never started
 * twice, and the returned function stops it.
 */
export function scheduleLicenceChecks(
  check: () => Promise<unknown>,
  start: StartTimer = nodeTimer,
): () => void {
  let running = false;
  const timer = start(() => {
    if (running) return;
    running = true;
    void check()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, LICENCE_CHECK_INTERVAL_MS);
  timer.unref();
  return timer.clear;
}
