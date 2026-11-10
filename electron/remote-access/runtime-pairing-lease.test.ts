// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RelayClient from './relay-client.js';
import type { RelayOptions } from './relay-capture.test-support.js';
import { connected, fixture, identity, pairingMessage } from './runtime.test-support.js';

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
