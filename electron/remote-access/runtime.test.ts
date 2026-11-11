// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteStorageUnavailableError } from './credential-store.js';
import type * as RelayClient from './relay-client.js';
import type { RelayOptions } from './relay-capture.test-support.js';
import {
  client,
  connected,
  deferred,
  fixture,
  flush,
  type Fixture,
} from './runtime.test-support.js';

const { captured, resetCaptured } = await vi.hoisted(
  () => import('./relay-capture.test-support.js'),
);
vi.mock('./relay-client.js', async (original) => ({
  ...(await original<typeof RelayClient>()),
  createRemoteRelayClient: (options: RelayOptions) => {
    captured.options = options;
    return captured.relay;
  },
}));
beforeEach(resetCaptured);

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

  // Rolling audit 2026-10-21 01-P2-4: a failed save used to leave the old record,
  // so the revoked phone regained control on the next launch.
  const revocations: ReadonlyArray<
    readonly [string, (f: Fixture, clientId: string) => Promise<unknown>, string | null]
  > = [
    ['Disable', (f) => f.runtime.configure(false), null],
    ['Revoke', (f, clientId) => f.runtime.revoke(clientId), 'client.revoke'],
    ['Revoke all', (f) => f.runtime.revokeAll(), 'clients.revokeAll'],
  ];
  describe.each(revocations)('%s whose save fails', (_label, act, sent) => {
    it('fails closed across a restart and shows the real error', async () => {
      const f = fixture();
      const [approved] = await connected(f, [client(['read', 'control'])]);
      vi.mocked(f.store.write).mockRejectedValueOnce(new Error('EBUSY: rename'));
      await expect(act(f, approved!.id)).rejects.toThrow('could not be saved securely');
      if (sent !== null)
        expect(captured.relay.send.mock.calls.map(([m]) => m.type)).toContain(sent);
      expect(f.store.discard).toHaveBeenCalledOnce();
      expect(f.saved()).toBeNull();
      expect(f.runtime.status()).toMatchObject({ available: false, enabled: false });
      expect(f.runtime.status().error).toContain('saved pairing removed');
      // Detaching and reattaching the renderer closes the relay again.
      f.runtime.closed();
      expect(f.runtime.status().error).toContain('saved pairing removed');

      const relaunched = fixture(f.saved());
      captured.relay.start.mockClear();
      await relaunched.runtime.opened();
      expect(captured.relay.start).not.toHaveBeenCalled();
      expect(relaunched.runtime.status().enabled).toBe(false);
      relaunched.runtime.closed();
    });

    it('says so when the saved record cannot be removed either', async () => {
      const f = fixture();
      const [approved] = await connected(f, [client(['read', 'control'])]);
      vi.mocked(f.store.write).mockRejectedValueOnce(new Error('EBUSY: rename'));
      vi.mocked(f.store.discard).mockResolvedValueOnce(false);
      await expect(act(f, approved!.id)).rejects.toThrow('could not be removed');
      expect(f.runtime.status()).toMatchObject({ available: false, connected: false });
      expect(f.runtime.status().error).toContain('may reconnect after a restart');
      expect(f.runtime.status().error).not.toContain('EBUSY');
      expect(f.options.canRequest(approved!.id, ['read', 'control'])).toBe(false);
      f.runtime.closed();
    });
  });

  it('keeps the real error when a confirmed revocation cannot be cleared from storage', async () => {
    const f = fixture();
    await connected(f);
    await f.runtime.revokeAll();
    const requestId = captured.relay.send.mock.calls.findLast(
      ([m]) => m.type === 'clients.revokeAll',
    )![0].requestId;
    vi.mocked(f.store.write).mockRejectedValueOnce(new Error('EBUSY: rename'));
    f.options.onMessage({ type: 'clients.revoked', requestId });
    await vi.waitFor(() => expect(f.runtime.status().available).toBe(false));
    expect(f.runtime.status().error).toBe('Remote settings could not be saved securely.');
    // The queued revocation is still saved, so the next launch repeats it.
    expect(f.saved()).toMatchObject({ revokeOnConnect: true });
  });

  it('asks refused storage again at the next attach but keeps an unopenable record shut', async () => {
    const f = fixture();
    // A Linux keyring probe that failed outright, for example while the bus starts.
    vi.mocked(f.store.read).mockRejectedValueOnce(new RemoteStorageUnavailableError());
    await f.runtime.opened();
    expect(f.runtime.status()).toMatchObject({ available: false, enabled: false });
    await expect(f.runtime.configure(true)).rejects.toThrow('unavailable');
    expect(f.store.write).not.toHaveBeenCalled();
    await f.runtime.opened();
    expect(f.runtime.status()).toMatchObject({ available: true, enabled: true, error: null });
    expect(captured.relay.start).toHaveBeenCalledOnce();
    f.runtime.closed();

    const unreadable = fixture();
    vi.mocked(unreadable.store.read).mockRejectedValueOnce(new Error('authentication failed'));
    await unreadable.runtime.opened();
    await unreadable.runtime.opened();
    expect(unreadable.store.read).toHaveBeenCalledOnce();
    expect(unreadable.runtime.status().available).toBe(false);
  });
});
