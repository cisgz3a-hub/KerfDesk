// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteCredentialStore, RemoteIdentity } from './credential-store.js';
import type { RemoteRendererQueue } from './renderer-queue.js';
import type { RemoteScope } from './relay-types.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteAccessRuntime } from './runtime.js';

type RelayOptions = {
  queue: RemoteRendererQueue;
  canRequest: (clientId: string, scopes: RemoteScope[]) => boolean;
  onConnection: (open: boolean) => void;
  onMessage: (message: Record<string, unknown>) => void;
};
const captured = vi.hoisted(() => ({
  options: null as RelayOptions | null,
  relay: {
    send: vi.fn((_message: Record<string, unknown>) => true),
    start: vi.fn((_identity: RemoteIdentity) => undefined),
    close: vi.fn(),
    cancelRequests: vi.fn(),
    cancelClient: vi.fn((_clientId: string) => undefined),
    requestId: () => crypto.randomUUID(),
  },
}));
vi.mock('./relay-client.js', async (original) => ({
  ...(await original<typeof import('./relay-client.js')>()),
  createRemoteRelayClient: (options: RelayOptions) => {
    captured.options = options;
    return captured.relay;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  captured.options = null;
  captured.relay.close.mockImplementation(() => captured.options?.onConnection(false));
});

function identity(): RemoteIdentity {
  return {
    schemaVersion: 1,
    deviceId: randomUUID(),
    ownerSecret: 'A'.repeat(43),
    enabled: true,
    revokeOnConnect: false,
    pendingRevocations: [],
  };
}
function fixture(initial: RemoteIdentity | null = identity(), monotonicNow?: () => number) {
  let saved = initial;
  const store: RemoteCredentialStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => {
      saved = structuredClone(value);
    }),
    create: () => ({ ...identity(), enabled: false }),
  };
  const queue = createRemoteRendererQueue();
  queue.attach();
  const runtime = createRemoteAccessRuntime(store, queue, monotonicNow);
  return { runtime, store, saved: () => saved, queue, options: captured.options! };
}
const client = (scopes: RemoteScope[] = ['read', 'edit']) => ({
  id: randomUUID(),
  label: 'Approved client',
  scopes,
  createdAt: Date.now(),
});
async function connected(f: ReturnType<typeof fixture>, clients = [client()]) {
  await f.runtime.opened();
  f.options.onConnection(true);
  f.options.onMessage({ type: 'clients', clients });
  return clients;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((done) => setImmediate(done));

describe('native opt-in, scoped pairing and durable revocation', () => {
  it('opens disabled without connecting and projects no secret or code in URLs', async () => {
    const f = fixture(null);
    await f.runtime.opened();
    expect(captured.relay.start).not.toHaveBeenCalled();
    expect(f.runtime.status().enabled).toBe(false);
    await f.runtime.configure(true);
    const status = f.runtime.status();
    expect(captured.relay.start).toHaveBeenCalledOnce();
    expect(status.controlUrl).toContain(`?deviceId=${status.deviceId}`);
    expect(status.mcpUrl).toMatch(/\/mcp$/);
    expect(JSON.stringify(status)).not.toContain(f.saved()!.ownerSecret);
    expect(status.controlUrl).not.toContain('code=');
    f.runtime.closed();
  });

  it('admits only confirmed clients, refuses missing and elevated grants, and clears reconnect trust', async () => {
    const f = fixture();
    const clients = await connected(f, [client(['read'])]);
    const id = clients[0]!.id;
    expect(f.options.canRequest(id, ['read'])).toBe(true);
    expect(f.options.canRequest(id, ['read', 'edit'])).toBe(false);
    expect(f.options.canRequest(randomUUID(), ['read'])).toBe(false);
    f.options.onConnection(false);
    expect(f.options.canRequest(id, ['read'])).toBe(false);
    f.options.onConnection(true);
    expect(f.options.canRequest(id, ['read'])).toBe(false);
    f.runtime.closed();
  });

  it('blocks new edits immediately while all-revoke persistence is pending', async () => {
    const f = fixture();
    const [approved] = await connected(f);
    const held = deferred();
    vi.mocked(f.store.write).mockImplementationOnce(async () => held.promise);
    const revocation = f.runtime.revokeAll();
    expect(f.options.canRequest(approved!.id, ['read', 'edit'])).toBe(false);
    expect(captured.relay.cancelRequests).toHaveBeenCalledOnce();
    await flush();
    expect(captured.relay.send.mock.calls.some(([m]) => m.type === 'clients.revokeAll')).toBe(
      false,
    );
    held.resolve();
    await revocation;
    expect(captured.relay.send.mock.calls.some(([m]) => m.type === 'clients.revokeAll')).toBe(true);
    f.runtime.closed();
  });

  it('ignores a wrong all-revoke acknowledgement and retries durable revocation after reopening', async () => {
    const f = fixture();
    await connected(f);
    await f.runtime.revokeAll();
    f.options.onMessage({ type: 'clients.revoked', requestId: 'wrong' });
    await flush();
    expect(f.saved()!.revokeOnConnect).toBe(true);
    f.runtime.closed();
    const restarted = fixture(f.saved());
    await restarted.runtime.opened();
    captured.relay.send.mockClear();
    restarted.options.onConnection(true);
    expect(captured.relay.send.mock.calls[0]![0].type).toBe('clients.revokeAll');
    restarted.runtime.closed();
  });

  it('does not let an old accepted acknowledgement clear a newer revoke intent', async () => {
    const f = fixture();
    await connected(f);
    await f.runtime.revokeAll();
    const ack = captured.relay.send.mock.calls.find(([m]) => m.type === 'clients.revokeAll')![0];
    const held = deferred();
    const write = f.store.write;
    vi.mocked(write).mockImplementationOnce(async () => held.promise);
    f.options.onMessage({ type: 'clients.revoked', requestId: ack.requestId });
    await flush();
    const newer = f.runtime.revokeAll();
    held.resolve();
    await newer;
    expect(f.saved()!.revokeOnConnect).toBe(true);
    f.options.onMessage({ type: 'clients', clients: [client()] });
    expect(f.options.canRequest(f.runtime.status().clients[0]!.id, ['read'])).toBe(false);
    f.runtime.closed();
  });

  it('persists a single revoke before sending it and resumes it before loading grants', async () => {
    const f = fixture();
    const [approved] = await connected(f);
    captured.relay.send.mockClear();
    await f.runtime.revoke(approved!.id);
    expect(f.saved()!.pendingRevocations).toEqual([approved!.id]);
    expect(captured.relay.cancelClient).toHaveBeenCalledWith(approved!.id);
    expect(f.options.canRequest(approved!.id, ['read'])).toBe(false);
    f.runtime.closed();
    const restarted = fixture(f.saved());
    await restarted.runtime.opened();
    captured.relay.send.mockClear();
    restarted.options.onConnection(true);
    expect(captured.relay.send.mock.calls.slice(0, 2).map(([m]) => m.type)).toEqual([
      'client.revoke',
      'clients.list',
    ]);
    restarted.options.onMessage({ type: 'clients', clients: [approved] });
    expect(restarted.options.canRequest(approved!.id, ['read'])).toBe(false);
    restarted.options.onMessage({ type: 'clients', clients: [] });
    await flush();
    expect(restarted.saved()!.pendingRevocations).toEqual([]);
    restarted.runtime.closed();
  });

  it('does not reconnect an older enable after a newer disable', async () => {
    const f = fixture(null);
    await f.runtime.opened();
    const held = deferred();
    vi.mocked(f.store.write).mockImplementationOnce(async () => held.promise);
    const enable = f.runtime.configure(true);
    await flush();
    const disable = f.runtime.configure(false);
    held.resolve();
    await Promise.all([enable, disable]);
    expect(captured.relay.start).not.toHaveBeenCalled();
    expect(f.saved()).toMatchObject({ enabled: false, revokeOnConnect: true });
    f.runtime.closed();
  });

  it('retains a newer single-client revoke through an older cleanup write', async () => {
    const f = fixture();
    const [approved] = await connected(f);
    await f.runtime.revoke(approved!.id);
    const held = deferred();
    vi.mocked(f.store.write).mockImplementationOnce(async () => held.promise);
    f.options.onMessage({ type: 'clients', clients: [] });
    await flush();
    // Defensive ordering test. The actual serialized DO and same-owner WSS are FIFO.
    f.options.onMessage({ type: 'clients', clients: [approved] });
    const newer = f.runtime.revoke(approved!.id);
    held.resolve();
    await newer;
    f.options.onMessage({ type: 'clients', clients: [approved] });
    expect(f.saved()!.pendingRevocations).toEqual([approved!.id]);
    expect(f.options.canRequest(approved!.id, ['read'])).toBe(false);
    f.runtime.closed();
  });

  it('keeps ordinary app use available but disables remote access on secure-save failure', async () => {
    const f = fixture();
    const [approved] = await connected(f);
    vi.mocked(f.store.write).mockRejectedValueOnce(new Error('secret/path must not escape'));
    await expect(f.runtime.revoke(approved!.id)).rejects.toThrow('could not be saved securely');
    expect(f.runtime.status()).toMatchObject({ available: false, connected: false });
    expect(f.options.canRequest(approved!.id, ['read'])).toBe(false);
    expect(JSON.stringify(f.runtime.status())).not.toContain('secret/path');
    expect(f.queue.ready()).toBe(true);
    f.runtime.closed();
  });
});

function pairingMessage(f: ReturnType<typeof fixture>, duration = 300_000) {
  f.runtime.pair();
  const requestId = captured.relay.send.mock.calls.findLast(
    ([value]) => value.type === 'pair.create',
  )![0].requestId;
  return {
    type: 'pair.offer',
    requestId,
    code: 'NewCode12345A',
    expiresAt: 1_700_000_300_000,
    expiresInMs: duration,
  };
}

describe('native pairing offer ownership and monotonic presentation leases', () => {
  it('does not publish an older Create response after a replacement was requested', async () => {
    const f = fixture();
    await connected(f, []);
    const old = pairingMessage(f);
    const current = pairingMessage(f);
    f.options.onMessage(old);
    expect(f.runtime.status().pairing).toBeNull();
    expect(f.runtime.status().pairingPending).toBe(true);
    f.options.onMessage(current);
    expect(f.runtime.status()).toMatchObject({
      pairingPending: false,
      pairing: { code: current.code },
    });
    f.options.onMessage(old);
    expect(f.runtime.status().pairing?.code).toBe(current.code);
    f.runtime.closed();
  });

  it('uses a bounded server duration when the PC wall clock is ahead or behind', async () => {
    let now = 100;
    const f = fixture(identity(), () => now);
    await connected(f, []);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      f.options.onMessage(pairingMessage(f, 1_000));
      expect(f.runtime.status().pairing?.expiresInMs).toBe(1_000);
      wall.mockReturnValue(1_600_000_000_000);
      now += 999;
      expect(f.runtime.status().pairing?.expiresInMs).toBe(1);
      now += 1;
      expect(f.runtime.status().pairing).toBeNull();
      wall.mockReturnValue(1_500_000_000_000);
      expect(f.runtime.status().pairing).toBeNull();
    } finally {
      wall.mockRestore();
      f.runtime.closed();
    }
  });

  it('a newer Create owns its timeout and late old responses cannot reopen either lease', async () => {
    let now = 0;
    const f = fixture(identity(), () => now);
    await connected(f, []);
    const old = pairingMessage(f);
    now = 10_000;
    const current = pairingMessage(f);
    now = 30_001;
    expect(f.runtime.status().pairingPending).toBe(true);
    f.options.onMessage(old);
    expect(f.runtime.status().pairing).toBeNull();
    now = 40_001;
    expect(f.runtime.status().pairingPending).toBe(false);
    expect(f.runtime.status().error).toContain('not arrive');
    f.options.onMessage(current);
    expect(f.runtime.status().pairing).toBeNull();
    f.runtime.closed();
  });

  it.each([0, -1, 300_001, 1.5, null, '1000'])(
    'refuses an invalid bounded duration %s',
    async (duration) => {
      const f = fixture();
      await connected(f, []);
      f.options.onMessage({ ...pairingMessage(f), expiresInMs: duration });
      expect(f.runtime.status().pairing).toBeNull();
      expect(f.runtime.status().pairingPending).toBe(false);
      expect(f.runtime.status().error).not.toBeNull();
      f.runtime.closed();
    },
  );

  it('refuses legacy clock-only offers explicitly without closing the workspace or connection', async () => {
    const f = fixture();
    await connected(f, []);
    const { expiresInMs: _duration, ...legacy } = pairingMessage(f);
    f.options.onMessage(legacy);
    expect(f.runtime.status()).toMatchObject({
      connected: true,
      available: true,
      pairing: null,
      pairingPending: false,
    });
    expect(f.runtime.status().error).toContain('remote service must be updated');
    expect(f.queue.ready()).toBe(true);
    f.runtime.closed();
  });

  it('expires a pending approval with elapsed time while wall clock changes cannot revive it', async () => {
    let now = 0;
    const f = fixture(identity(), () => now);
    await connected(f, []);
    f.options.onMessage(pairingMessage(f, 1_000));
    const pairingId = randomUUID();
    f.options.onMessage({
      type: 'pair.request',
      pairingId,
      clientLabel: 'Synthetic phone',
      requestedScopes: ['read'],
      expiresAt: 1_700_000_300_000,
      expiresInMs: 1_000,
    });
    expect(f.runtime.status().requests).toHaveLength(1);
    now = 1_000;
    expect(f.runtime.status().requests).toHaveLength(0);
    expect(() => f.runtime.decide(pairingId, true, ['read'])).toThrow('Pairing is unavailable');
    expect(captured.relay.send.mock.calls.some(([value]) => value.type === 'pair.decide')).toBe(
      false,
    );
    f.runtime.closed();
  });

  it('orders every main-owned status snapshot, including reads with unchanged metadata', async () => {
    const f = fixture();
    await connected(f, []);
    const older = f.runtime.status();
    const newer = f.runtime.status();
    expect(newer.statusRevision).toBeGreaterThan(older.statusRevision);
    f.runtime.closed();
  });

  it('duplicate approval messages cannot renew an active or expired presentation lease', async () => {
    let now = 0;
    const f = fixture(identity(), () => now);
    await connected(f, []);
    const message = {
      type: 'pair.request',
      pairingId: randomUUID(),
      clientLabel: 'Synthetic phone',
      requestedScopes: ['read'],
      expiresAt: 1_700_000_300_000,
      expiresInMs: 1_000,
    };
    f.options.onMessage(message);
    now = 500;
    f.options.onMessage(message);
    expect(f.runtime.status().requests[0]?.expiresInMs).toBe(500);
    now = 1_000;
    expect(f.runtime.status().requests).toEqual([]);
    f.options.onMessage(message);
    expect(f.runtime.status().requests).toEqual([]);
    expect(() => f.runtime.decide(message.pairingId, true, ['read'])).toThrow(
      'Pairing is unavailable',
    );
    f.runtime.closed();
  });
});
