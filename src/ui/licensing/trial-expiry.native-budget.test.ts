import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenceStatus } from '../../platform/types';
import { createTrialExpiryClock, expireTrialStatus } from './trial-expiry';

const EXPIRY = 2_000_000_000;
let elapsed = 0;
const trial = (patch: Partial<LicenceStatus> = {}): LicenceStatus => ({
  channel: 'commercial',
  edition: 'pro',
  state: 'ready',
  tier: 'trial',
  accessExpiresAt: EXPIRY,
  updatesUntil: EXPIRY,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((EXPIRY - 150) * 1000);
  elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('renderer remaining trial budget from native retained time', () => {
  it('uses the native 90-second bound despite 150 seconds remaining on the corrected wall clock', () => {
    const status = trial({ trialExpiresInMs: 90_000 });
    const clock = createTrialExpiryClock();
    expect(clock.remainingMs(status)).toBe(90_000);
    elapsed = 89_000;
    expect(expireTrialStatus(status, clock)).toBe(status);
    elapsed = 90_000;
    expect(expireTrialStatus(status, clock)).toMatchObject({
      state: 'trial-expired',
      edition: 'free',
      accessExpiresAt: EXPIRY,
    });
  });

  it('never restarts the bound when cached rights or another status with the same expiry is read', () => {
    const status = trial({ trialExpiresInMs: 90_000 });
    const clock = createTrialExpiryClock();
    expect(clock.remainingMs(status)).toBe(90_000);
    elapsed = 31_000;
    expect(clock.remainingMs(status)).toBe(59_000);
    expect(clock.remainingMs({ ...status })).toBe(59_000);
    elapsed = 90_000;
    expect(clock.remainingMs({ ...status, trialExpiresInMs: 150_000 })).toBe(0);
    expect(clock.remainingMs(trial())).toBe(0);
  });

  it('accepts a smaller new native observation without enlarging it on later rereads', () => {
    const clock = createTrialExpiryClock();
    expect(clock.remainingMs(trial({ trialExpiresInMs: 90_000 }))).toBe(90_000);
    elapsed = 20_000;
    const revised = trial({ trialExpiresInMs: 40_000 });
    expect(clock.remainingMs(revised)).toBe(40_000);
    elapsed = 60_000;
    expect(expireTrialStatus(revised, clock).edition).toBe('free');
  });

  it('keeps the earlier observed wall deadline after forward time is corrected again', () => {
    const status = trial({ trialExpiresInMs: 90_000 });
    const clock = createTrialExpiryClock();
    expect(clock.remainingMs(status)).toBe(90_000);
    vi.setSystemTime((EXPIRY + 1) * 1000);
    expect(expireTrialStatus(status, clock).edition).toBe('free');
    vi.setSystemTime((EXPIRY - 150) * 1000);
    expect(expireTrialStatus(status, clock).edition).toBe('free');
  });

  it('retains legacy wall and elapsed checks when the native field is absent', () => {
    const status = trial();
    const clock = createTrialExpiryClock();
    expect(clock.remainingMs(status)).toBe(150_000);
    elapsed = 150_000;
    expect(expireTrialStatus(status, clock).edition).toBe('free');
  });

  it.each(['paid', 'developer'] as const)(
    'keeps %s access independent of an ended trial clock',
    (tier) => {
      const clock = createTrialExpiryClock();
      expect(clock.remainingMs(trial({ trialExpiresInMs: 0 }))).toBe(0);
      const paid = trial({
        tier,
        accessExpiresAt: null,
        perpetualUpdates: tier === 'developer',
      });
      expect(clock.remainingMs(paid)).toBe(Infinity);
      expect(expireTrialStatus(paid, clock)).toBe(paid);
    },
  );
});
