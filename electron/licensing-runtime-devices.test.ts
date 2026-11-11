import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { type LicenceRecord } from './licensing-store';
import { type LicenceClaims } from './licensing-verification';

import {
  NOW,
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
  OTHER_KEY,
} from './licensing-runtime.test-support';

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
    // A paid grant never reads the clock (ADR-623 Amendment 2); a developer grant still does.
    const h = harness();
    h.fetch.mockResolvedValue(
      grant(
        claims({
          tier: 'developer',
          perpetualUpdates: true,
          updatesUntil: null,
          issuedAt: NOW / 1000 + 2 * 3600,
        }),
      ),
    );
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
  it('saves observed trial progress each second and paid progress every five minutes', async () => {
    const paid = harness(saved());
    paid.clock(NOW + 299_000);
    await paid.runtime.status();
    expect(paid.store.write).not.toHaveBeenCalled();
    paid.clock(NOW + 3_600_000);
    await paid.runtime.status();
    expect(paid.saved()?.lastSeenAt).toBe(NOW / 1000 + 3600);
    expect(paid.store.write).toHaveBeenCalledOnce();
    await paid.runtime.status();
    expect(paid.store.write).toHaveBeenCalledOnce();
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
