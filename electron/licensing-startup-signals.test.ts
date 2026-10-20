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
  it('admits only after the mounted renderer acknowledges, and re-gates services each opening', () => {
    const signals = createStartupSignals(false);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    signals.observeRequest()({ edition: 'free' });
    const generation = signals.observeRequest()({ edition: 'pro' });
    expect(seen).toEqual([false]);
    expect(signals.sessionAdmitted()).toBe(false);
    signals.admitWorkspace(generation!);
    signals.observeRequest()({ edition: 'pro' });
    // Services such as the camera run only behind a mounted workspace, so a
    // reopened macOS window or a reload holds them until its renderer acknowledges
    // (the camera once ran on behind a fresh renderer). The session itself stays
    // let in, so that renderer opens to its workspace, not the licence window,
    // even with a free status: a crash reload must reach job recovery
    // (ADR-623 Amendment 1).
    signals.admission.rendererOpening();
    const reloaded = signals.observeRequest()({ edition: 'free' });
    expect(seen).toEqual([false, true, false]);
    expect(signals.sessionAdmitted()).toBe(true);
    signals.admitWorkspace(reloaded!);
    expect(seen).toEqual([false, true, false, true]);
  });

  it('keeps the session admitted across a renderer crash, but not into a new launch', () => {
    const signals = createStartupSignals(false);
    signals.admitWorkspace(signals.observeRequest()({ edition: 'pro' })!);
    signals.admission.rendererGone();
    signals.admission.rendererOpening();
    expect(signals.sessionAdmitted()).toBe(true);
    expect(createStartupSignals(false).sessionAdmitted()).toBe(false);
  });

  it('never latches the session on an acknowledgement its window could not have given', () => {
    // The licence window admits only on a Pro status; an acknowledgement after
    // nothing but Free must not let a later reload past the window.
    const signals = createStartupSignals(false);
    signals.admitWorkspace(signals.observeRequest()({ edition: 'free' })!);
    signals.admission.rendererOpening();
    expect(signals.sessionAdmitted()).toBe(false);
  });

  it('ignores a Pro reply to a renderer that reloaded before it arrived', () => {
    const signals = createStartupSignals(false);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    const staleRequest = signals.observeRequest();
    signals.admission.rendererOpening();
    staleRequest({ edition: 'pro' });
    signals.admitWorkspace(0);
    expect(seen).toEqual([false]);
    expect(signals.sessionAdmitted()).toBe(false);
    signals.admitWorkspace(signals.observeRequest()({ edition: 'pro' })!);
    expect(seen).toEqual([false, true]);
  });

  it('clears admission, and so the camera, when the renderer process dies', () => {
    const signals = createStartupSignals(false);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    const inFlight = signals.observeRequest();
    signals.admitWorkspace(signals.observeRequest()({ edition: 'pro' })!);
    signals.admission.rendererGone();
    // A reply to the dead renderer cannot restart anything.
    inFlight({ edition: 'pro' });
    expect(seen).toEqual([false, true, false]);
  });

  it('always admits a build without licensing, as it has no licence window', () => {
    const signals = createStartupSignals(true);
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    signals.admission.rendererOpening();
    signals.observeRequest()({ edition: 'free' });
    expect(seen).toEqual([true]);
  });

  it('waits for the first status sent, or the grace when none is', async () => {
    vi.useFakeTimers();
    const read = createStartupSignals(false);
    const afterRead = read.afterFirstStatusRead(10_000);
    expect(await settled(afterRead)).toBe(false);
    read.observeRequest()({ edition: 'free' });
    expect(await settled(afterRead)).toBe(true);
    const unread = createStartupSignals(false).afterFirstStatusRead(10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await settled(unread)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(unread)).toBe(true);
  });
});
