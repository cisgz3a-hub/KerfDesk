// Disconnect on the test clock. A controller without a realtime reset
// (Marlin, Smoothieware) makes Disconnect wait, up to
// DISCONNECT_CLEANUP_ACK_WAIT_MS, for its stop lines' acknowledgements before
// the port closes (audit TC-3). That wait runs on timers, so a test on fake
// timers advances them while it waits.

import { vi } from 'vitest';
import { DISCONNECT_CLEANUP_ACK_WAIT_MS } from './laser-disconnect-stop';
import { useLaserStore } from './laser-store';

type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/** Awaits a Disconnect or Forget, advancing fake timers past its bounded wait. */
export async function settleOnTestClock<T>(operation: Promise<T>): Promise<T> {
  // Observe a rejection at once, so one raised while the clock advances is
  // not reported as unhandled.
  const settled: Promise<Settled<T>> = operation.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(DISCONNECT_CLEANUP_ACK_WAIT_MS + 100);
  const outcome = await settled;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export async function disconnectOnTestClock(): Promise<void> {
  await settleOnTestClock(useLaserStore.getState().disconnect());
}
