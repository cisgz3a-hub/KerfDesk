import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { licensingConfigFromMetadata, type LicensingConfig } from './licensing-config';
import { LicenceStoreUnreadableError } from './licensing-store';
import { verifyEntitlement, verifyLicenceRelease } from './licensing-verification';

import {
  keys,
  NOW,
  device,
  token,
  envelope,
  claims,
  release,
  harness,
  saved,
  trialClaims,
  grant,
  TEST_KEY,
  WRONG_KEY,
} from './licensing-runtime.test-support';

describe('offline Ed25519 entitlement verification', () => {
  it('rejects tampering, an unknown key, wrong device and malformed rights', () => {
    const signed = envelope(claims());
    expect(verifyEntitlement(signed, keys, device)?.tier).toBe('paid');
    expect(
      verifyEntitlement(
        {
          ...signed,
          payload: Buffer.from(JSON.stringify(claims({ tier: 'developer' }))).toString('base64url'),
        },
        keys,
        device,
      ),
    ).toBeNull();
    expect(verifyEntitlement({ ...signed, keyId: 'network-key' }, keys, device)).toBeNull();
    expect(verifyEntitlement(signed, keys, 'b'.repeat(43))).toBeNull();
    expect(
      verifyEntitlement(envelope(claims({ perpetualUpdates: true })), keys, device),
    ).toBeNull();
  });
  it('separates signed release identities from update manifests and entitlement tokens', () => {
    expect(verifyLicenceRelease(release(), keys)?.version).toBe('1.0.0');
    expect(verifyLicenceRelease(release('update-manifest'), keys)).toBeNull();
    expect(verifyLicenceRelease(release(), keys, 'update-manifest')).toBeNull();
    expect(verifyLicenceRelease(envelope(claims()), keys)).toBeNull();
  });
  it('keeps packages without commercial metadata Free and rejects malformed opt-in metadata', async () => {
    expect(licensingConfigFromMetadata({ version: '1.0.0' })).toEqual({ channel: 'free' });
    expect(licensingConfigFromMetadata({ kerfdeskCommercialLicense: false })).toEqual({
      channel: 'invalid',
    });
    const h = harness();
    const runtime = createLicensingRuntime({ ...h.options, config: { channel: 'free' } });
    expect(await runtime.status()).toMatchObject({ channel: 'free', edition: 'free' });
    expect(runtime.proUnlocked()).toBe(false);
    expect(await runtime.startTrial()).toMatchObject({ channel: 'free', edition: 'free' });
    expect(await runtime.activate(TEST_KEY)).toMatchObject({ edition: 'free' });
    expect(h.store.read).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('locks only Pro when a commercial build has no valid release identity', async () => {
    const h = harness(saved());
    const runtime = createLicensingRuntime({ ...h.options, config: { channel: 'invalid' } });
    expect(await runtime.status()).toMatchObject({ state: 'unavailable', edition: 'free' });
    expect(runtime.proUnlocked()).toBe(false);
  });
});

describe('commercial edition (ADR-540)', () => {
  it('opens as Free without a licence and never calls the service to do so', async () => {
    const h = harness();
    expect(await h.runtime.status()).toMatchObject({
      channel: 'commercial',
      edition: 'free',
      state: 'activation-required',
      tier: null,
    });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.runtime.proUnlocked()).toBe(false);
  });
  it('remembers an expired trial check before a clock rollback', async () => {
    const expiry = NOW / 1000 + 30 * 86_400;
    const h = harness(
      saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
    );
    h.clock(expiry * 1000);
    expect(await h.runtime.status()).toMatchObject({ state: 'trial-expired' });
    h.clock((expiry - 600) * 1000);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      state: 'clock-error',
      edition: 'free',
    });
  });
  it('reanchors a corrected trial clock only from a newly issued authenticated grant', async () => {
    const h = harness({ ...saved(trialClaims()), lastSeenAt: NOW / 1000 + 86_400 });
    h.fetch.mockResolvedValue(grant(trialClaims()));
    expect(await h.runtime.status()).toMatchObject({ state: 'clock-error', edition: 'free' });
    expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(h.saved()?.lastSeenAt).toBe(NOW / 1000);
    const original = h.saved()?.credential;
    h.fetch.mockResolvedValueOnce(grant(trialClaims({ issuedAt: NOW / 1000 - 600 })));
    const skewed = await h.runtime.refresh();
    // The service answered: the clock is the problem, not the connection.
    expect(skewed).toMatchObject({ state: 'clock-error', tier: 'trial' });
    expect(skewed.message).toContain('about 10 minutes ahead');
    expect(h.saved()?.credential).toEqual(original);
    await h.runtime.status();
    expect(h.runtime.isReleaseEligibleCached(release('update-manifest'), '1.0.0')).toBe(false);
  });
  it('sends a bounded printable device name accepted by the service', async () => {
    const h = harness();
    await createLicensingRuntime({ ...h.options, deviceName: 'x'.repeat(100) }).startTrial();
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body)).deviceName).toBe('x'.repeat(80));
    await createLicensingRuntime({ ...h.options, deviceName: '\r\n\0' }).startTrial();
    expect(JSON.parse(String(h.fetch.mock.calls[1]?.[1].body)).deviceName).toBe('KerfDesk device');
  });
  it('keeps Pro in a covered version offline even after updates expire', async () => {
    const h = harness(saved(claims({ updatesUntil: NOW / 1000 - 10 })));
    h.clock(NOW + 29 * 86_400_000);
    expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(
      await h.runtime.isReleaseEligible(
        release('update-manifest', '2027-01-01T00:00:00.000Z', '2.0.0'),
        '2.0.0',
      ),
    ).toBe(false);
  });
  it('requires administrator-signed developer rights and grants permanent updates offline', async () => {
    const h = harness(
      saved(claims({ tier: 'developer', perpetualUpdates: true, updatesUntil: null })),
    );
    h.clock(NOW + 1000 * 86_400_000);
    expect(await h.runtime.status()).toMatchObject({ tier: 'developer', edition: 'pro' });
    expect(
      await h.runtime.isReleaseEligible(
        release('update-manifest', '2029-01-01T00:00:00.000Z', '2.0.0'),
        '2.0.0',
      ),
    ).toBe(true);
    expect(
      await h.runtime.isReleaseEligible(
        release('update-manifest', '2029-01-01T00:00:00.000Z', '2.0.0'),
        '3.0.0',
      ),
    ).toBe(false);
  });
  it.each(['wall', 'elapsed'] as const)(
    'ends new Pro access at the trial deadline using %s time',
    async (source) => {
      const expiry = NOW / 1000 + 30 * 86_400;
      let elapsed = 0;
      const elapsedClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
      const h = harness(
        saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
      );
      try {
        expect(await h.runtime.status()).toMatchObject({ edition: 'pro' });
        if (source === 'wall') h.clock(expiry * 1000);
        else {
          h.clock(NOW - 60_000);
          elapsed = 30 * 86_400_000;
        }
        expect(h.runtime.proUnlocked()).toBe(false);
        h.clock((expiry - 60) * 1000);
        expect(h.runtime.proUnlocked()).toBe(false);
        expect(await h.runtime.status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
        expect(h.saved()?.lastSeenAt).toBe(expiry);
        h.clock(expiry * 1000);
        expect(await createLicensingRuntime(h.options).status()).toMatchObject({
          state: 'trial-expired',
          edition: 'free',
        });
      } finally {
        elapsedClock.mockRestore();
      }
    },
  );
  it('never returns unbounded Pro on a trial store failure while preserving paid session rights', async () => {
    const trial = harness(saved(trialClaims()));
    const paid = harness(saved());
    for (const h of [trial, paid]) {
      expect(await h.runtime.status()).toMatchObject({ edition: 'pro' });
      h.store.read.mockRejectedValue(new Error('storage unavailable'));
    }
    expect(await trial.runtime.status()).toMatchObject({ edition: 'free', state: 'unavailable' });
    expect(trial.runtime.proUnlocked()).toBe(false);
    expect(await paid.runtime.status()).toMatchObject({ edition: 'pro', state: 'unavailable' });
    expect(paid.runtime.proUnlocked()).toBe(true);
  });
  it('holds only a trial to its clock marks, and locks Pro in a version newer than the licence covers', async () => {
    const covered = release('update-manifest', '2026-09-28T00:00:00.000Z', '1.1.0');
    const paid = harness({ ...saved(), lastSeenAt: NOW / 1000 + 20 * 86_400 });
    paid.clock(NOW - 200_000);
    expect(await paid.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(await paid.runtime.isReleaseEligible(covered, '1.1.0')).toBe(true);
    const developer = harness({
      ...saved(claims({ tier: 'developer', perpetualUpdates: true, updatesUntil: null })),
      lastSeenAt: NOW / 1000 + 30 * 86_400,
    });
    expect(await developer.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    const trial = harness(saved(trialClaims()));
    trial.clock(NOW - 600_000);
    expect(await trial.runtime.status()).toMatchObject({ state: 'clock-error', edition: 'free' });
    expect((await trial.runtime.status()).message).toContain('Set time automatically');
    expect(await trial.runtime.isReleaseEligible(covered, '1.1.0')).toBe(false);
    const old = harness(
      saved(claims({ updatesUntil: Date.parse('2026-08-01T00:00:00.000Z') / 1000 })),
    );
    expect(await old.runtime.status()).toMatchObject({
      state: 'updates-expired',
      edition: 'free',
    });
    expect((await old.runtime.status()).message).toContain('2026-08-01');
  });
  it('keeps the bearer out of public summaries and rejects malformed server grants', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      Response.json({ entitlement: { payload: 'forged' }, activationToken: token }),
    );
    expect(await h.runtime.activate(TEST_KEY)).toMatchObject({
      state: 'unavailable',
      edition: 'free',
    });
    expect(h.saved()).toBeNull();
    const good = harness(saved());
    expect(JSON.stringify(await good.runtime.status())).not.toContain(token);
    expect(JSON.stringify(await good.runtime.status())).not.toContain('license-1');
  });
  it('saves an offline deactivation retry, locks Pro at once and never claims the seat was freed', async () => {
    const h = harness(saved());
    expect(await h.runtime.status()).toMatchObject({ edition: 'pro' });
    h.fetch.mockRejectedValue(new Error('offline'));
    expect(await h.runtime.deactivate()).toMatchObject({
      deactivationPending: true,
      edition: 'free',
    });
    expect(h.saved()?.credential).toBeUndefined();
    expect(h.saved()?.pendingDeactivation).toBeDefined();
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      state: 'activation-required',
      edition: 'free',
    });
    h.fetch.mockResolvedValue(Response.json({ deactivated: true }));
    expect(await h.runtime.deactivate()).toMatchObject({
      deactivationPending: false,
      edition: 'free',
    });
  });
});

