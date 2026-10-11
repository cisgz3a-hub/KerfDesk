// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import {
  claims,
  device,
  envelope,
  grant,
  harness,
  NOW,
  release,
  saved,
  TEST_KEY,
  token,
  trialClaims,
} from './licensing-runtime.test-support';

const trial = () => harness(saved(trialClaims()));

describe('a paid purchase replaces an active trial only after verified, durable activation', () => {
  it('keeps the existing trial and key entry available after an incomplete pasted key', async () => {
    const h = trial();
    const before = h.saved();
    expect(await h.runtime.activate('short')).toMatchObject({
      state: 'ready',
      edition: 'pro',
      tier: 'trial',
      accessExpiresAt: trialClaims().accessExpiresAt,
      licenseKey: null,
    });
    expect(h.saved()).toEqual(before);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'malformed entitlement',
      () => ({ entitlement: { payload: 'forged' }, activationToken: token }),
    ],
    [
      'wrong device',
      () => ({
        entitlement: envelope(claims({ deviceId: 'x'.repeat(43) })),
        activationToken: token,
      }),
    ],
    [
      'invalid signature',
      () => ({
        entitlement: { ...envelope(claims()), signature: Buffer.alloc(64).toString('base64url') },
        activationToken: token,
      }),
    ],
    ['missing activation token', () => ({ entitlement: envelope(claims()) })],
  ] as const)('preserves verified trial rights after a %s response', async (_name, answer) => {
    const h = trial();
    const before = h.saved();
    h.fetch.mockResolvedValue(Response.json(answer()));
    const rejected = await h.runtime.activate(TEST_KEY);
    expect(rejected).toMatchObject({
      state: 'ready',
      edition: 'pro',
      tier: 'trial',
      licenseKey: null,
      accessExpiresAt: trialClaims().accessExpiresAt,
    });
    expect(rejected.message).not.toBeNull();
    expect(rejected.trialExpiresInMs).toBeGreaterThan(0);
    expect(h.saved()).toEqual(before);
    expect(h.runtime.isReleaseEligibleCached(release('update-manifest'), '1.0.0')).toBe(false);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      tier: 'trial',
      edition: 'pro',
    });
  });

  it.each(['offline', 'rejected'] as const)(
    'preserves the trial when paid activation is %s',
    async (failure) => {
      const h = trial();
      const before = h.saved();
      if (failure === 'offline') h.fetch.mockRejectedValue(new Error('offline'));
      else
        h.fetch.mockResolvedValue(
          Response.json({ error: { code: 'invalid_license' } }, { status: 403 }),
        );
      expect(await h.runtime.activate(TEST_KEY)).toMatchObject({
        tier: 'trial',
        edition: 'pro',
        licenseKey: null,
      });
      expect(h.saved()).toEqual(before);
    },
  );

  it('retains the trial if the paid grant cannot be saved', async () => {
    const h = trial();
    const before = h.saved();
    h.fetch.mockResolvedValue(grant());
    h.store.write.mockRejectedValueOnce(new Error('disk full'));
    expect(await h.runtime.activate(TEST_KEY)).toMatchObject({
      tier: 'trial',
      edition: 'pro',
      licenseKey: null,
    });
    expect(h.saved()).toEqual(before);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      tier: 'trial',
      edition: 'pro',
    });
  });

  it('retains the bounded trial when both paid activation and its clock checkpoint cannot be saved', async () => {
    const h = trial();
    expect(await h.runtime.status()).toMatchObject({ tier: 'trial', edition: 'pro' });
    const before = h.saved();
    h.clock(NOW + 1_000);
    h.store.write.mockRejectedValue(new Error('disk remains full'));
    const result = await h.runtime.activate(TEST_KEY);
    expect(result).toMatchObject({
      tier: 'trial',
      state: 'ready',
      edition: 'pro',
      licenseKey: null,
      accessExpiresAt: trialClaims().accessExpiresAt,
    });
    expect(result.trialExpiresInMs).toBeLessThanOrEqual(20 * 86_400_000 - 1_000);
    expect(h.store.write).toHaveBeenCalledTimes(2);
    expect(h.saved()).toEqual(before);
    expect(h.runtime.proUnlocked()).toBe(true);
    expect(h.runtime.isReleaseEligibleCached(release('update-manifest'), '1.0.0')).toBe(false);
    // Recovery is specific to activation. Ordinary checkpoints still fail closed.
    expect(await h.runtime.status()).toMatchObject({ state: 'unavailable', edition: 'free' });
    expect(h.runtime.proUnlocked()).toBe(false);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      state: 'unavailable',
      edition: 'free',
    });
  });

  it.each([false, true])(
    'does not revive an expired trial after persistent writes fail and clock rollback (active session: %s)',
    async (activeSession) => {
      const h = trial();
      if (activeSession)
        expect(await h.runtime.status()).toMatchObject({ tier: 'trial', edition: 'pro' });
      const expiry = trialClaims().accessExpiresAt!;
      h.clock(expiry * 1000);
      h.fetch.mockResolvedValue(grant(claims({ issuedAt: expiry })));
      h.store.write.mockRejectedValue(new Error('disk remains full'));
      expect(await h.runtime.activate(TEST_KEY)).toMatchObject({
        tier: 'trial',
        state: 'trial-expired',
        edition: 'free',
        trialExpiresInMs: 0,
      });
      h.clock(NOW + 1_000);
      h.fetch.mockResolvedValue(Response.json({ entitlement: { payload: 'forged' } }));
      expect(await h.runtime.activate(TEST_KEY)).toMatchObject({
        tier: 'trial',
        state: 'trial-expired',
        edition: 'free',
        trialExpiresInMs: 0,
      });
      expect(h.runtime.proUnlocked()).toBe(false);
      expect(h.saved()?.lastSeenAt).toBe(NOW / 1000);
      expect(h.saved()?.licenseKey).toBeUndefined();
    },
  );

  it('does not soften a grant clock error when its trial checkpoint cannot be saved', async () => {
    const h = trial();
    expect(await h.runtime.status()).toMatchObject({ tier: 'trial', edition: 'pro' });
    h.clock(NOW + 1_000);
    h.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 + 600 })));
    h.store.write.mockRejectedValue(new Error('disk remains full'));
    expect(await h.runtime.activate(TEST_KEY)).toMatchObject({ edition: 'free' });
    expect(h.runtime.proUnlocked()).toBe(false);
    expect(h.saved()?.licenseKey).toBeUndefined();
  });

  it('reports paid rights only after saving, then retains them through an offline restart', async () => {
    const h = trial();
    expect(await h.runtime.status()).toMatchObject({ tier: 'trial', edition: 'pro' });
    const before = h.saved();
    const persist = h.store.write.getMockImplementation()!;
    let completeSave: (() => void) | undefined;
    h.store.write.mockImplementationOnce(async (next) => {
      await new Promise<void>((resolve) => {
        completeSave = resolve;
      });
      await persist(next);
    });
    const activation = h.runtime.activate(TEST_KEY);
    await vi.waitFor(() => expect(completeSave).toBeDefined());
    expect(h.saved()).toEqual(before);
    expect(h.runtime.proUnlocked()).toBe(true);
    completeSave?.();
    expect(await activation).toMatchObject({ tier: 'paid', edition: 'pro', licenseKey: TEST_KEY });
    expect(h.saved()?.licenseKey).toBe(TEST_KEY);
    expect(
      JSON.parse(Buffer.from(h.saved()!.credential!.entitlement.payload, 'base64url').toString()),
    ).toMatchObject({ deviceId: device, tier: 'paid' });
    h.fetch.mockClear().mockRejectedValue(new Error('offline after restart'));
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      tier: 'paid',
      edition: 'pro',
      licenseKey: TEST_KEY,
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('does not extend a trial that expires while a paid response is pending', async () => {
    const h = trial();
    let answer: ((response: Response) => void) | undefined;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const activation = h.runtime.activate(TEST_KEY);
    await vi.waitFor(() => expect(answer).toBeDefined());
    h.clock(NOW + 21 * 86_400_000);
    answer?.(Response.json({ entitlement: { payload: 'forged' }, activationToken: token }));
    expect(await activation).toMatchObject({
      tier: 'trial',
      state: 'trial-expired',
      edition: 'free',
      trialExpiresInMs: 0,
    });
    expect(h.saved()?.licenseKey).toBeUndefined();
  });
});
