import { runInNewContext } from 'node:vm';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopStartup } from '../../../electron/desktop-startup';
import { nativeLicenceRendererSource } from '../../../electron/native-smoke-licence-renderer';
import { RENDERER_SMOKE_SOURCE } from '../../../electron/native-smoke-renderer';
import { DesktopStartupGate } from './DesktopStartupGate';

vi.mock('./desktop-close-runtime', () => ({ installDesktopCloseReceiver: () => () => undefined }));

const free = {
  channel: 'commercial',
  state: 'activation-required',
  edition: 'free',
  tier: null,
  perpetualUpdates: false,
  accessExpiresAt: null,
  updatesUntil: null,
  deactivationPending: false,
};
type PickerWindow = Window & {
  showOpenFilePicker(): Promise<Array<{ getFile(): Promise<File> }>>;
  showSaveFilePicker(): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
};
let desktopWindow: PickerWindow;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  desktopWindow = Object.create(window, {
    location: { value: new URL('app://app/index.html') },
  }) as PickerWindow;
  vi.stubGlobal('window', desktopWindow);
  host = document.createElement('div');
  host.id = 'app-root';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(status = 200, startupFails = false, importDisabled = false) {
  let deliver!: () => void;
  let picked = '';
  const start = vi.fn(() => {
    if (startupFails) throw new Error('Startup failed');
  });
  const fallback = vi.fn(
    async (request: Request) =>
      new Response(
        JSON.stringify(request.url.endsWith('/update-status') ? { state: 'unavailable' } : free),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const handle = createDesktopStartup(start).routes(fallback);
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === './api/desktop/workspace-ready')
      await new Promise<void>((resolve, reject) => {
        deliver = resolve;
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    return handle(
      new Request(new URL(url, 'app://app/index.html'), {
        ...(init.method === undefined ? {} : { method: init.method }),
        ...(init.headers === undefined ? {} : { headers: init.headers }),
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const workspace = (disabled = importDisabled) => (
    <header aria-label="Toolbar">
      <button
        aria-label="Import..."
        disabled={disabled}
        onClick={() => {
          void desktopWindow.showOpenFilePicker().then(async ([file]) => {
            picked = (await file!.getFile()).name;
          });
        }}
      >
        Import
      </button>
      <button
        aria-label="Save As..."
        onClick={() => {
          void desktopWindow.showSaveFilePicker().then(async (file) => {
            const writable = await file.createWritable();
            await writable.write(JSON.stringify({ schemaVersion: 1, source: picked }));
            await writable.close();
          });
        }}
      >
        Save
      </button>
    </header>
  );
  return {
    fetch,
    start,
    fallback,
    deliver: () => deliver(),
    workspace: workspace(),
    enabledWorkspace: workspace(false),
  };
}

function execute(source = RENDERER_SMOKE_SOURCE) {
  return Promise.resolve(
    runInNewContext(source, {
      window: desktopWindow,
      location: new URL('app://app/index.html'),
      document,
      HTMLButtonElement,
      File,
      Blob,
      setTimeout,
      fetch,
    }),
  ).catch((error: unknown) => error);
}

describe('native qualification follows the real renderer opening gate', () => {
  it.each(['ordinary', 'licence phase'])(
    'waits for the delayed normal handshake before %s observation',
    async (branch) => {
      const ui = fixture();
      await act(async () => root.render(<DesktopStartupGate>{ui.workspace}</DesktopStartupGate>));
      const observed = execute(
        branch === 'ordinary'
          ? RENDERER_SMOKE_SOURCE
          : nativeLicenceRendererSource('deactivate', ''),
      );
      await act(async () => vi.advanceTimersByTimeAsync(200));
      expect(host.querySelector('header')).toBeNull();
      expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual(['./api/desktop/workspace-ready']);
      expect(ui.start).not.toHaveBeenCalled();
      await act(async () => ui.deliver());
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(await observed).toMatchObject({
        imported: true,
        saved: true,
        licensing: { edition: 'free' },
      });
      expect(ui.start).toHaveBeenCalledOnce();
      expect(
        ui.fetch.mock.calls
          .slice(1)
          .every(
            ([url, init]) => url.startsWith('app://app/api/licensing/') && init.method === 'GET',
          ),
      ).toBe(true);
      expect(ui.fetch.mock.calls.filter(([url]) => url.includes('workspace-ready'))).toHaveLength(
        1,
      );
    },
  );

  it('requires an enabled workspace command before observing licensing', async () => {
    const ui = fixture(200, false, true);
    await act(async () => root.render(<DesktopStartupGate>{ui.workspace}</DesktopStartupGate>));
    await act(async () => ui.deliver());
    const observed = execute();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual(['./api/desktop/workspace-ready']);
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Import..."]');
    expect(button?.disabled).toBe(true);
    await act(async () =>
      root.render(<DesktopStartupGate>{ui.enabledWorkspace}</DesktopStartupGate>),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(await observed).toMatchObject({ imported: true, saved: true });
  });

  it('leaves a held first-use agreement untouched and observes no licensing routes', async () => {
    const ui = fixture();
    await act(async () =>
      root.render(
        <section role="dialog" aria-label="First-use agreement">
          <p>Accept the published terms to continue.</p>
        </section>,
      ),
    );
    const observed = execute();
    await act(async () => vi.advanceTimersByTimeAsync(40_000));
    expect(await observed).toMatchObject({
      message: 'Workspace did not open within the native smoke budget',
    });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.start).not.toHaveBeenCalled();
    expect(ui.fallback).not.toHaveBeenCalled();
  });

  it('keeps a genuine failed startup decisive without observing licensing', async () => {
    const ui = fixture(200, true);
    await act(async () => root.render(<DesktopStartupGate>{ui.workspace}</DesktopStartupGate>));
    const observed = execute();
    await act(async () => ui.deliver());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(await observed).toMatchObject({ message: 'Workspace startup failed' });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual(['./api/desktop/workspace-ready']);
    expect(ui.fallback).not.toHaveBeenCalled();
  });

  it('does not retry a local 503 once the workspace is ready', async () => {
    const ui = fixture(503);
    await act(async () => root.render(<DesktopStartupGate>{ui.workspace}</DesktopStartupGate>));
    await act(async () => ui.deliver());
    const observed = execute();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(await observed).toMatchObject({ message: 'Local licensing status returned HTTP 503' });
    expect(ui.fetch.mock.calls.filter(([url]) => url.includes('/licensing/'))).toHaveLength(1);
  });
});
