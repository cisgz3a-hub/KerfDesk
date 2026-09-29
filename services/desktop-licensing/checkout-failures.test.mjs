/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from './checkout.mjs';
import { authorityRequest } from './http.mjs';
import { deviceId, fixture, paddleFetcher, paddleTransaction, request } from './test-support.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function checkoutFixture() {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const rows = (prefix) =>
    f.database
      .prepare('SELECT key, value FROM records WHERE key LIKE ?')
      .all(`${prefix}%`)
      .map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  return { ...f, rows };
}

function refusal(status) {
  return async () =>
    new Response(
      JSON.stringify({
        error: { type: 'request_error', code: 'not_found', detail: 'Price pri_x was not found.' },
      }),
      { status, headers: JSON_HEADERS },
    );
}

test('a definite Paddle refusal fails the order and frees its request ID for a fresh order', async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const f = await checkoutFixture();
    const body = { requestId: deviceId(40), operation: 'purchase' };
    await assert.rejects(createCheckout(f.authority, f.env, body, refusal(status)), {
      code: 'checkout_failed',
    });
    const [failed] = f.rows('order:');
    assert.equal(failed.value.status, 'failed');
    assert.equal(failed.value.checkoutUrl, null);
    // Paddle's status and its error code only; never its free-text detail.
    assert.deepEqual(failed.value.failure, {
      code: 'checkout_failed',
      provider: { status, code: 'not_found' },
    });
    assert.equal(JSON.stringify(f.rows('')).includes('was not found'), false);
    assert.equal(f.rows('checkout-request:').length, 0);
    let calls = 0;
    const retry = await createCheckout(
      f.authority,
      f.env,
      body,
      paddleFetcher(f.env, () => calls++),
    );
    assert.equal(calls, 1);
    assert.notEqual(retry.orderId, failed.value.orderId);
    assert.match(retry.checkoutUrl, /_ptxn=txn_/u);
    assert.deepEqual(await createCheckout(f.authority, f.env, body, refusal(status)), retry);
    assert.equal(f.records.get(`order:${failed.value.orderId}`).status, 'failed');
  }
});

test('the checkout route answers checkout_failed for a definite refusal', async () => {
  const f = await checkoutFixture();
  const response = await authorityRequest(
    request('/v1/checkout', { requestId: deviceId(41), operation: 'purchase' }),
    f.env,
    f.authority,
    { fetcher: refusal(400) },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'checkout_failed' } });
});

test('an ambiguous Paddle answer keeps the order pending and never creates a second transaction', async () => {
  for (const status of [408, 409, 429, 500, 502, 503]) {
    const f = await checkoutFixture();
    const body = { requestId: deviceId(42), operation: 'purchase' };
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response('{}', { status, headers: JSON_HEADERS });
    };
    await assert.rejects(createCheckout(f.authority, f.env, body, fetcher), {
      code: 'checkout_pending',
    });
    await assert.rejects(createCheckout(f.authority, f.env, body, fetcher), {
      code: 'checkout_pending',
    });
    assert.equal(calls, 1);
    assert.equal(f.rows('order:')[0].value.status, 'pending');
    assert.equal(f.rows('checkout-request:').length, 1);
  }
});

test('a transaction without a usable checkout link or catalogue is an invalid provider response', async () => {
  const cases = [
    { checkout: null },
    { checkout: {} },
    { checkout: { url: null } },
    { checkout: { url: 12 } },
    { checkout: { url: 'not a url' } },
    { currency_code: 'EUR' },
  ];
  for (const overrides of cases) {
    const f = await checkoutFixture();
    const body = { requestId: deviceId(43), operation: 'purchase' };
    const answer = async () =>
      new Response(
        JSON.stringify({ data: paddleTransaction(f.env, { operation: 'purchase' }, overrides) }),
        { headers: JSON_HEADERS },
      );
    const response = await authorityRequest(request('/v1/checkout', body), f.env, f.authority, {
      fetcher: answer,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'invalid_provider_response' } });
    assert.equal(f.rows('order:')[0].value.status, 'failed');
    // Nobody was given that transaction's link, so a fresh order is safe.
    const retry = await createCheckout(f.authority, f.env, body, paddleFetcher(f.env));
    assert.match(retry.checkoutUrl, /_ptxn=txn_/u);
  }
});
