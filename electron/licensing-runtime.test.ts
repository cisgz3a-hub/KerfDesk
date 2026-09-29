import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { licensingConfigFromMetadata, type LicensingConfig } from './licensing-config';
import type { LicenceRecord } from './licensing-store';
import {
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
} from './licensing-verification';

const pair = generateKeyPairSync('ed25519');
const keys = { test: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const NOW = Date.parse('2026-09-28T00:00:00.000Z');
const device = createHash('sha256').update('test-device').digest('base64url');
const token = Buffer.alloc(32, 7).toString('base64url');
const checkoutUrl = `https://kerfdesk.com/buy.html?_ptxn=txn_${'a'.repeat(26)}`;

function envelope(value: unknown, release = false) {
  const payload = Buffer.from(JSON.stringify(value));
  const encoding = release ? 'base64' : 'base64url';
  return {
    ...(release ? { schemaVersion: 1, algorithm: 'Ed25519' } : {}),
    keyId: 'test',
    payload: payload.toString(encoding),
    signature: sign(null, payload, pair.privateKey).toString(encoding),
  };
}
function claims(patch: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    licenseId: 'license-1',
    activationId: 'activation-1',
    deviceId: device,
    tier: 'paid',
    issuedAt: NOW / 1000,
    accessExpiresAt: null,
    updatesUntil: NOW / 1000 + 365 * 86_400,
    perpetualUpdates: false,
    maxDevices: 3,
    ...patch,
  };
}
function release(
  kind: 'release-identity' | 'update-manifest' = 'release-identity',
  publishedAt = '2026-09-01T00:00:00.000Z',
  version = '1.0.0',
) {
  return envelope(
    {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind,
      channel: 'stable',
      version,
      sourceSha: 'a'.repeat(40),
      sourceRef: 'refs/tags/v1.0.0',
      publishedAt,
    },
    true,
  );
}
function harness(initial: LicenceRecord | null = null) {
  let saved = initial;
  let clock = NOW;
  const store = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: LicenceRecord) => {
      saved = structuredClone(value);
    }),
  };
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ entitlement: envelope(claims()), activationToken: token }),
  );
  const openCheckout = vi.fn(async (_url: string) => undefined);
  const onSessionAuthorized = vi.fn();
  const config: LicensingConfig = {
    channel: 'commercial',
    apiOrigin: 'https://licensing.example',
    entitlementKeys: keys,
    releaseKeys: keys,
    release: release(),
  };
  const options = {
    config,
    currentVersion: '1.0.0',
    store,
    deviceId: async () => device,
    deviceName: 'Test device',
    fetch,
    openCheckout,
    now: () => clock,
    onSessionAuthorized,
  };
  return {
    runtime: createLicensingRuntime(options),
    options,
    store,
    fetch,
    openCheckout,
    onSessionAuthorized,
    saved: () => saved,
    clock: (value: number) => {
      clock = value;
    },
  };
}
function saved(claim: LicenceClaims = claims()): LicenceRecord {
  return {
    schemaVersion: 1,
    lastSeenAt: NOW / 1000,
    credential: { entitlement: envelope(claim), activationToken: token },
  };
}

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
  it('defaults existing MIT packages to free but rejects malformed opt-in metadata', async () => {
    expect(licensingConfigFromMetadata({ version: '1.0.0' })).toEqual({ channel: 'free' });
    expect(licensingConfigFromMetadata({ kerfdeskCommercialLicense: false })).toEqual({
      channel: 'invalid',
    });
    const h = harness();
    const runtime = createLicensingRuntime({ ...h.options, config: { channel: 'free' } });
    expect(await runtime.launch()).toMatchObject({ channel: 'free', sessionAuthorized: true });
    await runtime.startTrial();
    expect(h.store.read).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('commercial launch admission', () => {
  it('remembers an expired trial check before a clock rollback at the gate', async () => {
    const expiry = NOW / 1000 + 30 * 86_400;
    const h = harness(
      saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
    );
    h.clock(expiry * 1000);
    expect(await h.runtime.status()).toMatchObject({ state: 'trial-expired' });
    h.clock((expiry - 600) * 1000);
    expect(await createLicensingRuntime(h.options).launch()).toMatchObject({
      state: 'clock-error',
      sessionAuthorized: false,
    });
  });
  it('reanchors a corrected clock only from a newly issued authenticated grant', async () => {
    const h = harness({ ...saved(), lastSeenAt: NOW / 1000 + 86_400 });
    expect(await h.runtime.status()).toMatchObject({ state: 'clock-error' });
    expect(await h.runtime.refresh()).toMatchObject({ state: 'ready' });
    expect(h.saved()?.lastSeenAt).toBe(NOW / 1000);
    expect(await h.runtime.launch()).toMatchObject({ sessionAuthorized: true });
    const original = h.saved()?.credential;
    h.fetch.mockResolvedValueOnce(
      Response.json({
        entitlement: envelope(claims({ issuedAt: NOW / 1000 - 600 })),
        activationToken: token,
      }),
    );
    expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable' });
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
  it('starts a paid eligible version offline even after updates expire', async () => {
    const h = harness(saved(claims({ updatesUntil: NOW / 1000 - 10 })));
    h.clock(NOW + 500 * 86_400_000);
    expect(await h.runtime.launch()).toMatchObject({ state: 'ready', sessionAuthorized: true });
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
    expect(await h.runtime.launch()).toMatchObject({ tier: 'developer', sessionAuthorized: true });
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
  it('checks trial expiry at new launch without withdrawing an admitted session', async () => {
    const expiry = NOW / 1000 + 30 * 86_400;
    const h = harness(
      saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
    );
    expect(await h.runtime.launch()).toMatchObject({ sessionAuthorized: true });
    h.clock(expiry * 1000);
    expect(await h.runtime.status()).toMatchObject({
      state: 'trial-expired',
      sessionAuthorized: true,
    });
    expect(await h.runtime.launch()).toMatchObject({ sessionAuthorized: true });
    expect(h.onSessionAuthorized).toHaveBeenCalledTimes(1);
    expect(await createLicensingRuntime(h.options).launch()).toMatchObject({
      state: 'trial-expired',
      sessionAuthorized: false,
    });
  });
  it('does not break admission when the one-shot update callback fails', async () => {
    const h = harness(saved());
    h.onSessionAuthorized.mockImplementation(() => {
      throw new Error('updater unavailable');
    });
    expect(await h.runtime.launch()).toMatchObject({ sessionAuthorized: true });
  });
  it('rejects clock rollback and an ineligible installed version', async () => {
    const h = harness(saved());
    h.clock(NOW - 600_000);
    expect(await h.runtime.launch()).toMatchObject({
      state: 'clock-error',
      sessionAuthorized: false,
    });
    const old = harness(
      saved(claims({ updatesUntil: Date.parse('2026-08-01T00:00:00.000Z') / 1000 })),
    );
    expect(await old.runtime.launch()).toMatchObject({
      state: 'updates-expired',
      sessionAuthorized: false,
    });
  });
  it('keeps licence and bearer out of public summaries and rejects malformed server grants', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      Response.json({ entitlement: { payload: 'forged' }, activationToken: token }),
    );
    expect(await h.runtime.activate('KD1.test-secret')).toMatchObject({
      state: 'unavailable',
      sessionAuthorized: false,
    });
    expect(h.saved()).toBeNull();
    const good = harness(saved());
    expect(JSON.stringify(await good.runtime.status())).not.toContain(token);
    expect(JSON.stringify(await good.runtime.status())).not.toContain('license-1');
  });
  it('saves an offline deactivation retry without claiming its seat was freed or closing the session', async () => {
    const h = harness(saved());
    await h.runtime.launch();
    h.fetch.mockRejectedValue(new Error('offline'));
    expect(await h.runtime.deactivate()).toMatchObject({
      deactivationPending: true,
      sessionAuthorized: true,
    });
    expect(h.saved()?.credential).toBeUndefined();
    expect(h.saved()?.pendingDeactivation).toBeDefined();
    expect(await createLicensingRuntime(h.options).launch()).toMatchObject({
      state: 'activation-required',
      sessionAuthorized: false,
    });
    h.fetch.mockResolvedValue(Response.json({ deactivated: true }));
    expect(await h.runtime.deactivate()).toMatchObject({
      deactivationPending: false,
      sessionAuthorized: true,
    });
  });
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
      sessionAuthorized: false,
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
        return Response.json({ licenseId: 'license-1', licenseKey: 'KD1.test-secret' });
      return Response.json({ entitlement: envelope(claims()), activationToken: token });
    });
    await h.runtime.checkout('purchase');
    expect(await h.runtime.status()).toMatchObject({ state: 'activation-required' });
    expect(await h.runtime.claimPayment()).toMatchObject({ state: 'ready', paymentPending: false });
    expect(h.saved()?.payment).toBeUndefined();
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
      if (url.endsWith('/v1/orders/claim')) return Response.json({ licenseKey: 'KD1.test-secret' });
      return Response.json({ error: { code: 'device_limit' } }, { status: 409 });
    });
    await h.runtime.checkout('purchase');
    expect(await h.runtime.claimPayment()).toMatchObject({ paymentPending: true, tier: 'trial' });
    expect(h.saved()?.payment).toBeDefined();
  });
});

