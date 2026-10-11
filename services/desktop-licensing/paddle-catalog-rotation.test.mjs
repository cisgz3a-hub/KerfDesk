import test from 'node:test';
import assert from 'node:assert/strict';
import { nextUpdateYear } from './authority.mjs';
import { authorityRequest } from './http.mjs';
import { paddleVerifier } from './paddle.mjs';
import { claimOrder } from './payments.mjs';
import {
  checkoutOrder,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const PURCHASE_TXN = `txn_${'c'.repeat(26)}`;
const RENEWAL_TXN = `txn_${'d'.repeat(26)}`;
const NEW_PURCHASE_PRICE = `pri_${'x'.repeat(26)}`;
const NEW_RENEWAL_PRICE = `pri_${'y'.repeat(26)}`;

function rotatePrices(f) {
  f.env.PADDLE_PURCHASE_PRICE_ID = NEW_PURCHASE_PRICE;
  f.env.PADDLE_RENEWAL_PRICE_ID = NEW_RENEWAL_PRICE;
}

async function deliver(f, data, eventId = 'evt_purchase') {
  const response = await authorityRequest(
    webhookRequest(signedPaddle(f.env, data, eventId)),
    f.env,
    f.authority,
  );
  return { status: response.status, body: await response.json() };
}

test('paid purchases and renewals use their original catalogue after price rotation and checkout closure', async () => {
  for (const operation of ['purchase', 'renewal']) {
    const f = await fixture();
    try {
      f.env.PAYMENTS_ENABLED = 'true';
      let body = { operation };
      if (operation === 'renewal') {
        const purchase = await checkoutOrder(f, deviceId(71));
        assert.equal((await deliver(f, paddleTransaction(f.env, purchase.intent))).status, 200);
        body = { ...body, ...(await claimOrder(f.authority, purchase.checkout)) };
      }
      const id = operation === 'purchase' ? PURCHASE_TXN : RENEWAL_TXN;
      const { checkout, intent } = await checkoutOrder(f, deviceId(72), body, id);
      const paid = paddleTransaction(f.env, intent, { id });
      const orderBefore = f.records.get(`order:${checkout.orderId}`);
      rotatePrices(f);
      f.env.PAYMENTS_ENABLED = 'false';

      const results = await Promise.all(
        Array.from({ length: 5 }, () => deliver(f, paid, 'evt_rotated')),
      );
      assert.ok(results.every(({ status, body: result }) => status === 200 && !result.rejected));
      assert.equal(results.filter(({ body: result }) => result.duplicate === false).length, 1);
      const claimed = await claimOrder(f.authority, checkout);
      assert.equal(claimed.licenseId, orderBefore.licenseId);
      assert.deepEqual(await claimOrder(f.authority, checkout), claimed);
      const license = f.records.get(`license:${claimed.licenseId}`);
      assert.equal(license.tier, 'paid');
      assert.equal(
        license.updatesUntil,
        operation === 'purchase' ? nextUpdateYear(NOW) : nextUpdateYear(nextUpdateYear(NOW)),
      );
      assert.equal(f.records.get(`order:${checkout.orderId}`).priceId, orderBefore.priceId);
      assert.equal(f.records.get(`payment-rejected:paddle:${id}`), undefined);
    } finally {
      f.database.close();
    }
  }
});

test('historical order amounts are validated against the stored offer, never supplied by the webhook', async () => {
  const f = await fixture();
  try {
    f.env.PAYMENTS_ENABLED = 'true';
    const { checkout, intent } = await checkoutOrder(f, deviceId(73));
    // Represent an order saved by an earlier catalogue at USD45.00. The current
    // catalogue remains USD49.50, while this customer's original offer is durable.
    const orderKey = `order:${checkout.orderId}`;
    f.records.put(orderKey, { ...f.records.get(orderKey), amount: 4500 });
    const paid = paddleTransaction(f.env, intent);
    paid.items[0].price.unit_price.amount = '4500';
    paid.details.totals.subtotal = '4500';
    paid.details.totals.total = '4700';
    rotatePrices(f);
    const result = await deliver(f, paid);
    assert.deepEqual(result, { status: 200, body: { received: true, duplicate: false } });
    assert.equal(f.records.get(orderKey).amount, 4500);
    assert.equal(typeof (await claimOrder(f.authority, checkout)).licenseKey, 'string');
  } finally {
    f.database.close();
  }
});

test('rotation never authorises a substituted price, amount, currency, operation, proof or transaction', async () => {
  const changes = [
    (data) => {
      data.items[0].price.id = NEW_PURCHASE_PRICE;
    },
    (data) => {
      data.items[0].price.unit_price.amount = '2000';
      data.details.totals.subtotal = '2000';
      data.details.totals.total = '2200';
    },
    (data) => {
      data.currency_code = 'EUR';
      data.items[0].price.unit_price.currency_code = 'EUR';
      data.details.totals.currency_code = 'EUR';
    },
    (data) => {
      data.custom_data.kerfdesk_operation = 'renewal';
    },
    (data) => {
      data.custom_data.kerfdesk_order_proof = deviceId(99);
    },
    (data) => {
      data.id = RENEWAL_TXN;
    },
  ];
  for (const change of changes) {
    const f = await fixture();
    try {
      f.env.PAYMENTS_ENABLED = 'true';
      const { checkout, intent } = await checkoutOrder(f, deviceId(74));
      const data = paddleTransaction(f.env, intent);
      rotatePrices(f);
      change(data);
      const result = await deliver(f, data);
      assert.equal(result.status, 200);
      assert.equal(result.body.rejected, true);
      const order = f.records.get(`order:${checkout.orderId}`);
      assert.equal(f.records.get(`license:${order.licenseId}`), undefined);
      await assert.rejects(claimOrder(f.authority, checkout));
    } finally {
      f.database.close();
    }
  }
});

test('new orders use the current price and cannot accept the preceding catalogue price', async () => {
  const f = await fixture();
  try {
    f.env.PAYMENTS_ENABLED = 'true';
    const oldPrice = f.env.PADDLE_PURCHASE_PRICE_ID;
    rotatePrices(f);
    const { checkout, intent } = await checkoutOrder(f, deviceId(75));
    assert.equal(f.records.get(`order:${checkout.orderId}`).priceId, NEW_PURCHASE_PRICE);
    const paid = paddleTransaction(f.env, intent);
    paid.items[0].price.id = oldPrice;
    assert.equal((await deliver(f, paid)).body.rejected, true);
    paid.items[0].price.id = NEW_PURCHASE_PRICE;
    assert.deepEqual((await deliver(f, paid)).body, { received: true, duplicate: false });
    assert.equal(typeof (await claimOrder(f.authority, checkout)).licenseKey, 'string');
  } finally {
    f.database.close();
  }
});

test('order snapshots are not read before Paddle signature verification', async () => {
  const f = await fixture();
  try {
    const signed = signedPaddle(
      f.env,
      paddleTransaction(f.env, {
        orderId: 'untrusted-order',
        operation: 'purchase',
      }),
    );
    const verifier = paddleVerifier(f.env, () => assert.fail('Unverified order lookup'));
    await assert.rejects(verifier(signed.headers, `${signed.raw} `, NOW), {
      code: 'invalid_payment_signature',
    });
  } finally {
    f.database.close();
  }
});
