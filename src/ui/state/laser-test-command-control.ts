import { expect, vi } from 'vitest';
import { startTestLaserJob } from './laser-test-start-helpers';

/** Advance only through Start's owned control boundary. Leave subsequent
 * program acknowledgements and physical settlement to each simulator test. */
export async function startTestLaserJobOnClock(
  gcode: string,
  options: Parameters<typeof startTestLaserJob>[1] = {},
): Promise<void> {
  let settled = false;
  const starting = startTestLaserJob(gcode, options).finally(() => {
    settled = true;
  });
  // Observe any refusal before advancing the fake controller clock.
  const outcome = starting.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  for (let tick = 0; tick < 200 && !settled; tick += 1) await vi.advanceTimersByTimeAsync(1);
  expect(settled, 'The simulator did not complete Start within its owned boundary.').toBe(true);
  const result = await outcome;
  if (!result.ok) throw result.error;
}

export function deferredTestWrite(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export function observeTestWriteOutcome(promise: Promise<void>): {
  readonly outcome: () => 'pending' | 'resolved' | 'rejected';
  readonly error: () => unknown;
} {
  let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
  let error: unknown = null;
  void promise.then(
    () => {
      outcome = 'resolved';
    },
    (reason: unknown) => {
      outcome = 'rejected';
      error = reason;
    },
  );
  return { outcome: () => outcome, error: () => error };
}
