/* global Response, structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from './checkout.mjs';
import { reconcileCheckout } from './checkout-reconciliation.mjs';
import { authorityRequest } from './http.mjs';
import { claimOrder, fulfilVerifiedPayment } from './payments.mjs';
import { paddleVerifier } from './paddle.mjs';
import {
  adminRequest,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  signedPaddle,
} from './test-support.mjs';

const ROUTE = '/v1/admin/orders/reconcile';
const ADMIN = { credential: 'ADMIN_TOKEN' };

async function pending() {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const purchase = { requestId: deviceId(81), operation: 'purchase' };
  let intent;
  await assert.rejects(
    createCheckout(f.authority, f.env, purchase, async (_url, options) => {
      const data = JSON.parse(options.body).custom_data;
      intent = {
        orderId: data.kerfdesk_order_id,
        orderProof: data.kerfdesk_order_proof,
        operation: data.kerfdesk_operation,
      };
      throw new Error('Synthetic lost response');
    }),
    { code: 'checkout_pending' },
  );
  const data = paddleTransaction(f.env, intent, { status: 'ready' });
  const body = { orderId: intent.orderId, transactionId: data.id };
  return { ...f, purchase, intent, data, body };
}

const answer = (data) => async () => Response.json({ data });
const order = (f) => f.records.get(`order:${f.body.orderId}`);
const audits = (f) => f.records.page('', 100).filter(({ key }) => key.startsWith('audit:'));

async function route(f, fetcher, token = f.env.ADMIN_TOKEN) {
  return authorityRequest(adminRequest(ROUTE, f.body, token), f.env, f.authority, { fetcher });
}

test('reconciliation verifies an existing provider transaction and resumes only the original order', async () => {
  for (const status of ['draft', 'ready', 'completed']) {
    const f = await pending();
    try {
      const before = order(f);
      let reads = 0;
      const fetcher = async (url, options) => {
        reads++;
        assert.equal(url, `https://sandbox-api.paddle.com/transactions/${f.data.id}`);
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'manual');
        assert.equal(options.body, undefined);
        return Response.json({ data: { ...f.data, status } });
      };
      const first = await route(f, fetcher);
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), {
        ...f.body,
        orderStatus: 'pending',
        reconciled: true,
      });
      assert.equal((await route(f, fetcher)).status, 200);
      assert.equal(reads, 2);
      assert.deepEqual(
        audits(f).map(({ value }) => value.outcome),
        ['reconciled', 'existing'],
      );
      const resumed = await createCheckout(f.authority, f.env, f.purchase, () => {
        assert.fail('A resumed checkout must not create a second provider transaction');
      });
      assert.equal(resumed.orderId, before.orderId);
      assert.equal(order(f).claimTokenHash, before.claimTokenHash);
      assert.equal(order(f).orderProofHash, before.orderProofHash);
      assert.equal(f.records.get(`license:${before.licenseId}`), undefined);
      await assert.rejects(claimOrder(f.authority, resumed), { code: 'payment_pending' });
      assert.equal(JSON.stringify(audits(f)).includes(f.intent.orderProof), false);
    } finally {
      f.database.close();
    }
  }
});

test('reconciliation needs admin authentication before any provider read', async () => {
  const f = await pending();
  try {
    const result = await route(
      f,
      () => assert.fail('No provider read before authentication'),
      'bad',
    );
    assert.equal(result.status, 401);
    assert.equal(audits(f).length, 0);
    assert.equal(order(f).providerOrderId, null);
  } finally {
    f.database.close();
  }
});

test('wrong proof, identity, catalogue, state or checkout never attaches a transaction', async () => {
  const changes = [
    (data) => delete data.custom_data.kerfdesk_order_proof,
    (data) => (data.custom_data.kerfdesk_order_proof = deviceId(99)),
    (data) => (data.custom_data.kerfdesk_order_id = 'another-order'),
    (data) => (data.custom_data.kerfdesk_operation = 'renewal'),
    (data) => (data.id = `txn_${'d'.repeat(26)}`),
    (data) => (data.status = 'canceled'),
    (data) => (data.currency_code = 'EUR'),
    (data) => (data.items[0].price.unit_price.amount = '1'),
    (data) => (data.checkout.url = 'https://other.example/buy.html'),
    (data) => (data.checkout.url += `&_ptxn=${data.id}`),
  ];
  for (const change of changes) {
    const f = await pending();
    try {
      const before = order(f);
      const data = structuredClone(f.data);
      change(data);
      const result = await route(f, answer(data));
      assert.ok([409, 503].includes(result.status));
      assert.deepEqual(order(f), before);
      assert.equal(f.records.get(`provider-order:paddle:${f.data.id}`), undefined);
      assert.equal(audits(f).length, 1);
    } finally {
      f.database.close();
    }
  }
});

test('provider failures, redirects and missing transactions never clear a pending request', async () => {
  for (const status of [302, 404, 429, 500]) {
    const f = await pending();
    try {
      const before = order(f);
      const result = await route(f, async () => new Response('{}', { status }));
      assert.equal(result.status, status === 404 ? 404 : 502);
      assert.deepEqual(order(f), before);
      await assert.rejects(
        createCheckout(f.authority, f.env, f.purchase, () => assert.fail('No new order')),
        { code: 'checkout_pending' },
      );
    } finally {
      f.database.close();
    }
  }
});

test('another order cannot steal a transaction and an audit failure rolls back attachment', async () => {
  const f = await pending();
  try {
    const before = order(f);
    const binding = `provider-order:paddle:${f.data.id}`;
    f.records.put(binding, { orderId: 'other-order' });
    assert.equal((await route(f, answer(f.data))).status, 409);
    assert.deepEqual(order(f), before);
    f.records.delete(binding);
    const put = f.records.put.bind(f.records);
    f.records.put = (key, value) => {
      if (key.startsWith('audit:')) throw new Error('Synthetic audit failure');
      return put(key, value);
    };
    assert.equal((await route(f, answer(f.data))).status, 503);
    assert.deepEqual(order(f), before);
    assert.equal(f.records.get(binding), undefined);
  } finally {
    f.database.close();
  }
});

test('a webhook winning the provider-read interval is never overwritten by reconciliation', async () => {
  const f = await pending();
  try {
    const fetcher = async () => {
      const data = { ...f.data, status: 'completed' };
      const signed = signedPaddle(f.env, data);
      const event = await paddleVerifier(f.env)(signed.headers, signed.raw, NOW);
      await fulfilVerifiedPayment(f.authority, event);
      return Response.json({ data });
    };
    await assert.rejects(reconcileCheckout(f.authority, f.env, f.body, ADMIN, fetcher), {
      code: 'order_not_pending',
    });
    assert.equal(order(f).status, 'fulfilled');
    assert.equal(order(f).providerOrderId, f.data.id);
    assert.equal(f.records.get(`license:${order(f).licenseId}`).tier, 'paid');
  } finally {
    f.database.close();
  }
});
