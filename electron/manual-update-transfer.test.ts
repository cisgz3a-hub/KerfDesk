// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { manualDownloadDeadline } from './manual-update-transfer.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('still ends a slow trickle at ten minutes even though every chunk arrives within the idle budget', async () => {
  const deadline = manualDownloadDeadline();
  try {
    for (let index = 0; index < 11; index += 1) {
      const chunk = deadline.wait(
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('bytes'), 50_000);
        }),
      );
      await vi.advanceTimersByTimeAsync(50_000);
      await expect(chunk).resolves.toBe('bytes');
      expect(deadline.signal.aborted).toBe(false);
    }
    const last = deadline
      .wait(
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('too late'), 50_000);
        }),
      )
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await last).toMatchObject({ message: 'The update download exceeded ten minutes.' });
    expect(deadline.signal.aborted).toBe(true);
  } finally {
    deadline.dispose();
  }
});

it('bounds unanswered headers and can retire all timers after an earlier transport failure', async () => {
  const deadline = manualDownloadDeadline();
  const stalled = deadline
    .wait(new Promise<never>(() => undefined))
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await stalled).toMatchObject({ message: 'The update download stopped responding.' });
  deadline.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
