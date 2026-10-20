import { describe, expect, it } from 'vitest';
import {
  checkoutUrl,
  harness,
  NOW,
  saved,
  TEST_KEY,
  token,
} from './licensing-runtime.test-support';

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