describe('synchronous eligibility at update installation', () => {
  const candidate = release('update-manifest', '2026-09-28T00:00:00.000Z', '1.1.0');
  it('rechecks trial time at quit while leaving the admitted workspace open', async () => {
    const expiry = NOW / 1000 + 1000;
    const h = harness(
      saved(claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry })),
    );
    await h.runtime.launch();
    expect(await h.runtime.isReleaseEligible(candidate, '1.1.0')).toBe(true);
    h.clock(expiry * 1000);
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    expect(h.runtime.sessionAuthorized()).toBe(true);
  });
  it('invalidates immediately when deactivation is requested, before its network promise settles', async () => {
    const h = harness(saved());
    await h.runtime.launch();
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
    resolve(Response.json({ deactivated: true }));
    await deactivation;
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    expect(h.runtime.sessionAuthorized()).toBe(true);
  });
  it('replaces cached rights only with a verified grant, and fails closed after authentication failure', async () => {
    const h = harness(saved());
    await h.runtime.launch();
    expect(await h.runtime.isReleaseEligible(candidate, '1.1.0')).toBe(true);
    h.fetch.mockResolvedValueOnce(
      Response.json({
        entitlement: envelope(claims({ updatesUntil: NOW / 1000 - 1 })),
        activationToken: token,
      }),
    );
    const replacement = h.runtime.activate('KD1.other-secret');
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    await replacement;
    expect(h.runtime.isReleaseEligibleCached(candidate, '1.1.0')).toBe(false);
    h.fetch.mockResolvedValueOnce(Response.json({ error: { code: 'revoked' } }, { status: 403 }));
    await h.runtime.refresh();
    await h.runtime.status();
    expect(h.runtime.isReleaseEligibleCached(release('update-manifest'), '1.0.0')).toBe(false);
  });
});
