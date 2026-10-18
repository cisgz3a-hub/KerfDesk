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
  it('admits once the renderer is sent Pro, and re-gates each opening renderer', () => {
    const signals = createStartupSignals(false);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    signals.observe({ edition: 'free' });
    signals.observe({ edition: 'pro' });
    signals.observe({ edition: 'pro' });
    // A reopened macOS window, or a reload, opens behind the window again.
    signals.admission.rendererOpening();
    signals.observe({ edition: 'free' });
    expect(seen).toEqual([false, true, false]);
  });

  it('always admits a build without licensing, as it has no licence window', () => {
    const signals = createStartupSignals(true);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    signals.admission.rendererOpening();
    signals.observe({ edition: 'free' });
    expect(seen).toEqual([true]);
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
