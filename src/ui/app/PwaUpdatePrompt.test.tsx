import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable test doubles, hoisted so the vi.mock factories below can close
// over them without a temporal-dead-zone error.
const h = vi.hoisted(() => ({
  swState: { offlineReady: false, needRefresh: false },
  setOfflineReady: vi.fn(),
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(),
  streamer: { status: null as string | null },
  pushToast: vi.fn(),
  registration: { addEventListener: vi.fn() },
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: {
    onRegisteredSW?: (swScriptUrl: string, registration: unknown) => void;
  }) => {
    // Mirror vite-plugin-pwa: invoke onRegisteredSW so the component can wire its
    // `updatefound` re-arm listener onto the (fake) registration.
    options?.onRegisteredSW?.('sw.js', h.registration);
    return {
      offlineReady: [h.swState.offlineReady, h.setOfflineReady],
      needRefresh: [h.swState.needRefresh, h.setNeedRefresh],
      updateServiceWorker: h.updateServiceWorker,
    };
  },
}));
vi.mock('../state/laser-store', () => ({
  useLaserStore: (sel: (s: { streamer: { status: string } | null }) => unknown) =>
    sel({ streamer: h.streamer.status === null ? null : { status: h.streamer.status } }),
}));
vi.mock('../state/toast-store', () => ({
  useToastStore: (sel: (s: { pushToast: typeof h.pushToast }) => unknown) =>
    sel({ pushToast: h.pushToast }),
}));

import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { loadDismissedUpdateVersion, saveDismissedUpdateVersion } from './pwa-update-dismissal';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BANNER = '[aria-label="App update available"]';

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PwaUpdatePrompt />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

beforeEach(() => {
  h.swState.offlineReady = false;
  h.swState.needRefresh = false;
  h.streamer.status = null;
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PwaUpdatePrompt', () => {
  it('shows a Reload banner when an update is waiting and the laser is idle', async () => {
    h.swState.needRefresh = true;
    const { host } = await render();
    expect(host.querySelector(BANNER)).not.toBeNull();
    expect(host.querySelector('button')?.textContent).toBe('Reload');
    // Public branding: the banner copy said "LaserForge" while the rest of
    // the chrome says KerfDesk.
    expect(host.textContent).toContain('KerfDesk');
    expect(host.textContent).not.toContain('LaserForge');
  });

  it('suppresses the banner while the laser is streaming', async () => {
    h.swState.needRefresh = true;
    h.streamer.status = 'streaming';
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('suppresses the banner while a job is paused', async () => {
    h.swState.needRefresh = true;
    h.streamer.status = 'paused';
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('suppresses the banner while the completed job is waiting for Idle cleanup', async () => {
    h.swState.needRefresh = true;
    h.streamer.status = 'done';
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('suppresses the banner while an errored job still needs operator handling', async () => {
    h.swState.needRefresh = true;
    h.streamer.status = 'errored';
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('reloads with the new service worker when Reload is clicked', async () => {
    h.swState.needRefresh = true;
    const { host } = await render();
    await act(async () => {
      host.querySelector('button')?.click();
    });
    expect(h.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('fires a one-time offline-ready toast', async () => {
    h.swState.offlineReady = true;
    await render();
    expect(h.pushToast).toHaveBeenCalledWith('Ready to work offline.', 'success');
    expect(h.setOfflineReady).toHaveBeenCalledWith(false);
  });

  it('renders nothing when there is no update', async () => {
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('does not re-nag when the same update was already dismissed with Later', async () => {
    // Regression: workbox-window re-fires `waiting` for an already-waiting SW on
    // every load, so a persisted dismissal (keyed to the running build version)
    // must keep the banner hidden for THIS update instead of nagging each reload.
    h.swState.needRefresh = true;
    saveDismissedUpdateVersion(__APP_VERSION__);
    const { host } = await render();
    expect(host.querySelector(BANNER)).toBeNull();
  });

  it('persists the running build version when Later is clicked', async () => {
    h.swState.needRefresh = true;
    const { host } = await render();
    const later = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Later',
    );
    await act(async () => {
      later?.click();
    });
    expect(loadDismissedUpdateVersion()).toBe(__APP_VERSION__);
    expect(h.setNeedRefresh).toHaveBeenCalledWith(false);
  });

  it('still shows the banner when a different (older) version was dismissed', async () => {
    // A strictly-newer build must not be swallowed by a stale dismissal marker.
    h.swState.needRefresh = true;
    saveDismissedUpdateVersion('0.0.0-previously-dismissed');
    const { host } = await render();
    expect(host.querySelector(BANNER)).not.toBeNull();
  });

  it('re-arms the banner when a newer service worker is found (updatefound)', async () => {
    h.swState.needRefresh = true;
    saveDismissedUpdateVersion(__APP_VERSION__);
    const first = await render();
    expect(first.host.querySelector(BANNER)).toBeNull();
    // A newer SW installing fires `updatefound` on the registration; the handler
    // must clear the dismissal so the genuinely-new version surfaces again.
    const call = h.registration.addEventListener.mock.calls.find((c) => c[0] === 'updatefound');
    const onUpdateFound = call ? call[1] : undefined;
    await act(async () => {
      if (typeof onUpdateFound === 'function') onUpdateFound();
    });
    expect(loadDismissedUpdateVersion()).toBeNull();
    const second = await render();
    expect(second.host.querySelector(BANNER)).not.toBeNull();
  });
});
