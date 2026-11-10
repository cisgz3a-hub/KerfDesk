import { describe, expect, it } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';

import {
  NOW,
  token,
  checkoutUrl,
  envelope,
  claims,
  harness,
  saved,
  grant,
  TEST_KEY,
} from './licensing-runtime.test-support';

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
