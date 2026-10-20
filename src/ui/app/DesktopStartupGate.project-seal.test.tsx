import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopStartup } from '../../../electron/desktop-startup';
import { createDesktopLicenceAdapter } from '../../platform/electron/licensing';
import {
  installProjectSealKey,
  projectSealReady,
  projectTextSealedHere,
  resetProjectSealForTests,
  sealProjectText,
} from '../licensing/project-seal';
import { DesktopStartupGate } from './DesktopStartupGate';

vi.mock('./desktop-close-runtime', () => ({ installDesktopCloseReceiver: () => () => undefined }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'window',
    Object.create(window, { location: { value: new URL('app://app/index.html') } }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetProjectSealForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('project seal key loading after desktop startup', () => {
  it.each([false, true])(
    'opens the workspace while project IO waits for the acknowledged key (StrictMode %s)',
    async (strict) => {
      let open!: () => void;
      let deliverKey!: (key: string) => void;
      const opening = new Promise<void>((resolve) => (open = resolve));
      const pendingKey = new Promise<string>((resolve) => (deliverKey = resolve));
      const statuses: number[] = [];
      const keyRoute = vi.fn(async () => Response.json({ key: await pendingKey }));
      const handle = createDesktopStartup(() => undefined).routes(keyRoute);
      const fetch = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/workspace-ready')) await opening;
        const response = await handle(new Request(new URL(url, 'app://app/index.html'), init));
        statuses.push(response.status);
        return response;
      });
      vi.stubGlobal('fetch', fetch);
      const client = createDesktopLicenceAdapter(fetch);
      const prepare = vi.fn(() => installProjectSealKey(client.projectSealKey!));
      let sealed: string | null = null;
      function Workspace() {
        useEffect(() => {
          void projectSealReady().then(() => {
            sealed = sealProjectText('{"schemaVersion":1}\n');
          });
        }, []);
        return <span data-testid="workspace">Workspace</span>;
      }
      const gate = (
        <DesktopStartupGate onNativeReady={prepare}>
          <Workspace />
        </DesktopStartupGate>
      );
      await act(async () => root.render(strict ? <StrictMode>{gate}</StrictMode> : gate));
      expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
      expect(prepare).not.toHaveBeenCalled();
      expect(keyRoute).not.toHaveBeenCalled();
      expect(fetch.mock.calls.every(([url]) => url.endsWith('/workspace-ready'))).toBe(true);

      await act(async () => open());
      expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
      expect(prepare).toHaveBeenCalledOnce();
      expect(keyRoute).toHaveBeenCalledOnce();
      expect(sealed).toBeNull();

      await act(async () => deliverKey('a'.repeat(43)));
      await projectSealReady();
      expect(statuses.every((status) => status === 204 || status === 200)).toBe(true);
      expect(sealed).not.toBeNull();
      expect(projectTextSealedHere(sealed!)).toBe(true);
    },
  );

  it('starts no key request when native opening fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const prepare = vi.fn();
    await act(async () =>
      root.render(
        <DesktopStartupGate onNativeReady={prepare}>
          <span data-testid="workspace">Workspace</span>
        </DesktopStartupGate>,
      ),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('ignores a late native acknowledgement after the opening gate unmounts', async () => {
    let deliver!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (deliver = resolve))),
    );
    const prepare = vi.fn();
    await act(async () =>
      root.render(
        <DesktopStartupGate onNativeReady={prepare}>
          <span data-testid="workspace">Workspace</span>
        </DesktopStartupGate>,
      ),
    );
    await act(async () => root.render(null));
    await act(async () => deliver(new Response(null, { status: 204 })));
    expect(prepare).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="workspace"]')).toBeNull();
  });
});