describe('licence key and recovery (ADR-523 Amendment 1)', () => {
  it('keeps the activated key so a buyer can copy it for their other devices', async () => {
    const h = harness();
    const status = await h.runtime.activate(`  ${TEST_KEY}  `);
    expect(status).toMatchObject({ edition: 'pro', licenseKey: TEST_KEY });
    expect(h.saved()?.licenseKey).toBe(TEST_KEY);
    expect(JSON.stringify(status)).not.toContain(token);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      licenseKey: TEST_KEY,
    });
  });
  it('never saves a trial or a rejected activation as a licence key', async () => {
    const h = harness();
    await h.runtime.startTrial();
    expect(h.saved()?.licenseKey).toBeUndefined();
    const refused = harness();
    refused.fetch.mockResolvedValue(
      Response.json({ error: { code: 'invalid_credentials' } }, { status: 401 }),
    );
    expect(await refused.runtime.activate(WRONG_KEY)).toMatchObject({
      licenseKey: null,
      message: 'This licence key was not accepted. Check the key and try again.',
    });
    expect(refused.saved()).toBeNull();
  });
  it('falls back to Free with a reset when the saved licence cannot be read', async () => {
    const h = harness(saved());
    h.store.read
      .mockRejectedValueOnce(new LicenceStoreUnreadableError())
      .mockRejectedValueOnce(new LicenceStoreUnreadableError());
    expect(await h.runtime.status()).toMatchObject({
      state: 'invalid-licence',
      edition: 'free',
      storeUnreadable: true,
    });
    const reset = await h.runtime.resetStore();
    expect(h.store.reset).toHaveBeenCalledOnce();
    expect(reset).toMatchObject({
      state: 'activation-required',
      storeUnreadable: false,
    });
    expect(reset.message).toContain('cleared');
  });
  it('removes rights only when the service says the licence was cancelled or the seat released', async () => {
    const released = harness({ ...saved(), licenseKey: TEST_KEY });
    released.fetch.mockResolvedValue(
      Response.json({ error: { code: 'activation_inactive' } }, { status: 403 }),
    );
    expect(await released.runtime.refresh()).toMatchObject({
      state: 'activation-required',
      licenseKey: TEST_KEY,
    });
    expect(released.saved()?.credential).toBeUndefined();
    const revoked = harness({ ...saved(), licenseKey: TEST_KEY });
    revoked.fetch.mockResolvedValue(
      Response.json({ error: { code: 'license_revoked' } }, { status: 403 }),
    );
    expect((await revoked.runtime.refresh()).message).toContain('cancelled');
    expect(revoked.saved()?.credential).toBeUndefined();
    expect(revoked.saved()?.licenseKey).toBeUndefined();
    const outage = harness(saved());
    outage.fetch.mockResolvedValue(
      Response.json({ error: { code: 'internal_error' } }, { status: 500 }),
    );
    expect(await outage.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(outage.saved()?.credential).toBeDefined();
  });
  it('keeps this device active when the service refuses another seat move', async () => {
    const h = harness(saved());
    h.fetch.mockResolvedValue(
      Response.json({ error: { code: 'release_limit_reached' } }, { status: 429 }),
    );
    const status = await h.runtime.deactivate();
    expect(status).toMatchObject({ state: 'ready', edition: 'pro', deactivationPending: false });
    expect(status.message).toContain('too often');
    expect(h.saved()?.credential).toBeDefined();
    expect(h.saved()?.pendingDeactivation).toBeUndefined();
  });
  it('confirms saved paid rights in the background about once a week', async () => {
    const fresh = harness({ ...saved(), refreshedAt: NOW / 1000 - 6 * 86_400 });
    await fresh.runtime.refreshInBackground();
    expect(fresh.fetch).not.toHaveBeenCalled();
    const due = harness({ ...saved(), refreshedAt: NOW / 1000 - 7 * 86_400 });
    await due.runtime.refreshInBackground();
    expect(due.fetch).toHaveBeenCalledOnce();
    expect(String(due.fetch.mock.calls[0]?.[0])).toContain('/v1/activations/refresh');
    expect(due.saved()?.refreshedAt).toBe(NOW / 1000);
    const unlicensed = harness();
    await unlicensed.runtime.refreshInBackground();
    expect(unlicensed.fetch).not.toHaveBeenCalled();
  });
});

