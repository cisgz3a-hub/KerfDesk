import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  KEEP_AWAKE_HIDDEN_MESSAGE,
  KEEP_AWAKE_HIDDEN_TOAST,
  KEEP_VISIBLE_TITLE_MARK,
} from './hidden-job-keep-awake-notice';
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

// Rolling audit v11 W9-P2-1 (ADR-117 Amendment 1). The fake models the W3C
// Screen Wake Lock spec: hiding the page releases the lock, and request()
// rejects with NotAllowedError while the page is hidden.
class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  title = 'KerfDesk — job.lf2';
  readonly live: FakeWakeLockSentinel[] = [];

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    if (state === 'hidden') for (const lock of this.live.splice(0)) void lock.release();
    this.dispatchEvent(new Event('visibilitychange'));
  }

  readonly request = vi.fn(async (_type: 'screen'): Promise<FakeWakeLockSentinel> => {
    if (this.visibilityState === 'hidden') throw new DOMException('hidden', 'NotAllowedError');
    const lock = new FakeWakeLockSentinel();
    this.live.push(lock);
    return lock;
  });
}

function installOn(page: FakePage): () => void {
  return installActiveJobWakeLock({
    document: page as unknown as Document,
    navigator: fakeNavigator(page.request),
  });
}

function hiddenNotices(): number {
  return useLaserStore.getState().log.filter((line) => line.includes(KEEP_AWAKE_HIDDEN_MESSAGE))
    .length;
}

function hiddenToasts(): number {
  return useToastStore.getState().toasts.filter((t) => t.message === KEEP_AWAKE_HIDDEN_TOAST)
    .length;
}

describe('a page hidden during a job (W9-P2-1)', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }));

  it('logs once, marks the title while hidden, and re-acquires the lock when visible', async () => {
    const page = new FakePage();
    patchStore({ streamer: streamingState() });
    const uninstall = installOn(page);
    await flush();
    expect(page.live).toHaveLength(1);

    page.setVisibility('hidden');
    await flush();
    expect(page.live).toHaveLength(0);
    expect(hiddenNotices()).toBe(1);
    expect(keepAwakeWarnings()).toBe(0);
    expect(page.title).toBe(`${KEEP_VISIBLE_TITLE_MARK}KerfDesk — job.lf2`);

    page.setVisibility('visible');
    await flush();
    expect(page.live).toHaveLength(1);
    expect(page.title).toBe('KerfDesk — job.lf2');
    expect(hiddenToasts()).toBe(1);

    // A second trip to the background in the same job: the title and the
    // toast come back, the log line does not repeat.
    page.setVisibility('hidden');
    await flush();
    expect(hiddenNotices()).toBe(1);
    expect(page.title.startsWith(KEEP_VISIBLE_TITLE_MARK)).toBe(true);
    page.setVisibility('visible');
    await flush();
    expect(page.live).toHaveLength(1);
    uninstall();
  });

  it('tells a job started while the page is already hidden, without asking for a lock', async () => {
    const page = new FakePage();
    page.visibilityState = 'hidden';
    const uninstall = installOn(page);

    patchStore({ streamer: streamingState() });
    await flush();

    expect(page.request).not.toHaveBeenCalled();
    expect(hiddenNotices()).toBe(1);
    expect(page.title.startsWith(KEEP_VISIBLE_TITLE_MARK)).toBe(true);
    uninstall();
    expect(page.title).toBe('KerfDesk — job.lf2');
  });

  it('unmarks the title when the job ends while hidden, and says nothing with no job', async () => {
    const page = new FakePage();
    patchStore({ streamer: streamingState() });
    const uninstall = installOn(page);
    await flush();
    page.setVisibility('hidden');
    await flush();

    patchStore({ streamer: null });
    await flush();
    expect(page.title).toBe('KerfDesk — job.lf2');

    page.setVisibility('visible');
    page.setVisibility('hidden');
    await flush();
    expect(hiddenNotices()).toBe(1);
    expect(hiddenToasts()).toBe(0);
    expect(page.title).toBe('KerfDesk — job.lf2');
    uninstall();
  });

  it('logs again for the next job', async () => {
    const page = new FakePage();
    patchStore({ streamer: streamingState() });
    const uninstall = installOn(page);
    await flush();
    page.setVisibility('hidden');
    patchStore({ streamer: null });
    page.setVisibility('visible');
    await flush();

    patchStore({ streamer: streamingState() });
    await flush();
    page.setVisibility('hidden');
    await flush();
    expect(hiddenNotices()).toBe(2);
    uninstall();
  });
});
