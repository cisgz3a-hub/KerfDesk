import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityRequest } from './http.mjs';
import { claimOrder } from './payments.mjs';
import {
  adminRequest,
  checkoutOrder,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  request,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const TXN = `txn_${'c'.repeat(26)}`;
const OTHER_TXN = `txn_${'d'.repeat(26)}`;

async function paymentsFixture() {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const deliver = async (data, eventId = 'evt_test', at = NOW) => {
    const response = await authorityRequest(
      webhookRequest(signedPaddle(f.env, data, eventId, at)),
      f.env,
      f.authority,
    );
    return { status: response.status, body: await response.json() };
  };
  const count = (prefix) =>
    f.database.prepare('SELECT COUNT(*) AS n FROM records WHERE key LIKE ?').get(`${prefix}%`).n;
  const lookup = async (body) =>
    (
      await authorityRequest(
        adminRequest('/v1/admin/licenses/lookup', body, f.env.ADMIN_TOKEN),
        f.env,
        f.authority,
      )
    ).json();
  return { ...f, deliver, count, lookup };
}

test('a completed transaction without a KerfDesk order is acknowledged and ignored', async () => {
  const f = await paymentsFixture();
  const foreign = [
    paddleTransaction(f.env, { operation: 'purchase' }, { custom_data: null }),
    paddleTransaction(f.env, { operation: 'purchase' }, { custom_data: { other_app: 'x' } }),
    paddleTransaction(
      f.env,
      { operation: 'purchase' },
      { custom_data: { kerfdesk_order_id: 'not an id!', kerfdesk_operation: 'purchase' } },
    ),
  ];
  for (const data of foreign)
    assert.deepEqual(await f.deliver(data), {
      status: 200,
      body: { received: true, ignored: true },
    });
  assert.equal(f.count(''), 0);
});

test('a refused payment is recorded once: the claim says payment_rejected and lookup shows why', async () => {
  const f = await paymentsFixture();
  const { checkout, intent } = await checkoutOrder(f, deviceId(30));
  const discounted = paddleTransaction(f.env, intent, {
    discount_id: 'dsc_launch',
    details: {
      totals: {
        subtotal: '4950',
        discount: '495',
        tax: '200',
        total: '4655',
        currency_code: 'USD',
      },
    },
  });
  assert.deepEqual(await f.deliver(discounted), {
    status: 200,
    body: { received: true, rejected: true, duplicate: false },
  });
  const record = f.records.get(`payment-rejected:paddle:${TXN}`);
  assert.deepEqual(
    { ...record, totals: undefined },
    {
      transactionId: TXN,
      orderId: checkout.orderId,
      eventId: 'evt_test',
      operation: 'purchase',
      code: 'payment_mismatch',
      totals: undefined,
      at: NOW,
    },
  );
  assert.equal(record.totals.discount, '495');
  assert.equal(record.totals.discountId, 'dsc_launch');
  assert.deepEqual(record.totals.items, [{ priceId: f.env.PADDLE_PURCHASE_PRICE_ID, quantity: 1 }]);
  const order = f.records.get(`order:${checkout.orderId}`);
  assert.equal(order.status, 'rejected');
  assert.deepEqual(order.rejection, { code: 'payment_mismatch', transactionId: TXN });
  assert.equal(f.records.get(`license:${order.licenseId}`), undefined);
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'payment_rejected' });
  const claim = await authorityRequest(
    request('/v1/orders/claim', { orderId: checkout.orderId, claimToken: checkout.claimToken }),
    f.env,
    f.authority,
  );
  assert.equal(claim.status, 409);
  assert.deepEqual(await claim.json(), { error: { code: 'payment_rejected' } });
  // Paddle's redelivery, a replay with a new event ID, and concurrent copies all
  // leave the first record as it was.
  f.setNow(NOW + 2);
  assert.deepEqual((await f.deliver(discounted, 'evt_test', NOW + 2)).body, {
    received: true,
    rejected: true,
    duplicate: true,
  });
  const copies = await Promise.all(
    Array.from({ length: 4 }, () => f.deliver(discounted, 'evt_replayed', NOW + 2)),
  );
  assert.ok(copies.every(({ status, body }) => status === 200 && body.duplicate === true));
  assert.equal(f.count('payment-rejected:'), 1);
  assert.equal(f.records.get(`payment-rejected:paddle:${TXN}`).at, NOW);
  // Support finds it by order number or by Paddle's transaction ID.
  const byOrder = await f.lookup({ orderId: checkout.orderId });
  assert.equal(byOrder.orderStatus, 'rejected');
  assert.equal(byOrder.rejection.code, 'payment_mismatch');
  assert.equal(byOrder.rejection.totals.total, '4655');
  assert.equal(byOrder.licenseKey, undefined);
  const byTransaction = await f.lookup({ transactionId: TXN });
  assert.equal(byTransaction.orderId, checkout.orderId);
  assert.equal(byTransaction.rejection.eventId, 'evt_test');
});

