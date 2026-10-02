import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenceStatus } from '../types';
import { createDesktopLicenceAdapter, parseLicenceStatus } from './licensing';

const legacy: LicenceStatus = {
  channel: 'commercial',
  edition: 'pro',
  state: 'ready',
  tier: 'trial',
  accessExpiresAt: 2_000_000_000,
  updatesUntil: 2_000_000_000,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
let elapsed = 0;

beforeEach(() => {
  elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
});

afterEach(() => vi.restoreAllMocks());

describe('desktop native trial-budget contract', () => {
  it('carries a bounded native duration through the actual desktop adapter', async () => {
    const status = { ...legacy, trialExpiresInMs: 90_000 };
    const adapter = createDesktopLicenceAdapter(async () => Response.json(status));
    expect(await adapter.status()).toEqual(status);
    expect(parseLicenceStatus({ ...legacy, trialExpiresInMs: 0 }).trialExpiresInMs).toBe(0);
  });

  it('accepts a legacy trial response and unchanged paid or developer responses', () => {
    expect(parseLicenceStatus(legacy)).toBe(legacy);
    for (const tier of ['paid', 'developer']) {
      const status = {
        ...legacy,
        tier,
        accessExpiresAt: null,
        perpetualUpdates: tier === 'developer',
      };
      expect(parseLicenceStatus(status)).toBe(status);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.5, null, '90000'])(
    'rejects an invalid native remaining duration %s',
    (trialExpiresInMs) => {
      expect(() => parseLicenceStatus({ ...legacy, trialExpiresInMs })).toThrow(
        'Invalid licence response',
      );
    },
  );

  it.each(['paid', 'developer'] as const)('refuses a trial-only duration on %s rights', (tier) => {
    expect(() =>
      parseLicenceStatus({ ...legacy, tier, accessExpiresAt: null, trialExpiresInMs: 90_000 }),
    ).toThrow('Invalid licence response');
  });

  it('subtracts request and JSON-delivery time rather than renewing the native budget', async () => {
    const status = { ...legacy, trialExpiresInMs: 90_000 };
    const adapter = createDesktopLicenceAdapter(async () => {
      elapsed += 10_000;
      return {
        ok: true,
        json: async () => {
          elapsed += 5_000;
          return status;
        },
      } as Response;
    });
    expect(await adapter.status()).toEqual({ ...status, trialExpiresInMs: 75_000 });
    expect(status.trialExpiresInMs).toBe(90_000);
  });

  it('clamps a trial that ends during response delivery to zero', async () => {
    const adapter = createDesktopLicenceAdapter(async () => {
      elapsed += 100_000;
      return Response.json({ ...legacy, trialExpiresInMs: 90_000 });
    });
    expect((await adapter.refresh()).trialExpiresInMs).toBe(0);
  });

  it.each(['trial', 'paid', 'developer'] as const)(
    'keeps a delayed legacy %s response unchanged when no native budget was supplied',
    async (tier) => {
      const status = {
        ...legacy,
        tier,
        accessExpiresAt: tier === 'trial' ? legacy.accessExpiresAt : null,
      };
      const adapter = createDesktopLicenceAdapter(async () => {
        elapsed += 100_000;
        return Response.json(status);
      });
      expect(await adapter.activate('test-key')).toEqual(status);
    },
  );
});
