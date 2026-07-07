import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { installActiveJobWakeLock } from './use-active-job-wake-lock';

class FakeWakeLockSentinel extends EventTarget {
  released = false;

  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

function streamingState(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}

function patchStore(partial: Partial<LaserState>): void {
  useLaserStore.setState(partial as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function fakeNavigator(
  request: ReturnType<typeof vi.fn<(type: 'screen') => Promise<FakeWakeLockSentinel>>>,
): Navigator {
  return { ...navigator, wakeLock: { request } } as unknown as Navigator;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

afterEach(() => {
  patchStore({ streamer: null, log: [] });
  vi.restoreAllMocks();
});

function keepAwakeWarnings(): number {
  return useLaserStore.getState().log.filter((line) => line.includes('Keep-awake unavailable'))
    .length;
}

describe('installActiveJobWakeLock', () => {
  it('requests a screen wake lock when a job becomes active', async () => {
    const sentinel = new FakeWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    const uninstall = installActiveJobWakeLock({ document, navigator: fakeNavigator(request) });

    expect(request).not.toHaveBeenCalled();

    patchStore({ streamer: streamingState() });
    await flush();

    expect(request).toHaveBeenCalledWith('screen');
    uninstall();
  });

  it('releases the wake lock when the active job ends', async () => {
    const sentinel = new FakeWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    patchStore({ streamer: streamingState() });

    const uninstall = installActiveJobWakeLock({ document, navigator: fakeNavigator(request) });
    await flush();
    patchStore({ streamer: null });
    await flush();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('does nothing when the browser has no Screen Wake Lock API', async () => {
    const uninstall = installActiveJobWakeLock({ document, navigator });

    patchStore({ streamer: streamingState() });
    await flush();

    uninstall();
  });

  it('reacquires when the browser releases the lock during an active job', async () => {
    const sentinels = [new FakeWakeLockSentinel(), new FakeWakeLockSentinel()];
    const request = vi.fn(async () => sentinels.shift() ?? new FakeWakeLockSentinel());
    patchStore({ streamer: streamingState() });

    const uninstall = installActiveJobWakeLock({ document, navigator: fakeNavigator(request) });
    await flush();
    const first =
      request.mock.results[0]?.value === undefined ? null : await request.mock.results[0].value;
    first?.dispatchEvent(new Event('release'));
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    uninstall();
  });

  it('logs the keep-awake-unavailable warning once when the request is denied', async () => {
    const request = vi.fn<(type: 'screen') => Promise<FakeWakeLockSentinel>>(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const uninstall = installActiveJobWakeLock({ document, navigator: fakeNavigator(request) });

    patchStore({ streamer: streamingState() });
    await flush();
    expect(keepAwakeWarnings()).toBe(1);

    // A visibility flap retries the request but must not repeat the warning.
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(request.mock.calls.length).toBeGreaterThan(1);
    expect(keepAwakeWarnings()).toBe(1);
    uninstall();
  });

  it('logs the keep-awake-unavailable warning once when the API is missing', async () => {
    const uninstall = installActiveJobWakeLock({ document, navigator });

    patchStore({ streamer: streamingState() });
    await flush();

    expect(keepAwakeWarnings()).toBe(1);
    uninstall();
  });
});
