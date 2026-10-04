import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererMachineAuthorities } from './renderer-machine-authority';
import type { RemoteAccessStatus } from './remote-access-store';

let clock = 0;
let expires = 100;
let current: RemoteAccessStatus;
let owns = true;
let authorities: ReturnType<typeof createRendererMachineAuthorities>;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  expires = 100;
  owns = true;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  current = {
    statusRevision: 1,
    available: true,
    enabled: true,
    connected: true,
    deviceId: 'device',
    controlUrl: 'https://example.test/control',
    mcpUrl: 'https://example.test/mcp',
    pairing: null,
    pairingPending: false,
    requests: [],
    error: null,
    clients: [
      { id: 'client', label: 'Phone', scopes: ['read', 'control'], controlExpiresInMs: 100 },
    ],
  };
  authorities = createRendererMachineAuthorities(
    () => owns,
    () => ({
      ...current,
      clients: current.clients.map((client) => ({
        ...client,
        ...(client.controlExpiresInMs === undefined
          ? {}
          : { controlExpiresInMs: Math.max(0, expires - clock) }),
      })),
    }),
  );
});
afterEach(() => {
  authorities.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('captured renderer machine grants', () => {
  it('requires the separate envelope, current approval and positive remaining lease', () => {
    expect(authorities.capture('session', 'client', false)).toBeNull();
    current = {
      ...current,
      clients: [
        { id: 'client', label: 'Edit only', scopes: ['read', 'edit'], controlExpiresInMs: 100 },
      ],
    };
    expect(authorities.capture('session', 'client', true)).toBeNull();
    current = {
      ...current,
      clients: [{ id: 'client', label: 'Legacy', scopes: ['read', 'control'] }],
    };
    expect(authorities.capture('session', 'client', true)).toBeNull();
    current = {
      ...current,
      clients: [
        { id: 'client', label: 'Expired', scopes: ['read', 'control'], controlExpiresInMs: 0 },
      ],
    };
    expires = 0;
    expect(authorities.capture('session', 'client', true)).toBeNull();
  });

  it('an accepted caller expires on monotonic time even when the PC wall clock jumps', async () => {
    const grant = authorities.capture('session', 'client', true)!;
    clock = 101;
    vi.setSystemTime(new Date('2001-01-01'));
    await vi.advanceTimersByTimeAsync(100);
    expect(grant.signal.aborted).toBe(true);
    expect(() => grant.assertCurrent()).toThrow();
    expect(authorities.capture('session', 'client', true)).toBeNull();
  });

  it('a renewed positive lease authorises new requests without renewing an accepted action', () => {
    const old = authorities.capture('session', 'client', true)!;
    clock = 50;
    expires = 250;
    const renewed = authorities.capture('session', 'client', true)!;
    expect(renewed).not.toBe(old);
    clock = 101;
    expect(() => old.assertCurrent()).toThrow();
    expect(() => renewed.assertCurrent()).not.toThrow();
    clock = 251;
    expect(() => renewed.assertCurrent()).toThrow();
  });

  it('local revoke cancels every captured generation and stale status cannot undo it', () => {
    const first = authorities.capture('session', 'client', true)!;
    clock = 25;
    expires = 250;
    const renewed = authorities.capture('session', 'client', true)!;
    authorities.revoke('client');
    expect(first.signal.aborted).toBe(true);
    expect(renewed.signal.aborted).toBe(true);
    expect(authorities.capture('session', 'client', true)).toBeNull();
    current = {
      ...current,
      clients: [
        { id: 'fresh', label: 'New pairing', scopes: ['read', 'control'], controlExpiresInMs: 100 },
      ],
    };
    expect(authorities.capture('session', 'fresh', true)).not.toBeNull();
  });

  it('disconnect and loss of the renderer owner invalidate preparation after its RPC settled', () => {
    const grant = authorities.capture('session', 'client', true)!;
    current = { ...current, connected: false };
    authorities.observe();
    expect(grant.signal.aborted).toBe(true);
    current = { ...current, connected: true };
    owns = false;
    expect(authorities.capture('session', 'client', true)).toBeNull();
  });

  it('a thirty-day grant splits timers and never becomes a one-millisecond timeout', async () => {
    expires = 30 * 24 * 60 * 60 * 1000;
    const grant = authorities.capture('session', 'client', true)!;
    clock = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(grant.signal.aborted).toBe(false);
    clock = 2_147_483_647;
    await vi.advanceTimersByTimeAsync(2_147_482_647);
    expect(grant.signal.aborted).toBe(false);
    clock = expires;
    await vi.advanceTimersByTimeAsync(expires - 2_147_483_647);
    expect(grant.signal.aborted).toBe(true);
  });
});
