import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { RemotePairingHost } from './RemotePairingHost';
import {
  setRemoteSession,
  useRemoteAccessStore,
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
    expect([...buttons].map((button) => button.textContent)).toEqual([
      'Reject',
      'Allow viewing',
      'Allow viewing and editing',
    ]);
  });
});
