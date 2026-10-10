import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { licensingConfigFromMetadata, type LicensingConfig } from './licensing-config';
import { LicenceStoreUnreadableError, type LicenceRecord } from './licensing-store';
import {
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
} from './licensing-verification';

import {
  keys,
  NOW,
  device,
  token,
  checkoutUrl,
  envelope,
  claims,
  release,
  harness,
  saved,
  trialClaims,
  grant,
  TEST_KEY,
  WRONG_KEY,
  OTHER_KEY,
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
    h.clock(NOW + 500 * 86_400_000);
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
  it('holds only a trial to the clock, and locks Pro in a version newer than the licence covers', async () => {
    const covered = release('update-manifest', '2026-09-28T00:00:00.000Z', '1.1.0');
    const paid = harness({ ...saved(), lastSeenAt: NOW / 1000 + 30 * 86_400 });
    paid.clock(NOW - 600_000);
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
  it('confirms saved rights in the background about once a week', async () => {
    const fresh = harness({ ...saved(), refreshedAt: NOW / 1000 - 3 * 86_400 });
    await fresh.runtime.refreshInBackground();
    expect(fresh.fetch).not.toHaveBeenCalled();
    const due = harness({ ...saved(), refreshedAt: NOW / 1000 - 8 * 86_400 });
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

describe('main-owned payment proof', () => {
  it('persists the idempotency key and order proof before opening only the approved checkout page', async () => {
    const h = harness();
    h.fetch.mockImplementation(async (url, init) => {
      expect(url.endsWith('/v1/checkout')).toBe(true);
      const body = JSON.parse(String(init.body));
      expect(body.requestId).toBe(h.saved()?.payment?.requestId);
      return Response.json({
        orderId: 'order-1',
        claimToken: token,
        checkoutUrl,
        amount: 4950,
        currency: 'USD',
      });
    });
    h.openCheckout.mockImplementation(async (url) => {
      expect(h.saved()?.payment?.order?.checkoutUrl).toBe(url);
    });
    expect(await h.runtime.checkout('purchase')).toMatchObject({
      paymentPending: true,
      paymentOrderId: 'order-1',
      edition: 'free',
    });
    expect(h.openCheckout).toHaveBeenCalledExactlyOnceWith(checkoutUrl);
    expect(JSON.stringify(await h.runtime.status())).not.toContain(token);
  });
  it('retries ambiguous checkout with the same idempotency key and rejects arbitrary browser URLs', async () => {
    const h = harness();
    h.fetch.mockRejectedValueOnce(new Error('response lost'));
    await h.runtime.checkout('purchase');
    const id = h.saved()?.payment?.requestId;
    h.fetch.mockResolvedValue(
      Response.json({
        orderId: 'order-1',
        claimToken: token,
        checkoutUrl: 'https://evil.example',
        amount: 4950,
        currency: 'USD',
      }),
    );
    await h.runtime.checkout('purchase');
    expect(JSON.parse(String(h.fetch.mock.calls[1]?.[1].body)).requestId).toBe(id);
    expect(h.openCheckout).not.toHaveBeenCalled();
  });
  it('grants a licence only after server payment proof and verified device activation', async () => {
    const h = harness();
    h.fetch.mockImplementation(async (url) => {
      if (url.endsWith('/v1/checkout'))
        return Response.json({
          orderId: 'order-1',
          claimToken: token,
          checkoutUrl,
          amount: 4950,
          currency: 'USD',
        });
      if (url.endsWith('/v1/orders/claim'))
        return Response.json({ licenseId: 'license-1', licenseKey: TEST_KEY });
      return Response.json({ entitlement: envelope(claims()), activationToken: token });
    });
    await h.runtime.checkout('purchase');
    expect(await h.runtime.status()).toMatchObject({ state: 'activation-required' });
    const claimed = await h.runtime.claimPayment();
    expect(claimed).toMatchObject({
      state: 'ready',
      edition: 'pro',
      paymentPending: false,
      licenseKey: TEST_KEY,
    });
    expect(claimed.message).toContain('Copy your licence key');
    expect(h.saved()?.payment).toBeUndefined();
    expect(h.saved()?.licenseKey).toBe(TEST_KEY);
  });
  it('forgets a stuck order on request without touching the saved licence', async () => {
    const h = harness(saved());
    h.fetch.mockResolvedValue(
      Response.json({ error: { code: 'checkout_pending' } }, { status: 409 }),
    );
    expect(await h.runtime.checkout('renewal')).toMatchObject({ paymentPending: true });
    expect(await h.runtime.discardPayment()).toMatchObject({
      paymentPending: false,
      paymentOrderId: null,
      edition: 'pro',
    });
    expect(h.saved()?.payment).toBeUndefined();
    expect(h.saved()?.credential).toBeDefined();
  });
  it('forgets an intent the service refused before contacting the provider, so the trial stays offered', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      Response.json({ error: { code: 'payment_provider_not_configured' } }, { status: 503 }),
    );
    const refused = await h.runtime.checkout('purchase');
    expect(refused).toMatchObject({
      state: 'activation-required',
      paymentPending: false,
      paymentOrderId: null,
    });
    expect(refused.message).toContain('not available yet');
    expect(h.saved()?.payment).toBeUndefined();
    expect(h.openCheckout).not.toHaveBeenCalled();
  });
  it.each([
    ['purchase', 'payment_provider_not_configured'],
    ['renewal', 'payment_provider_not_configured'],
    ['renewal', 'invalid_credentials'],
    ['renewal', 'license_revoked'],
    ['renewal', 'activation_inactive'],
  ] as const)(
    'retains a lost %s answer through a later %s refusal and restart',
    async (operation, code) => {
      const h = harness();
      let serverRequest: Record<string, unknown> | undefined;
      h.fetch.mockImplementationOnce(async (_url, init) => {
        // The provider/server accepted the order, but the response was lost.
        serverRequest = JSON.parse(String(init.body)) as Record<string, unknown>;
        throw new TypeError('response lost after order creation');
      });
      await h.runtime.checkout(operation, 'KD1.synthetic-key');
      const original = structuredClone(h.saved()?.payment);
      expect(original?.requestId).toBe(serverRequest?.requestId);
      expect(original?.order).toBeUndefined();
      h.fetch.mockResolvedValueOnce(Response.json({ error: { code } }, { status: 503 }));
      const restarted = createLicensingRuntime(h.options);
      expect(await restarted.checkout(operation, 'KD1.synthetic-key')).toMatchObject({
        paymentPending: true,
        paymentOrderId: null,
      });
      expect(h.saved()?.payment).toEqual(original);
      h.fetch.mockResolvedValueOnce(
        Response.json({
          orderId: 'accepted-order',
          claimToken: token,
          checkoutUrl,
          amount: operation === 'purchase' ? 4950 : 2000,
          currency: 'USD',
        }),
      );
      expect(await restarted.checkout('purchase')).toMatchObject({
        paymentPending: true,
        paymentOrderId: 'accepted-order',
      });
      expect(
        h.fetch.mock.calls.slice(0, 3).map(([, init]) => JSON.parse(String(init.body))),
      ).toEqual([serverRequest, serverRequest, serverRequest]);
      h.fetch.mockResolvedValueOnce(Response.json({ licenseKey: 'KD1.synthetic-key' }));
      h.fetch.mockResolvedValueOnce(grant());
      expect(await restarted.claimPayment()).toMatchObject({
        edition: 'pro',
        paymentPending: false,
      });
    },
  );
  it('keeps a saved order when the provider is later switched off, so the payment can still be claimed', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(
      Response.json({
        orderId: 'order-1',
        claimToken: token,
        checkoutUrl,
        amount: 4950,
        currency: 'USD',
      }),
    );
    await h.runtime.checkout('purchase');
    h.fetch.mockResolvedValue(
      Response.json({ error: { code: 'payment_provider_not_configured' } }, { status: 503 }),
    );
    // Reopening the saved checkout needs no service call; the order survives either way.
    expect(await h.runtime.checkout('purchase')).toMatchObject({
      paymentPending: true,
      paymentOrderId: 'order-1',
    });
    expect(h.saved()?.payment?.order?.orderId).toBe('order-1');
  });
  it('does not discard an order when paid activation fails but an old trial is still usable', async () => {
    const h = harness(
      saved(
        claims({
          tier: 'trial',
          accessExpiresAt: NOW / 1000 + 1000,
          updatesUntil: NOW / 1000 + 1000,
        }),
      ),
    );
    h.fetch.mockImplementation(async (url) => {
      if (url.endsWith('/v1/checkout'))
        return Response.json({
          orderId: 'order-1',
          claimToken: token,
          checkoutUrl,
          amount: 4950,
          currency: 'USD',
        });
      if (url.endsWith('/v1/orders/claim')) return Response.json({ licenseKey: TEST_KEY });
      return Response.json({ error: { code: 'device_limit_reached' } }, { status: 409 });
    });
    await h.runtime.checkout('purchase');
    expect(await h.runtime.claimPayment()).toMatchObject({ paymentPending: true, tier: 'trial' });
    expect(h.saved()?.payment).toBeDefined();
  });
});

describe('device-management channel boundaries', () => {
  it.each(['free', 'invalid'] as const)(
    'never reads saved credentials or sends requests in %s builds',
    async (channel) => {
      const h = harness(saved());
      const runtime = createLicensingRuntime({ ...h.options, config: { channel } });
      expect(await runtime.devices('KD1.synthetic-key')).toMatchObject({ devices: null });
      expect(await runtime.releaseDevice('activation-1', 'KD1.synthetic-key')).toMatchObject({
        devices: null,
      });
      expect(h.store.read).not.toHaveBeenCalled();
      expect(h.store.write).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );
});

describe('activating with a pasted key', () => {
  const KEY = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
  it('activates and saves the key found inside pasted text', async () => {
    const h = harness();
    expect(
      await h.runtime.activate(`Licence key:\n${KEY.slice(0, 40)}\n${KEY.slice(40)}`),
    ).toMatchObject({ state: 'ready', licenseKey: KEY });
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body)).licenseKey).toBe(KEY);
  });
  it('explains a partial key without contacting the service', async () => {
    const h = harness();
    const result = await h.runtime.activate(KEY.slice(0, 60));
    expect(result.message).toContain('not a whole KerfDesk licence key');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('managing the licence’s devices', () => {
  const KEY = `KD1.${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'a'.repeat(43)}`;
  it('lists and frees seats with the saved key, without touching this device’s licence', async () => {
    const h = harness({ ...saved(), licenseKey: KEY });
    h.fetch.mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.licenseKey).toBe(KEY);
      if (url.endsWith('/v1/licenses/deactivate')) {
        expect(body.activationId).toBe('act-2');
        return Response.json({ deactivated: true });
      }
      expect(url.endsWith('/v1/licenses/activations')).toBe(true);
      return Response.json({
        activations: [{ activationId: 'act-2', deviceName: 'Old laptop', createdAt: 1 }],
      });
    });
    expect(await h.runtime.devices()).toEqual({
      devices: [{ activationId: 'act-2', deviceName: 'Old laptop', createdAt: 1 }],
      message: null,
    });
    const released = await h.runtime.releaseDevice('act-2');
    expect(released.message).toContain('seat is free');
    expect(h.store.write).not.toHaveBeenCalled();
    expect(await h.runtime.status()).toMatchObject({ state: 'ready', tier: 'paid' });
  });
  it('needs a key: a typed key serves an unlicensed device, and no key asks for one', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(Response.json({ activations: [] }));
    expect(await h.runtime.devices()).toMatchObject({ devices: null });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.runtime.devices(KEY)).toEqual({ devices: [], message: null });
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body))).toEqual({ licenseKey: KEY });
  });
});

