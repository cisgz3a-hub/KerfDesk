import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { RemotePairingHost } from './RemotePairingHost';
import {
  setRemoteSession,
  useRemoteAccessStore,
  isRemoteAccessStatus,
  type RemoteAccessStatus,
} from './remote-access-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const status: RemoteAccessStatus = {
  statusRevision: 1,
  available: true,
  enabled: true,
  connected: true,
  deviceId: 'synthetic-device',
  controlUrl: 'https://example.invalid/control',
  mcpUrl: 'https://example.invalid/mcp',
  pairing: null,
  pairingPending: false,
  clients: [],
  error: null,
  requests: [
    {
      pairingId: 'synthetic-request',
      clientLabel: 'Synthetic phone',
      requestedScopes: ['read', 'edit'],
      expiresAt: 1_700_000_300_000,
      expiresInMs: 300_000,
    },
  ],
};
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  setRemoteSession(null);
  useRemoteAccessStore.setState({ status: null, busy: false, message: null });
  useUiStore.setState({ modalDepth: 0 });
  vi.unstubAllGlobals();
});

describe('unsolicited remote approval focus', () => {
  it('focuses the surface so a typing key does not choose a permission or reject the phone', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    setRemoteSession('synthetic-session');
    useRemoteAccessStore.setState({ status });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<RemotePairingHost />));
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    );
    expect(fetcher).not.toHaveBeenCalled();
    const buttons = host.querySelectorAll('button');
    expect([...buttons].map((button) => button.textContent)).toEqual(['Reject', 'Allow viewing']);
  });
});

async function renderRequest(
  scopes: RemoteAccessStatus['requests'][number]['requestedScopes'],
): Promise<HTMLElement> {
  setRemoteSession('synthetic-session');
  useRemoteAccessStore.setState({
    status: { ...status, requests: [{ ...status.requests[0]!, requestedScopes: scopes }] },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<RemotePairingHost />));
  return host;
}

function approveFetcher(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ...status, statusRevision: 2, requests: [] }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

async function clickApprove(host: HTMLElement): Promise<void> {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) =>
      item.textContent === 'Allow viewing' || item.textContent === 'Approve selected access',
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}

describe('explicit machine-control pairing permission', () => {
  it('defaults a full access request to viewing without granting editing or motion', async () => {
    const fetcher = approveFetcher();
    const host = await renderRequest(['read', 'edit', 'control']);
    const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((input) => !input.checked)).toBe(true);
    await clickApprove(host);
    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ approved: true, scopes: ['read'] });
  });

  it('can grant machine control without granting artwork editing', async () => {
    const fetcher = approveFetcher();
    const host = await renderRequest(['read', 'edit', 'control']);
    const control = [...host.querySelectorAll<HTMLLabelElement>('label')]
      .find((label) => label.textContent?.includes('Allow Jog'))
      ?.querySelector<HTMLInputElement>('input');
    expect(control).toBeDefined();
    await act(async () => control?.click());
    await clickApprove(host);
    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ approved: true, scopes: ['read', 'control'] });
  });

  it('does not offer machine control to an existing read/edit request', async () => {
    const host = await renderRequest(['read', 'edit']);
    expect(host.textContent).not.toContain('Allow Jog, Frame, Start and Abort');
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });

  it('clears permission choices when the pending phone request is replaced', async () => {
    const host = await renderRequest(['read', 'control']);
    const control = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => control?.click());
    expect(control?.checked).toBe(true);
    await act(async () =>
      useRemoteAccessStore.setState({
        status: {
          ...status,
          requests: [
            {
              ...status.requests[0]!,
              pairingId: 'replacement-request',
              requestedScopes: ['read', 'control'],
            },
          ],
        },
      }),
    );
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(host.textContent).toContain('Allow viewing');
  });

  it('accepts explicit control scopes and rejects duplicate or unknown grants', () => {
    const withScopes = (scopes: unknown) => ({
      ...status,
      clients: [{ id: 'synthetic-client', label: 'Synthetic phone', scopes }],
    });
    expect(isRemoteAccessStatus(withScopes(['read', 'control']))).toBe(true);
    expect(isRemoteAccessStatus(withScopes(['read', 'edit', 'control']))).toBe(true);
    expect(isRemoteAccessStatus(withScopes(['read', 'control', 'control']))).toBe(false);
    expect(isRemoteAccessStatus(withScopes(['read', 'shell']))).toBe(false);
    expect(isRemoteAccessStatus(withScopes(['control']))).toBe(false);
  });
});
