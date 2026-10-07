import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgedRemoteAccessStatus,
  isRemoteAccessStatus,
  remoteRequest,
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';

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
  requests: [],
  clients: [
    {
      id: 'synthetic-client',
      label: 'Phone',
      scopes: ['read', 'control'],
      controlExpiresInMs: 1_000,
    },
  ],
  error: null,
};

beforeEach(() => {
  setRemoteSession(null);
  setRemoteSession('synthetic-session');
});
afterEach(() => {
  setRemoteSession(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('remote control grant lifetime', () => {
  it('ages a stalled published status monotonically without changing artwork permissions', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    useRemoteAccessStore.getState().publish(status, 'synthetic-session');
    now.mockReturnValue(850);
    expect(getAgedRemoteAccessStatus()?.clients[0]?.controlExpiresInMs).toBe(250);
    now.mockReturnValue(1_500);
    expect(getAgedRemoteAccessStatus()?.clients[0]).toMatchObject({
      scopes: ['read', 'control'],
      controlExpiresInMs: 0,
    });
    expect(useRemoteAccessStore.getState().status?.clients[0]?.controlExpiresInMs).toBe(1_000);
  });

  it('subtracts the entire renderer route round trip before anchoring the snapshot', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(10_000).mockReturnValue(10_250);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(status)),
    );
    const response = await remoteRequest('status');
    expect(isRemoteAccessStatus(response)).toBe(true);
    if (!isRemoteAccessStatus(response)) throw new Error('Expected valid status');
    expect(response.clients[0]?.controlExpiresInMs).toBe(750);
    now.mockReturnValue(10_300);
    useRemoteAccessStore.getState().publish(response, 'synthetic-session');
    now.mockReturnValue(10_800);
    expect(getAgedRemoteAccessStatus()?.clients[0]?.controlExpiresInMs).toBe(250);
  });

  it('does not renew the deadline when an old status revision is replayed', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    useRemoteAccessStore.getState().publish(status, 'synthetic-session');
    now.mockReturnValue(900);
    useRemoteAccessStore.getState().publish(status, 'synthetic-session');
    expect(getAgedRemoteAccessStatus()?.clients[0]?.controlExpiresInMs).toBe(200);
  });

  it('preserves older read/edit approvals without inventing a control lifetime', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const legacy = {
      ...status,
      clients: [{ id: 'legacy', label: 'Phone', scopes: ['read', 'edit'] as const }],
    };
    expect(isRemoteAccessStatus(legacy)).toBe(true);
    useRemoteAccessStore.getState().publish(legacy, 'synthetic-session');
    expect(getAgedRemoteAccessStatus()?.clients[0]).toEqual(legacy.clients[0]);
  });

  it.each([-1, Infinity, NaN, 0.5, 30 * 24 * 60 * 60 * 1000 + 1, '1000'])(
    'rejects malformed lifetime %s while accepting an expired zero snapshot',
    (controlExpiresInMs) => {
      expect(
        isRemoteAccessStatus({
          ...status,
          clients: [{ ...status.clients[0], controlExpiresInMs }],
        }),
      ).toBe(false);
      expect(
        isRemoteAccessStatus({
          ...status,
          clients: [{ ...status.clients[0], controlExpiresInMs: 0 }],
        }),
      ).toBe(true);
    },
  );
});