describe('synchronous eligibility at update installation', () => {
  const candidate = release('update-manifest', '2026-09-28T00:00:00.000Z', '1.1.0');
  it('lets an unlicensed Free device take the newest signed release', async () => {
    const h = harness();
    await h.runtime.status();
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(true);
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.2.0')).toBe(false);
    expect(h.runtime.isReleaseEligibleCached(release(), '1.0.0')).toBe(false);
  });
  it('treats an ended trial as Free for updates and new Pro choices in the open session', async () => {
    const expiry = NOW / 1000 + 1000;
    const late = release('update-manifest', '2026-10-28T00:00:00.000Z', '1.1.0');
    const h = harness(
      saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
    );
    await h.runtime.status();
    expect(await h.runtime.isReleaseEligible(late, '1.1.0')).toBe(false);
    h.clock(expiry * 1000);
    expect(h.runtime.isReleaseEligibleCached(late, '1.1.0')).toBe(true);
    expect(h.runtime.proUnlocked()).toBe(false);
  });
  it('invalidates immediately when deactivation is requested, before its network promise settles', async () => {
    const h = harness(saved());
    await h.runtime.status();
    expect(await h.runtime.isReleaseEligible(candidate, '1.1.0')).toBe(true);
    let resolve: (response: Response) => void = () => undefined;
    h.fetch.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const deactivation = h.runtime.deactivate();
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(h.runtime.proUnlocked()).toBe(false);
    resolve(Response.json({ deactivated: true }));
    await deactivation;
    // The signed-out device runs Free, which every release includes.
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(true);
    expect(h.runtime.proUnlocked()).toBe(false);
  });
  it('replaces cached rights only with a verified grant, and fails closed after authentication failure', async () => {
    const h = harness(saved());
    await h.runtime.status();
    expect(await h.runtime.isReleaseEligible(candidate, '1.1.0')).toBe(true);
    h.fetch.mockResolvedValueOnce(
      Response.json({
        entitlement: envelope(claims({ updatesUntil: NOW / 1000 - 1 })),
        activationToken: token,
      }),
    );
    const replacement = h.runtime.activate(OTHER_KEY);
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    await replacement;
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    h.fetch.mockResolvedValueOnce(Response.json({ error: { code: 'revoked' } }, { status: 403 }));
    await h.runtime.refresh();
    await h.runtime.status();
    expect(h.runtime.isReleaseEligibleCached(release('update-manifest'), '1.0.0')).toBe(false);
  });
});