describe('Buy Pro opens the purchase page', () => {
  it('opens only the first-party purchase page, saves no order and makes no service call', async () => {
    const h = harness();
    const openPurchasePage = vi.fn(async (_url: string) => undefined);
    const runtime = createLicensingRuntime({ ...h.options, openPurchasePage });
    const result = await runtime.openPurchasePage();
    expect(openPurchasePage).toHaveBeenCalledExactlyOnceWith('https://kerfdesk.com/buy.html');
    expect(result).toMatchObject({ state: 'activation-required', paymentPending: false });
    expect(result.message).toContain('enter it here');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.saved()).toBeNull();
  });
  it('tells the buyer the address when the browser cannot be opened, and offers nothing to a developer licence', async () => {
    const h = harness();
    const failing = createLicensingRuntime({
      ...h.options,
      openPurchasePage: async () => {
        throw new Error('no browser');
      },
    });
    expect((await failing.openPurchasePage()).message).toContain('https://kerfdesk.com/buy');
    const developer = harness(
      saved(claims({ tier: 'developer', updatesUntil: null, perpetualUpdates: true })),
    );
    const open = vi.fn(async (_url: string) => undefined);
    const result = await createLicensingRuntime({
      ...developer.options,
      openPurchasePage: open,
    }).openPurchasePage();
    expect(open).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tier: 'developer', message: null });
  });
});

it('keeps sandbox purchase recovery on the sandbox page if the browser cannot open', async () => {
  const h = harness();
  const runtime = createLicensingRuntime({
    ...h.options,
    config: { ...h.options.config, sandbox: true } as LicensingConfig,
    openPurchasePage: async () => {
      throw new Error('browser unavailable');
    },
  });
  const result = await runtime.openPurchasePage();
  expect(result.message).toContain(
    'https://kerfdesk-desktop-licensing-sandbox.cisgz3a.workers.dev/buy.html',
  );
  expect(result.message).not.toContain('https://kerfdesk.com');
  expect(h.fetch).not.toHaveBeenCalled();
});
