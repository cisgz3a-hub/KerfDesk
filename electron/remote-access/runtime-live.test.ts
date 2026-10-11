// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteIdentity } from './credential-store.js';
import type { RemoteScope } from './relay-types.js';
import { REMOTE_CONTROL_TTL_MS } from './relay-types.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteAccessRuntime } from './runtime.js';

type Options = {
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

const sent = (type: string) =>
  captured.relay.send.mock.calls.map(([value]) => value).filter((value) => value.type === type);

async function fixture(scopes: RemoteScope[] = ['read', 'edit', 'control']) {
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
    () => 100,
  );
  await runtime.opened();
  const options = captured.options!;
  options.onConnection(true);
  const client = { id: randomUUID(), label: 'Phone', scopes, createdAt: 1 };
  const requestId = sent('clients.list').at(-1)?.requestId;
  options.onMessage({
    type: 'clients',
    requestId,
    clients: [
      {
        ...client,
        ...(scopes.includes('control') ? { controlExpiresInMs: REMOTE_CONTROL_TTL_MS } : {}),
      },
    ],
  });
  return { runtime, options, client };
}

describe('ADR-582 change counters', () => {
  it('forwards distinct workspace/machine counters once and kind-only events', async () => {
    const { runtime } = await fixture(['read']);
    runtime.observe({ revision: 'r1', machineSeq: 1 }, []);
    runtime.observe({ revision: 'r1', machineSeq: 1 }, []);
    runtime.observe({ revision: 'r2', machineSeq: 1 }, ['job.finished']);
    expect(sent('changed')).toEqual([
      { type: 'changed', revision: 'r1', machineSeq: 1 },
      { type: 'changed', revision: 'r2', machineSeq: 1 },
    ]);
    expect(sent('event')).toEqual([{ type: 'event', kind: 'job.finished' }]);
    runtime.closed();
  });

  it('re-sends the current counters after a reconnect and stays quiet with no clients', async () => {
    const { runtime, options } = await fixture(['read']);
    runtime.observe({ revision: 'r1', machineSeq: 0 }, []);
    options.onConnection(false);
    options.onConnection(true);
    runtime.observe({ revision: 'r1', machineSeq: 0 }, ['job.stopped']);
    expect(sent('changed')).toHaveLength(1);
    expect(sent('event')).toHaveLength(0);
    options.onMessage({
      type: 'clients',
      requestId: sent('clients.list').at(-1)?.requestId,
      clients: [],
    });
    options.onMessage({
      type: 'clients',
      requestId: sent('clients.list').at(-1)?.requestId,
      clients: [{ id: randomUUID(), label: 'Phone', scopes: ['read'], createdAt: 1 }],
    });
    expect(sent('changed')).toHaveLength(2);
    runtime.closed();
  });
});

describe('ADR-585 held-jog heartbeats', () => {
  it('passes heartbeats only for a control-approved client and drains them once', async () => {
    const { runtime, options, client } = await fixture();
    const operationId = randomUUID();
    options.onMessage({ type: 'hold.beat', clientId: client.id, operationId });
    options.onMessage({ type: 'hold.beat', clientId: randomUUID(), operationId: randomUUID() });
    options.onMessage({ type: 'hold.beat', clientId: client.id, operationId: 'x'.repeat(200) });
    expect(runtime.takeHoldSignals()).toEqual({ beats: [{ clientId: client.id, operationId }] });
    expect(runtime.takeHoldSignals()).toEqual({});
    runtime.closed();
  });

  it('refuses heartbeats from a view-only client', async () => {
    const { runtime, options, client } = await fixture(['read']);
    options.onMessage({ type: 'hold.beat', clientId: client.id, operationId: randomUUID() });
    expect(runtime.takeHoldSignals()).toEqual({});
    runtime.closed();
  });

  it('releases every hold when the relay connection drops and a client’s holds when it leaves', async () => {
    const { runtime, options, client } = await fixture();
    options.onMessage({ type: 'hold.release', clientId: client.id });
    expect(runtime.takeHoldSignals()).toEqual({ releases: [client.id] });
    options.onConnection(false);
    expect(runtime.takeHoldSignals().releases).toContain('*');
    options.onConnection(true);
    options.onMessage({
      type: 'clients',
      requestId: sent('clients.list').at(-1)?.requestId,
      clients: [{ ...client, controlExpiresInMs: REMOTE_CONTROL_TTL_MS }],
    });
    runtime.takeHoldSignals();
    options.onMessage({
      type: 'clients',
      requestId: sent('clients.list').at(-1)?.requestId,
      clients: [],
    });
    expect(runtime.takeHoldSignals().releases).toEqual([client.id]);
    runtime.closed();
  });
});

describe('ADR-583 remembered approval', () => {
  it('sends the PC’s explicit keep-signed-in choice with the decision', async () => {
    const { runtime, options } = await fixture(['read']);
    runtime.pair();
    const create = sent('pair.create').at(-1)!;
    options.onMessage({
      type: 'pair.offer',
      requestId: create.requestId,
      code: 'NewCode12345A',
      expiresAt: 1_700_000_300_000,
      expiresInMs: 300_000,
    });
    const pairingId = randomUUID();
    options.onMessage({
      type: 'pair.request',
      pairingId,
      clientLabel: 'Phone',
      requestedScopes: ['read'],
      expiresAt: 1_700_000_300_000,
      expiresInMs: 300_000,
    });
    runtime.decide(pairingId, true, ['read'], true);
    expect(sent('pair.decide').at(-1)).toMatchObject({ pairingId, approved: true, remember: true });
    runtime.closed();
  });
});