test('a refusal found at fulfilment is recorded, and a replay after support fixes it fulfils', async () => {
  const f = await paymentsFixture();
  const purchase = await checkoutOrder(f, deviceId(31));
  await f.deliver(paddleTransaction(f.env, purchase.intent), 'evt_purchase');
  const { licenseId, licenseKey } = await claimOrder(f.authority, purchase.checkout);
  const renewal = await checkoutOrder(
    f,
    deviceId(32),
    { operation: 'renewal', licenseKey },
    OTHER_TXN,
  );
  // Revoked (a disputed charge, say) between checkout and payment.
  await f.authority.setLicenseStatus({ licenseId, status: 'revoked' });
  const paid = paddleTransaction(f.env, renewal.intent, { id: OTHER_TXN });
  assert.deepEqual((await f.deliver(paid, 'evt_renewal')).body, {
    received: true,
    rejected: true,
    duplicate: false,
  });
  assert.equal(
    f.records.get(`payment-rejected:paddle:${OTHER_TXN}`).code,
    'renewal_requires_paid_license',
  );
  await assert.rejects(claimOrder(f.authority, renewal.checkout), { code: 'payment_rejected' });
  const before = f.records.get(`license:${licenseId}`).updatesUntil;
  await f.authority.setLicenseStatus({ licenseId, status: 'active' });
  assert.deepEqual((await f.deliver(paid, 'evt_renewal')).body, {
    received: true,
    duplicate: false,
  });
  assert.ok(f.records.get(`license:${licenseId}`).updatesUntil > before);
  assert.equal((await claimOrder(f.authority, renewal.checkout)).licenseKey, licenseKey);
  assert.equal(f.records.get(`order:${renewal.checkout.orderId}`).status, 'fulfilled');
});

test('payments for unknown orders or without the order proof are recorded but never mark an order', async () => {
  const f = await paymentsFixture();
  const unknown = paddleTransaction(f.env, { orderId: 'no-such-order', operation: 'purchase' });
  assert.equal((await f.deliver(unknown, 'evt_unknown')).body.rejected, true);
  assert.equal(f.records.get(`payment-rejected:paddle:${TXN}`).code, 'unknown_order');
  const found = await f.lookup({ transactionId: TXN });
  assert.equal(found.orderStatus, null);
  assert.equal(found.rejection.orderId, 'no-such-order');
  // A second transaction that names a real order without its proof.
  const { checkout, intent } = await checkoutOrder(f, deviceId(33));
  const named = paddleTransaction(
    f.env,
    { ...intent, orderProof: deviceId(99) },
    { id: OTHER_TXN },
  );
  assert.equal((await f.deliver(named, 'evt_named')).body.rejected, true);
  assert.equal(f.records.get(`payment-rejected:paddle:${OTHER_TXN}`).code, 'payment_mismatch');
  assert.equal(f.records.get(`order:${checkout.orderId}`).status, 'pending');
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'payment_pending' });
  // The order's own payment still fulfils it.
  assert.equal(
    (await f.deliver(paddleTransaction(f.env, intent), 'evt_own')).body.duplicate,
    false,
  );
  assert.match((await claimOrder(f.authority, checkout)).licenseKey, /^KD1\./u);
  // A reused event ID is not a payment refusal: it still fails for Paddle to retry.
  const third = `txn_${'e'.repeat(26)}`;
  const other = await checkoutOrder(f, deviceId(35), { operation: 'purchase' }, third);
  const reused = await f.deliver(paddleTransaction(f.env, other.intent, { id: third }), 'evt_own');
  assert.equal(reused.status, 409);
  assert.deepEqual(reused.body, { error: { code: 'idempotency_conflict' } });
  assert.equal(f.records.get(`payment-rejected:paddle:${third}`), undefined);
});

test('support recovers a genuine payment for an order the service lost, as the playbook says', async () => {
  const f = await paymentsFixture();
  const orderId = f.authority.crypto.id();
  const paid = paddleTransaction(f.env, {
    orderId,
    operation: 'purchase',
    orderProof: deviceId(40),
  });
  assert.equal((await f.deliver(paid, 'evt_lost')).body.rejected, true);
  assert.equal(f.records.get(`payment-rejected:paddle:${TXN}`).code, 'unknown_order');
  const recorded = await authorityRequest(
    adminRequest(
      '/v1/admin/orders',
      { orderId, provider: 'paddle', providerOrderId: TXN, operation: 'purchase' },
      f.env.ADMIN_TOKEN,
    ),
    f.env,
    f.authority,
  );
  const { claimToken } = await recorded.json();
  assert.deepEqual((await f.deliver(paid, 'evt_lost')).body, { received: true, duplicate: false });
  assert.match((await claimOrder(f.authority, { orderId, claimToken })).licenseKey, /^KD1\./u);
  const found = await f.lookup({ transactionId: TXN });
  assert.equal(found.orderStatus, 'fulfilled');
  assert.equal(found.rejection.code, 'unknown_order');
});

test('a second payment for a paid order is recorded while the order keeps its licence', async () => {
  const f = await paymentsFixture();
  const { checkout, intent } = await checkoutOrder(f, deviceId(34));
  await f.deliver(paddleTransaction(f.env, intent), 'evt_first');
  const { licenseKey } = await claimOrder(f.authority, checkout);
  const copy = paddleTransaction(f.env, intent, { id: OTHER_TXN });
  assert.equal((await f.deliver(copy, 'evt_copy')).body.rejected, true);
  assert.equal(f.records.get(`payment-rejected:paddle:${OTHER_TXN}`).orderId, checkout.orderId);
  assert.equal(f.records.get(`order:${checkout.orderId}`).status, 'fulfilled');
  assert.equal((await claimOrder(f.authority, checkout)).licenseKey, licenseKey);
  // Replaying the payment that fulfilled the order is still a plain duplicate.
  assert.deepEqual((await f.deliver(paddleTransaction(f.env, intent), 'evt_first')).body, {
    received: true,
    duplicate: true,
  });
  assert.equal(f.count('payment-rejected:'), 1);
});
