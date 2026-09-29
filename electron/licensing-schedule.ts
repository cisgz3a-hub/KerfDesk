/** How often an open KerfDesk repeats its quiet licence check (ADR-523 Amendment 2). */
export const LICENCE_CHECK_INTERVAL_MS = 30 * 60_000;

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
