// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteIdentity } from './credential-store.js';
import type { RemoteScope } from './relay-types.js';
import { REMOTE_CONTROL_TTL_MS } from './relay-types.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteAccessRuntime } from './runtime.js';

type Options = {
  canRequest: (clientId: string, scopes: RemoteScope[], requiresControl?: boolean) => boolean;
  onConnection: (open: boolean) => void;
  onMessage: (message: Record<string, unknown>) => void;
};
const captured = vi.hoisted(() => ({
  options: null as Options | null,
  relay: {
    send: vi.fn((_message: Record<string, unknown>) => true),
    start: vi.fn(),
    close: vi.fn(),
    cancelRequests: vi.fn(),
    cancelClient: vi.fn(),
    requestId: () => crypto.randomUUID(),
  },
}));
vi.mock('./relay-client.js', async (original) => ({
  ...(await original<typeof import('./relay-client.js')>()),
  createRemoteRelayClient: (options: Options) => {
    captured.options = options;
    return captured.relay;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  captured.options = null;
  captured.relay.close.mockImplementation(() => captured.options?.onConnection(false));
});

async function fixture() {
  let elapsed = 100;
  const identity: RemoteIdentity = {
    schemaVersion: 1,
    deviceId: randomUUID(),
    ownerSecret: 'A'.repeat(43),
    enabled: true,
    revokeOnConnect: false,
    pendingRevocations: [],
  };
  const queue = createRemoteRendererQueue();
  queue.attach();
  const runtime = createRemoteAccessRuntime(
    { read: async () => identity, write: async () => undefined, create: () => identity },
    queue,
    () => elapsed,
  );
  await runtime.opened();
  const options = captured.options!;
  options.onConnection(true);
  const client = {
    id: randomUUID(),
    label: 'Synthetic controller client',
    scopes: ['read', 'edit', 'control'] as RemoteScope[],
    createdAt: 1,
  };
  const requestId = () =>
    captured.relay.send.mock.calls.findLast(([m]) => m.type === 'clients.list')![0].requestId;
  const receive = (remaining: unknown, id: unknown = requestId()) =>
    options.onMessage({
      type: 'clients',
      requestId: id,
      clients: [{ ...client, controlExpiresInMs: remaining }],
    });
  return {
    runtime,
    client,
    options,
    requestId,
    receive,
    advance: (ms: number) => {
      elapsed += ms;
    },
  };
}

describe('native current control approval has a correlated monotonic deadline', () => {
  it('subtracts the full response delay and ignores PC wall clock changes', async () => {
    const f = await fixture();
    f.advance(400);
    f.receive(1_000);
    expect(f.runtime.status().clients[0]?.controlExpiresInMs).toBe(600);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(true);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      f.advance(600);
      expect(f.runtime.status().clients[0]?.controlExpiresInMs).toBe(0);
      expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
      expect(f.options.canRequest(f.client.id, ['read', 'control'], false)).toBe(true);
      expect(f.options.canRequest(f.client.id, ['read', 'edit'])).toBe(true);
      wall.mockReturnValue(9_999_999_999_999);
      expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
      expect(f.options.canRequest(f.client.id, ['read', 'edit', 'control'], false)).toBe(true);
    } finally {
      wall.mockRestore();
      f.runtime.closed();
    }
  });

  it('does not renew from an unsolicited push or a duplicate old response', async () => {
    const f = await fixture();
    const firstId = f.requestId();
    f.receive(1_000);
    f.advance(900);
    f.receive(REMOTE_CONTROL_TTL_MS, randomUUID());
    const currentId = f.requestId();
    expect(currentId).not.toBe(firstId);
    expect(f.runtime.status().clients[0]?.controlExpiresInMs).toBe(100);
    f.receive(REMOTE_CONTROL_TTL_MS, firstId);
    expect(f.requestId()).toBe(currentId);
    f.advance(100);
    expect(f.runtime.status().clients[0]?.controlExpiresInMs).toBe(0);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    f.receive(100, currentId);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    f.runtime.closed();
  });

  it.each([undefined, null, -1, 0, 1.5, '1000', REMOTE_CONTROL_TTL_MS + 1])(
    'keeps read/edit compatible but control fails closed without valid lifetime %s',
    async (remaining) => {
      const f = await fixture();
      f.receive(remaining);
      expect(f.options.canRequest(f.client.id, ['read'])).toBe(true);
      expect(f.options.canRequest(f.client.id, ['read', 'edit'])).toBe(true);
      expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
      expect(f.runtime.status().clients[0]?.controlExpiresInMs).toBe(0);
      f.runtime.closed();
    },
  );

  it('cannot regain authority from a delayed response after reconnect or app restart', async () => {
    const f = await fixture();
    const oldId = f.requestId();
    f.receive(1_000);
    f.options.onConnection(false);
    f.options.onConnection(true);
    f.receive(1_000, oldId);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    f.receive(1_000);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(true);
    f.runtime.closed();
    const restarted = await fixture();
    restarted.options.onMessage({
      type: 'clients',
      requestId: oldId,
      clients: [{ ...f.client, controlExpiresInMs: 1_000 }],
    });
    expect(restarted.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    restarted.runtime.closed();
  });

  it('revoke blocks all requests immediately and removes the published control deadline', async () => {
    const f = await fixture();
    f.receive(REMOTE_CONTROL_TTL_MS);
    await f.runtime.revoke(f.client.id);
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    await f.runtime.revokeAll();
    expect(f.runtime.status().clients).toEqual([]);
    f.receive(REMOTE_CONTROL_TTL_MS, randomUUID());
    expect(f.options.canRequest(f.client.id, ['read', 'control'])).toBe(false);
    f.runtime.closed();
  });
});
