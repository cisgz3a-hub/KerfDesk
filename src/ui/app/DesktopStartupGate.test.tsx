import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopStartupGate } from './DesktopStartupGate';

const closeReceiver = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock('./desktop-close-runtime', () => ({ installDesktopCloseReceiver: closeReceiver }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const desktopWindow = Object.create(window, {
    location: { value: new URL('app://app/index.html') },
  }) as Window;
  vi.stubGlobal('window', desktopWindow);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeReceiver.mockClear();
});
const open = async (strict = false) => {
  const gate = (
    <DesktopStartupGate>
      <span data-testid="workspace">Workspace</span>
    </DesktopStartupGate>
  );
  await act(async () => root.render(strict ? <StrictMode>{gate}</StrictMode> : gate));
};

describe('desktop workspace startup', () => {
  it('holds workspace providers until native startup acknowledges the opening gate', async () => {
    let reply!: (response: Response) => void;
    const fetchReady = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchReady);
    await open();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
    expect(closeReceiver).toHaveBeenCalledOnce();
    expect(fetchReady).toHaveBeenCalledWith(
      './api/desktop/workspace-ready',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-KerfDesk-Desktop': '1' },
        credentials: 'same-origin',
      }),
    );
    await act(async () => reply(new Response(null, { status: 204 })));
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
  });

  it('keeps the workspace held on rejection and allows an explicit retry', async () => {
    const fetchReady = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchReady);
    await open();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
    expect(fetchReady).toHaveBeenCalledTimes(2);
  });

  it('does not treat a successful fallback page as native readiness', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('index.html', { status: 200 })),
    );
    await open();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('offers retry after a stalled native request reaches its timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await open();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
  });

  it('survives StrictMode restarting the readiness effect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await open(true);
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
  });

  it('opens the browser workspace without contacting a desktop service', async () => {
    vi.stubGlobal(
      'window',
      Object.create(window, {
        location: { value: new URL('https://kerfdesk.com/') },
      }),
    );
    const fetchReady = vi.fn();
    vi.stubGlobal('fetch', fetchReady);
    await open();
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
    expect(fetchReady).not.toHaveBeenCalled();
    expect(closeReceiver).not.toHaveBeenCalled();
  });
});
