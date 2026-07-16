import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPromptedReload, type PromptedReloadHooks } from './pwa-prompted-reload';

// Live repro (2026-07-17, update-popup bug): on a page that is not
// service-worker-controlled (hard reload, first visit after clearing site
// data, DevTools bypass), a freshly installed update skips the waiting phase
// and activates silently, so the banner's Reload click posted SKIP_WAITING to
// an empty waiting slot and vite-plugin-pwa's `controlling`-event reload never
// fired — the button did literally nothing. These tests pin the replacement
// contract: a clicked Reload always ends in exactly one page reload.

class FakeServiceWorker extends EventTarget {
  state: ServiceWorkerState = 'installed';

  transition(next: ServiceWorkerState): void {
    this.state = next;
    this.dispatchEvent(new Event('statechange'));
  }
}

function makeHooks(overrides: Partial<PromptedReloadHooks>): {
  readonly hooks: PromptedReloadHooks;
  readonly reload: ReturnType<typeof vi.fn>;
  readonly requestSkipWaiting: ReturnType<typeof vi.fn>;
} {
  const reload = vi.fn();
  const requestSkipWaiting = vi.fn().mockResolvedValue(undefined);
  const hooks: PromptedReloadHooks = {
    getRegistration: () => Promise.resolve(undefined),
    requestSkipWaiting,
    reload,
    ...overrides,
  };
  return { hooks, reload, requestSkipWaiting };
}

/** Wraps a fake worker in the minimal registration shape the helper reads. */
function registrationWith(waiting: FakeServiceWorker | null): ServiceWorkerRegistration {
  // Cast: jsdom has no ServiceWorkerRegistration constructor; the helper only
  // touches `.waiting`, which the fake provides.
  return { waiting } as unknown as ServiceWorkerRegistration;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('applyPromptedReload', () => {
  it('plain-reloads immediately when no update is actually waiting (stale banner)', async () => {
    const { hooks, reload, requestSkipWaiting } = makeHooks({
      getRegistration: () => Promise.resolve(registrationWith(null)),
    });
    await applyPromptedReload(hooks);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(requestSkipWaiting).not.toHaveBeenCalled();
  });

  it('plain-reloads when service workers are unsupported (no registration)', async () => {
    const { hooks, reload } = makeHooks({});
    await applyPromptedReload(hooks);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('plain-reloads when the registration lookup fails', async () => {
    const { hooks, reload } = makeHooks({
      getRegistration: () => Promise.reject(new Error('boom')),
    });
    await applyPromptedReload(hooks);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('skip-waits the waiting worker, then reloads once it activates', async () => {
    const worker = new FakeServiceWorker();
    const { hooks, reload, requestSkipWaiting } = makeHooks({
      getRegistration: () => Promise.resolve(registrationWith(worker)),
    });
    await applyPromptedReload(hooks);
    expect(requestSkipWaiting).toHaveBeenCalledTimes(1);
    // Not yet activated: reloading now would let the OLD worker serve the old
    // precache to the fresh load.
    expect(reload).not.toHaveBeenCalled();
    worker.transition('activating');
    expect(reload).not.toHaveBeenCalled();
    worker.transition('activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the waiting worker goes redundant instead (replaced mid-click)', async () => {
    const worker = new FakeServiceWorker();
    const { hooks, reload } = makeHooks({
      getRegistration: () => Promise.resolve(registrationWith(worker)),
    });
    await applyPromptedReload(hooks);
    worker.transition('redundant');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads via the fallback timer when the waiting worker never reacts', async () => {
    vi.useFakeTimers();
    const worker = new FakeServiceWorker();
    const { hooks, reload } = makeHooks({
      getRegistration: () => Promise.resolve(registrationWith(worker)),
    });
    await applyPromptedReload(hooks);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once when activation and the fallback timer both fire', async () => {
    vi.useFakeTimers();
    const worker = new FakeServiceWorker();
    const { hooks, reload } = makeHooks({
      getRegistration: () => Promise.resolve(registrationWith(worker)),
    });
    await applyPromptedReload(hooks);
    worker.transition('activated');
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
