// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartupSignals } from './licensing-startup-signals';

async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  // A race, then its finally, then this callback: let every hop run.
  for (let hop = 0; hop < 5; hop += 1) await Promise.resolve();
  return done;
}

afterEach(() => vi.useRealTimers());

describe('startup signals for the licence window (ADR-623)', () => {
  it('admits once the renderer is sent Pro, never for an unlicensed status', async () => {
    const signals = createStartupSignals(false);
    signals.observe({ edition: 'free' });
    expect(await settled(signals.admitted)).toBe(false);
    signals.observe({ edition: 'pro' });
    expect(await settled(signals.admitted)).toBe(true);
  });

  it('admits a build without licensing at once, as it has no licence window', async () => {
    expect(await settled(createStartupSignals(true).admitted)).toBe(true);
  });

  it('waits for the first status sent, or the grace when none is', async () => {
    vi.useFakeTimers();
    const read = createStartupSignals(false);
    const afterRead = read.afterFirstStatusRead(10_000);
    expect(await settled(afterRead)).toBe(false);
    read.observe({ edition: 'free' });
    expect(await settled(afterRead)).toBe(true);
    const unread = createStartupSignals(false).afterFirstStatusRead(10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await settled(unread)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(unread)).toBe(true);
  });
});
