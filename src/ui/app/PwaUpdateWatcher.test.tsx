import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'virtual:pwa-register/react';

// Controllable test doubles, hoisted so the vi.mock factories below can close
// over them without a temporal-dead-zone error.
const h = vi.hoisted(() => ({
  swState: { offlineReady: false, needRefresh: false },
  setOfflineReady: vi.fn(),
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(),
  pushToast: vi.fn(),
  registerOptions: null as RegisterSWOptions | null,
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    h.registerOptions = options;
    return {
      offlineReady: [h.swState.offlineReady, h.setOfflineReady],
      needRefresh: [h.swState.needRefresh, h.setNeedRefresh],
      updateServiceWorker: h.updateServiceWorker,
    };
  },
}));
vi.mock('../state/toast-store', () => ({
  useToastStore: (sel: (s: { pushToast: typeof h.pushToast }) => unknown) =>
    sel({ pushToast: h.pushToast }),
}));
const promptedReload = vi.hoisted(() => ({ applyPromptedReload: vi.fn() }));
vi.mock('./pwa-prompted-reload', () => promptedReload);

import { usePwaUpdateStore } from '../state/pwa-update-store';
import { PwaUpdateWatcher, UPDATED_IN_ANOTHER_WINDOW_MESSAGE } from './PwaUpdateWatcher';

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
  roots.push(root);
  return { host, root };
}

const roots: Root[] = [];
const originalLocation = window.location;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.swState.offlineReady = false;
  h.swState.needRefresh = false;
  h.registerOptions = null;
  usePwaUpdateStore.setState({ availability: { kind: 'none' } });
  vi.clearAllMocks();
  promptedReload.applyPromptedReload.mockResolvedValue(undefined);
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, href: originalLocation.href, reload },
  });
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

function needReload(): void {
  const onNeedReload = h.registerOptions?.onNeedReload;
  if (onNeedReload === undefined) throw new Error('onNeedReload was not passed to useRegisterSW');
  act(() => onNeedReload());
}

function register(update: () => Promise<unknown>): void {
  const callback = h.registerOptions?.onRegisteredSW;
  if (callback === undefined) throw new Error('Missing registration callback');
  act(() => callback('/sw.js', { update } as ServiceWorkerRegistration));
}

describe('PwaUpdateWatcher', () => {
  it('discovers updates every 30 minutes without applying or reloading them', async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    await render();
    register(update);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1));
    expect(update).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(update).toHaveBeenCalledTimes(2);
    expect(h.updateServiceWorker).not.toHaveBeenCalled();
    expect(promptedReload.applyPromptedReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('replaces discovery timers and ignores registration after unmount', async () => {
    vi.useFakeTimers();
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const { root } = await render();
    register(first);
    register(second);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    register(first);
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('quietly skips offline checks, retries failures and avoids overlapping checks', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: false });
    const update = vi.fn().mockRejectedValueOnce(new Error('offline'));
    let finish!: () => void;
    update.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await render();
    register(update);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(update).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(update).toHaveBeenCalledTimes(3);
    expect(h.pushToast).not.toHaveBeenCalled();
  });

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

  it('coalesces rapid Update clicks into one prompted reload owner', async () => {
    h.swState.needRefresh = true;
    let resolveReload!: () => void;
    promptedReload.applyPromptedReload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        }),
    );
    await render();
    const availability = usePwaUpdateStore.getState().availability;
    if (availability.kind !== 'ready') throw new Error('expected ready availability');

    const first = availability.applyUpdate();
    const second = availability.applyUpdate();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(promptedReload.applyPromptedReload).toHaveBeenCalledTimes(1));
    resolveReload();
    await first;
  });

  it('reports a failed update once and allows the visible action to retry', async () => {
    h.swState.needRefresh = true;
    promptedReload.applyPromptedReload
      .mockRejectedValueOnce(new Error('update failed'))
      .mockResolvedValueOnce(undefined);
    await render();
    const availability = usePwaUpdateStore.getState().availability;
    if (availability.kind !== 'ready') throw new Error('expected ready availability');

    await availability.applyUpdate();
    expect(h.pushToast).toHaveBeenCalledWith(
      'Could not apply the app update. Try Update again.',
      'error',
    );
    await availability.applyUpdate();
    expect(promptedReload.applyPromptedReload).toHaveBeenCalledTimes(2);
  });

  it('keeps this window open when the update was applied from another window', async () => {
    // The service worker is shared by every tab. Without onNeedReload the plugin
    // reloads each window that saw the update when any one of them clicks Update,
    // and a reload stops a job streaming there (ADR-060).
    h.swState.needRefresh = true;
    await render();
    needReload();
    needReload();
    expect(reload).not.toHaveBeenCalled();
    expect(h.pushToast).toHaveBeenCalledTimes(1);
    expect(h.pushToast).toHaveBeenCalledWith(UPDATED_IN_ANOTHER_WINDOW_MESSAGE, 'info');
    expect(usePwaUpdateStore.getState().availability.kind).toBe('ready');
  });

  it('reloads the window whose operator clicked Update once the new worker takes over', async () => {
    h.swState.needRefresh = true;
    await render();
    const availability = usePwaUpdateStore.getState().availability;
    if (availability.kind !== 'ready') throw new Error('expected ready availability');
    await availability.applyUpdate();
    needReload();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(h.pushToast).not.toHaveBeenCalled();
  });

  it('stops treating this window as the one that asked once its update attempt failed', async () => {
    h.swState.needRefresh = true;
    promptedReload.applyPromptedReload.mockRejectedValueOnce(new Error('update failed'));
    await render();
    const availability = usePwaUpdateStore.getState().availability;
    if (availability.kind !== 'ready') throw new Error('expected ready availability');
    await availability.applyUpdate();
    needReload();
    expect(reload).not.toHaveBeenCalled();
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