describe('clock checks and the saved clock mark (ADR-523 Amendment 2)', () => {
  it('reports a clock more than five minutes off as a clock problem, not an outage', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 + 2 * 3600 })));
    const activated = await h.runtime.activate(TEST_KEY);
    expect(activated).toMatchObject({ state: 'clock-error', edition: 'free', tier: null });
    expect(activated.message).toContain('about 2 hours behind');
    expect(activated.message).toContain('Set time automatically');
    expect(h.saved()).toBeNull();
    const trial = harness();
    trial.fetch.mockResolvedValue(grant(trialClaims({ issuedAt: NOW / 1000 - 3 * 86_400 })));
    expect((await trial.runtime.startTrial()).message).toContain('about 3 days ahead');
    expect(trial.saved()).toBeNull();
  });
  it('saves observed trial progress while avoiding unchanged and paid writes', async () => {
    const paid = harness(saved());
    paid.clock(NOW + 3_600_000);
    await paid.runtime.status();
    expect(paid.store.write).not.toHaveBeenCalled();
    const trial = harness(saved(trialClaims()));
    trial.clock(NOW + 30_000);
    await trial.runtime.status();
    expect(trial.saved()?.lastSeenAt).toBe(NOW / 1000 + 30);
    expect(trial.store.write).toHaveBeenCalledOnce();
    await trial.runtime.status();
    expect(trial.store.write).toHaveBeenCalledOnce();
    trial.clock(NOW + 61_000);
    await trial.runtime.status();
    expect(trial.saved()?.lastSeenAt).toBe(NOW / 1000 + 61);
  });
  it('moves a trial clock mark on at each quiet check without calling the service', async () => {
    const trial = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
    trial.clock(NOW + 30 * 60_000);
    expect(await trial.runtime.refreshInBackground()).toMatchObject({ state: 'ready' });
    expect(trial.fetch).not.toHaveBeenCalled();
    expect(trial.saved()?.lastSeenAt).toBe(NOW / 1000 + 1800);
    const paid = harness({ ...saved(), refreshedAt: NOW / 1000 });
    paid.clock(NOW + 30 * 60_000);
    await paid.runtime.refreshInBackground();
    expect(paid.store.write).not.toHaveBeenCalled();
  });
});

