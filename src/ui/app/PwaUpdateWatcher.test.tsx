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
  pushToast: vi.fn(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [h.swState.offlineReady, h.setOfflineReady],
    needRefresh: [h.swState.needRefresh, h.setNeedRefresh],
    updateServiceWorker: h.updateServiceWorker,
  }),
}));
vi.mock('../state/toast-store', () => ({
  useToastStore: (sel: (s: { pushToast: typeof h.pushToast }) => unknown) =>
    sel({ pushToast: h.pushToast }),
}));
const promptedReload = vi.hoisted(() => ({ applyPromptedReload: vi.fn() }));
vi.mock('./pwa-prompted-reload', () => promptedReload);

import { usePwaUpdateStore } from '../state/pwa-update-store';
import { PwaUpdateWatcher } from './PwaUpdateWatcher';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PwaUpdateWatcher />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

beforeEach(() => {
  h.swState.offlineReady = false;
  h.swState.needRefresh = false;
  usePwaUpdateStore.setState({ availability: { kind: 'none' } });
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PwaUpdateWatcher', () => {
  it('publishes ready availability to the store when an update is waiting', async () => {
    h.swState.needRefresh = true;
    await render();
    expect(usePwaUpdateStore.getState().availability.kind).toBe('ready');
  });

  it('publishes none when there is no update', async () => {
    await render();
    expect(usePwaUpdateStore.getState().availability.kind).toBe('none');
  });

  it('renders no DOM even when an update is waiting — the popup is gone (ADR-227)', async () => {
    h.swState.needRefresh = true;
    const { host } = await render();
    expect(host.childElementCount).toBe(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('routes applyUpdate through the always-reload prompted-update path', async () => {
    // Regression (2026-07-17): the old click called updateServiceWorker(true)
    // alone, whose reload depends on a `controlling` event that never fires on
    // an uncontrolled page — the button silently did nothing. The staged apply
    // callback must go through applyPromptedReload, which guarantees a reload
    // in every state.
    h.swState.needRefresh = true;
    await render();
    const availability = usePwaUpdateStore.getState().availability;
    if (availability.kind !== 'ready') throw new Error('expected ready availability');
    await availability.applyUpdate();
    expect(promptedReload.applyPromptedReload).toHaveBeenCalledTimes(1);
    const hooks = promptedReload.applyPromptedReload.mock.calls[0]?.[0] as {
      requestSkipWaiting: () => Promise<void>;
    };
    // The wired skip-waiting hook must still delegate to the plugin's
    // updateServiceWorker so the SKIP_WAITING message path is unchanged.
    await hooks.requestSkipWaiting();
    expect(h.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('fires a one-time offline-ready toast', async () => {
    h.swState.offlineReady = true;
    await render();
    expect(h.pushToast).toHaveBeenCalledWith('Ready to work offline.', 'success');
    expect(h.setOfflineReady).toHaveBeenCalledWith(false);
  });

  it('clears availability back to none when mounted without an update', async () => {
    usePwaUpdateStore.setState({
      availability: { kind: 'ready', applyUpdate: () => Promise.resolve() },
    });
    await render();
    expect(usePwaUpdateStore.getState().availability.kind).toBe('none');
  });
});
