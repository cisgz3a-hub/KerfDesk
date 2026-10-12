/** How often an open KerfDesk repeats its quiet licence check (ADR-523 Amendment 2). */
export const LICENCE_CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Whether a quiet check should ask the licence service now. Paid rights are
 * confirmed about weekly and a trial daily, so its three-day check-in rarely
 * shows; an overdue device asks at once (ADR-592).
 */
export function licenceRefreshDue(
  current: { readonly state: string; readonly tier: string | null },
  refreshedAt: number | undefined,
  now: number,
): boolean {
  if (current.state === 'checkin-required') return true;
  const interval = current.tier === 'trial' ? 86_400 : 7 * 86_400;
  return (
    ['ready', 'updates-expired', 'clock-error'].includes(current.state) &&
    now - (refreshedAt ?? 0) >= interval
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
 * gets its weekly licence confirmation and a trial's clock mark keeps moving.
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