describe('a deactivation the service refuses (ADR-523 Amendment 2)', () => {
  const order = { requestId: token, operation: 'purchase' as const };
  function pending(claim: LicenceClaims = claims(), extra: Partial<LicenceRecord> = {}) {
    const credential = { entitlement: envelope(claim), activationToken: token };
    return {
      schemaVersion: 1 as const,
      lastSeenAt: NOW / 1000,
      pendingDeactivation: credential,
      ...extra,
    };
  }
  function refuse(h: ReturnType<typeof harness>, code: string, status: number) {
    h.fetch.mockResolvedValue(Response.json({ error: { code } }, { status }));
  }
  it('signs this computer out when the service no longer knows its seat, keeping any order', async () => {
    const h = harness(pending(claims(), { payment: order }));
    refuse(h, 'invalid_credentials', 401);
    const status = await h.runtime.deactivate();
    expect(status).toMatchObject({
      state: 'activation-required',
      edition: 'free',
      deactivationPending: false,
      paymentPending: true,
    });
    expect(status.message).toContain('may still count as one of your three devices');
    expect(h.saved()?.pendingDeactivation).toBeUndefined();
    expect(h.saved()?.payment).toEqual(order);
  });
  it('signs out without a request when the saved credential no longer verifies here', async () => {
    const h = harness(pending(claims({ deviceId: 'b'.repeat(43) })));
    const status = await h.runtime.deactivate();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(status).toMatchObject({ deactivationPending: false, edition: 'free' });
    expect(status.message).toContain('could not be freed');
    expect(h.saved()?.pendingDeactivation).toBeUndefined();
  });
  it('keeps retrying after an outage, a rate limit or an unclear answer', async () => {
    for (const [code, status] of [
      ['rate_limited', 429],
      ['service_unavailable', 503],
      ['invalid_request', 400],
    ] as const) {
      const h = harness(pending());
      refuse(h, code, status);
      expect(await h.runtime.deactivate()).toMatchObject({ deactivationPending: true });
      expect(h.saved()?.pendingDeactivation).toBeDefined();
    }
  });
  it('gives the licence back when a retried deactivation is refused for too many moves', async () => {
    const h = harness(pending());
    refuse(h, 'release_limit_reached', 429);
    const status = await h.runtime.deactivate();
    expect(status).toMatchObject({ state: 'ready', edition: 'pro', deactivationPending: false });
    expect(status.message).toContain('too often');
    expect(h.saved()?.credential).toBeDefined();
    expect(h.saved()?.pendingDeactivation).toBeUndefined();
  });
  it('lets an explicit activation or trial replace a pending deactivation', async () => {
    const activated = harness(pending());
    expect(await activated.runtime.activate(TEST_KEY)).toMatchObject({
      state: 'ready',
      edition: 'pro',
      deactivationPending: false,
    });
    expect(String(activated.fetch.mock.calls[0]?.[0])).toContain('/v1/licenses/activate');
    expect(activated.saved()?.pendingDeactivation).toBeUndefined();
    expect(activated.saved()?.licenseKey).toBe(TEST_KEY);
    const trial = harness(pending());
    trial.fetch.mockResolvedValue(grant(trialClaims()));
    expect(await trial.runtime.startTrial()).toMatchObject({ tier: 'trial', edition: 'pro' });
    expect(trial.saved()?.pendingDeactivation).toBeUndefined();
    const refused = harness(pending());
    refuse(refused, 'invalid_credentials', 401);
    expect(await refused.runtime.activate(WRONG_KEY)).toMatchObject({
      deactivationPending: true,
    });
  });
  it('offers Reset for a pending deactivation, keeping the saved order', async () => {
    const h = harness(pending(claims(), { payment: order }));
    const status = await h.runtime.resetStore();
    expect(h.store.reset).not.toHaveBeenCalled();
    expect(status).toMatchObject({ deactivationPending: false, paymentPending: true });
    expect(status.message).toContain('stopped trying');
    expect(h.saved()?.payment).toEqual(order);
  });
  it('never resets a saved licence that can be read', async () => {
    const h = harness(saved());
    const status = await h.runtime.resetStore();
    expect(h.store.reset).not.toHaveBeenCalled();
    expect(status).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(status.message).toContain('nothing was reset');
    expect(h.saved()?.credential).toBeDefined();
  });
});

