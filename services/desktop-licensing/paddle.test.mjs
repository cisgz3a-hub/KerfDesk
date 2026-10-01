/* global Response, ReadableStream, structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from './checkout.mjs';
import { paddleVerifier, verifyPaddleSignature } from './paddle.mjs';
import { claimOrder, fulfilVerifiedPayment } from './payments.mjs';
import {
  deviceId,
  fixture,
  NOW,
  paddleFetcher,
  paddleTransaction,
  signedPaddle,
} from './test-support.mjs';

test('Paddle signature authenticates exact raw body, current timestamp and multiple h1 rotation signatures', async () => {
  const f = await fixture();
  const signed = signedPaddle(f.env, {});
  const header = signed.headers.get('paddle-signature');
  assert.equal(
    await verifyPaddleSignature(header, signed.raw, f.env.PADDLE_WEBHOOK_SECRET, NOW),
    true,
  );
  assert.equal(
    await verifyPaddleSignature(
      `${header};h1=${'0'.repeat(64)}`,
      signed.raw,
      f.env.PADDLE_WEBHOOK_SECRET,
      NOW,
    ),
    true,
  );
  for (const [value, raw, now] of [
    [header, `${signed.raw} `, NOW],
    [header, signed.raw, NOW + 6],
    [header, signed.raw, NOW - 6],
    [`${header};ts=${NOW}`, signed.raw, NOW],
    [`ts=${NOW};h1=bad`, signed.raw, NOW],
  ])
    assert.equal(await verifyPaddleSignature(value, raw, f.env.PADDLE_WEBHOOK_SECRET, now), false);
});

test('checkout defaults disabled, pins price/url, and repeated request cannot create another transaction', async () => {
  const f = await fixture();
  const body = { requestId: deviceId(1), operation: 'purchase' };
  let calls = 0;
  let intent;
  const fetcher = paddleFetcher(f.env, (data, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(data.items, [{ price_id: f.env.PADDLE_PURCHASE_PRICE_ID, quantity: 1 }]);
    assert.equal(data.checkout.url, f.env.PADDLE_CHECKOUT_URL);
    intent = {
      orderId: data.custom_data.kerfdesk_order_id,
      orderProof: data.custom_data.kerfdesk_order_proof,
      operation: 'purchase',
    };
  });
  await assert.rejects(createCheckout(f.authority, f.env, body, fetcher), {
    code: 'payment_provider_not_configured',
  });
  assert.equal(calls, 0);
  f.env.PAYMENTS_ENABLED = 'true';
  const checkout = await createCheckout(f.authority, f.env, body, fetcher);
  assert.equal(checkout.checkoutUrl, `https://kerfdesk.com/buy.html?_ptxn=txn_${'c'.repeat(26)}`);
  assert.equal(checkout.checkoutUrl.includes(checkout.claimToken), false);
  assert.deepEqual(await createCheckout(f.authority, f.env, body, fetcher), checkout);
  assert.equal(calls, 1);
  const signed = signedPaddle(f.env, paddleTransaction(f.env, intent));
  const event = await paddleVerifier(f.env)(signed.headers, signed.raw, NOW);
  await fulfilVerifiedPayment(f.authority, event);
  const licence = await claimOrder(f.authority, checkout);
  assert.match(licence.licenseKey, /^KD1\./u);
});

test('concurrent checkout requests and uncertain network failures never blindly create duplicates', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error('timeout');
  };
  const body = { requestId: deviceId(2), operation: 'purchase' };
  const result = await Promise.allSettled(
    Array.from({ length: 5 }, () => createCheckout(f.authority, f.env, body, fetcher)),
  );
  assert.equal(calls, 1);
  assert.ok(
    result.every((item) => item.status === 'rejected' && item.reason.code === 'checkout_pending'),
  );
  await assert.rejects(createCheckout(f.authority, f.env, body, fetcher), {
    code: 'checkout_pending',
  });
  assert.equal(calls, 1);
});

test('authenticated completion can recover a durable intent after provider response loss', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  let intent;
  await assert.rejects(
    createCheckout(
      f.authority,
      f.env,
      { requestId: deviceId(3), operation: 'purchase' },
      async (_url, options) => {
        const data = JSON.parse(options.body);
        intent = {
          orderId: data.custom_data.kerfdesk_order_id,
          orderProof: data.custom_data.kerfdesk_order_proof,
          operation: 'purchase',
        };
        throw new Error('response lost');
      },
    ),
    { code: 'checkout_pending' },
  );
  const signed = signedPaddle(f.env, paddleTransaction(f.env, intent));
  const normalized = await paddleVerifier(f.env)(signed.headers, signed.raw, NOW);
  await assert.rejects(
    fulfilVerifiedPayment(f.authority, { ...normalized, orderProof: 'forged' }),
    { code: 'payment_mismatch' },
  );
  await fulfilVerifiedPayment(f.authority, normalized);
  assert.equal(f.records.get(`order:${intent.orderId}`).status, 'fulfilled');
  const recovered = await createCheckout(
    f.authority,
    f.env,
    { requestId: deviceId(3), operation: 'purchase' },
    () => {
      throw new Error('must not create twice');
    },
  );
  assert.equal(recovered.orderId, intent.orderId);
  assert.match((await claimOrder(f.authority, recovered)).licenseKey, /^KD1\./u);
});

test('Paddle completion refuses altered catalog, currency, recurring plans, discounts and unpaid states', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const intent = { orderId: 'example', orderProof: deviceId(4), operation: 'purchase' };
  const original = paddleTransaction(f.env, intent);
  const verify = async (data) => {
    const signed = signedPaddle(f.env, data);
    return paddleVerifier(f.env)(signed.headers, signed.raw, NOW);
  };
  const accepted = await verify(original);
  assert.equal(accepted.rejection, null);
  assert.equal(accepted.amount, 4950);
  const changes = [
    (d) => {
      d.currency_code = 'ZAR';
    },
    (d) => {
      d.items[0].quantity = 2;
    },
    (d) => {
      d.items[0].price.id = f.env.PADDLE_RENEWAL_PRICE_ID;
    },
    (d) => {
      d.items[0].price.unit_price.amount = '1';
    },
    (d) => {
      d.items[0].price.billing_cycle = { interval: 'month', frequency: 1 };
    },
    (d) => {
      d.details.totals.discount = '1';
    },
    (d) => {
      d.discount_id = 'dsc_example';
    },
    (d) => {
      d.details.totals.total = '1';
    },
    (d) => {
      d.items.push(structuredClone(d.items[0]));
    },
    (d) => {
      d.custom_data.kerfdesk_operation = 'upgrade';
    },
  ];
  // A KerfDesk order's refused payment is reported for recording, not thrown back
  // for Paddle to retry (ADR-523 Amendment 3).
  for (const change of changes) {
    const data = structuredClone(original);
    change(data);
    assert.equal((await verify(data)).rejection, 'payment_mismatch');
  }
  assert.equal((await verify({ ...original, status: 'paid' })).rejection, 'payment_not_completed');
});

test('checkout rejects provider redirects to other hosts or a replaced transaction', async () => {
  for (const url of [
    'https://evil.example/buy.html?_ptxn=txn_fake',
    `https://kerfdesk.com/buy.html?_ptxn=txn_${'d'.repeat(26)}`,
    `https://kerfdesk.com/buy.html?_ptxn=txn_${'c'.repeat(26)}&secret=oops`,
  ]) {
    const f = await fixture();
    f.env.PAYMENTS_ENABLED = 'true';
    await assert.rejects(
      createCheckout(
        f.authority,
        f.env,
        { requestId: deviceId(6), operation: 'purchase' },
        async () =>
          new Response(
            JSON.stringify({
              data: paddleTransaction(f.env, { operation: 'purchase' }, { checkout: { url } }),
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
      { code: 'invalid_provider_response' },
    );
  }
});

test('provider response is bounded while streaming and a failed response cannot fulfil its order', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(70_000).fill(32));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    createCheckout(
      f.authority,
      f.env,
      { requestId: deviceId(7), operation: 'purchase' },
      async () => new Response(stream, { headers: { 'content-type': 'application/json' } }),
    ),
    { code: 'invalid_provider_response' },
  );
  assert.equal(canceled, true);
  const rows = f.database.prepare("SELECT value FROM records WHERE key LIKE 'order:%'").all();
  assert.equal(rows.length, 1);
  // Nobody was given this order's link, so it can never be paid: it is failed, not
  // left pending forever, and its request ID is free (ADR-523 Amendment 3).
  const order = JSON.parse(rows[0].value);
  assert.equal(order.status, 'failed');
  assert.equal(order.checkoutUrl, null);
  assert.equal(order.failure.code, 'invalid_provider_response');
  assert.equal(
    f.database
      .prepare("SELECT COUNT(*) AS n FROM records WHERE key LIKE 'checkout-request:%'")
      .get().n,
    0,
  );
});