describe('orders and checkout links (ADR-523 Amendment 2)', () => {
  it('drops an unfinished purchase when a licence key unlocks paid Pro, so Renew shows', async () => {
    const h = harness({
      schemaVersion: 1,
      lastSeenAt: NOW / 1000,
      payment: {
        requestId: token,
        operation: 'purchase',
        order: { orderId: 'order-1', claimToken: token, checkoutUrl },
      },
    });
    const status = await h.runtime.activate(TEST_KEY);
    expect(status).toMatchObject({ tier: 'paid', edition: 'pro', paymentPending: false });
    expect(status.message).toContain('order-1');
    expect(h.saved()?.payment).toBeUndefined();
    // Paying a saved renewal still renews the licence on the service, so it stays.
    const renewal = harness({
      ...saved(),
      payment: { requestId: token, operation: 'renewal', licenseKey: TEST_KEY },
    });
    expect(await renewal.runtime.activate(TEST_KEY)).toMatchObject({
      paymentPending: true,
    });
  });
  it('refuses a checkout link whose transaction ID is not lower case', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      Response.json({
        orderId: 'order-1',
        claimToken: token,
        checkoutUrl: `https://kerfdesk.com/buy.html?_ptxn=txn_${'A'.repeat(26)}`,
        amount: 4950,
        currency: 'USD',
      }),
    );
    await h.runtime.checkout('purchase');
    expect(h.openCheckout).not.toHaveBeenCalled();
    expect(h.saved()?.payment?.order).toBeUndefined();
  });
});
