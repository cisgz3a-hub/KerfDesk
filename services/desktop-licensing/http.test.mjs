/* global console, Request, ReadableStream, TextEncoder */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { authorityRequest } from './http.mjs';
import { claimOrder, prepareOrder } from './payments.mjs';
import {
  checkoutOrder,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  request,
  signedPaddle,
} from './test-support.mjs';

test('developer issuance is admin-only; wrong auth and admin exceptions cannot leak secrets', async () => {
  const f = await fixture();
  const body = { grantId: 'johann', displayName: 'Johann' };
  for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
    const response = await authorityRequest(
      request('/v1/admin/developer-grants', body, headers),
      f.env,
      f.authority,
    );
    assert.equal(response.status, 401);
    assert.equal(JSON.stringify(await response.json()).includes(f.env.ADMIN_TOKEN), false);
  }
  const response = await authorityRequest(
    request('/v1/admin/developer-grants', body, { authorization: `Bearer ${f.env.ADMIN_TOKEN}` }),
    f.env,
    f.authority,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json()).licenseKey, /^KD1\./u);
});

test('JSON content, streamed bytes, malformed UTF8, query credentials, origin and method are bounded', async () => {
  const f = await fixture();
  const cases = [
    [new Request('https://licensing.example/v1/trials/start'), 405],
    [request('/v1/trials/start?licenseKey=secret', {}), 400],
    [request('/v1/trials/start', {}, { origin: 'https://evil.example' }), 400],
    [request('/v1/trials/start', {}, { 'content-type': 'text/plain' }), 415],
    [request('/v1/trials/start', {}, { 'content-length': '20000' }), 413],
    [
      new Request('https://licensing.example/v1/trials/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      400,
    ],
    [
      new Request('https://licensing.example/v1/trials/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array([255]),
      }),
      400,
    ],
  ];
  for (const [input, status] of cases)
    assert.equal((await authorityRequest(input, f.env, f.authority)).status, status);
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(9000)));
    },
    cancel() {
      canceled = true;
    },
  });
  const oversized = new Request('https://licensing.example/v1/trials/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal((await authorityRequest(oversized, f.env, f.authority)).status, 413);
  assert.equal(canceled, true);
});

test('worker fails closed for disabled service, missing rate limiter, rate exceedance and unavailable storage', async (t) => {
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, () => undefined);
  const input = () => request('/v1/trials/start', {}, { 'cf-connecting-ip': '192.0.2.1' });
  assert.equal((await worker.fetch(input(), { LICENSING_ENABLED: 'false' })).status, 503);
  assert.equal((await worker.fetch(input(), { LICENSING_ENABLED: 'true' })).status, 503);
  const refuse = () => ({ limit: async () => ({ success: false }) });
  const env = {
    LICENSING_ENABLED: 'true',
    LICENSE_AUTHORITY: {
      idFromName: () => 'id',
      get: () => ({
        fetch: () => {
          throw new Error('secret details');
        },
      }),
    },
    REQUEST_RATE_LIMITER: refuse(),
    WEBHOOK_RATE_LIMITER: refuse(),
  };
  // Trial starts have their own limiter; without it the worker fails closed.
  assert.equal((await worker.fetch(input(), env)).status, 503);
  env.TRIAL_RATE_LIMITER = refuse();
  assert.equal((await worker.fetch(input(), env)).status, 429);
  env.TRIAL_RATE_LIMITER.limit = async () => ({ success: true });
  const result = await worker.fetch(input(), env);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: { code: 'service_unavailable' } });
  // The error's type reaches the log line only, never the caller.
  assert.equal(result.headers.get('x-licensing-fault'), null);
});

test('public config reveals only public token after full payment configuration and exact-origin CORS', async (t) => {
  t.mock.method(console, 'log', () => undefined);
  const f = await fixture();
  const input = () =>
    new Request('https://licensing.example/v1/public/config', {
      headers: { origin: 'https://kerfdesk.com' },
    });
  const disabled = await worker.fetch(input(), f.env);
  assert.deepEqual(await disabled.json(), {
    enabled: false,
    provider: null,
    environment: null,
    clientToken: null,
    purchase: { amount: 4950, currency: 'USD' },
    renewal: { amount: 2000, currency: 'USD' },
  });
  f.env.PAYMENTS_ENABLED = 'true';
  const response = await worker.fetch(input(), f.env);
  const config = await response.json();
  assert.equal(config.clientToken, f.env.PADDLE_CLIENT_TOKEN);
  assert.equal(config.enabled, true);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://kerfdesk.com');
  for (const value of [
    f.env.PADDLE_API_KEY,
    f.env.PADDLE_WEBHOOK_SECRET,
    f.env.ADMIN_TOKEN,
    f.env.SIGNING_PRIVATE_JWK,
  ])
    assert.equal(JSON.stringify(config).includes(value), false);
  const other = await worker.fetch(
    new Request('https://licensing.example/v1/public/config', {
      headers: { origin: 'https://evil.example' },
    }),
    f.env,
  );
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('HTTP webhook requires provider configuration; invalid signatures grant nothing; duplicate valid payment grants once', async () => {
  const f = await fixture();
  const id = `txn_${'c'.repeat(26)}`;
  const order = await prepareOrder(f.authority, {
    orderId: 'webhook',
    provider: 'paddle',
    providerOrderId: id,
    operation: 'purchase',
  });
  const data = paddleTransaction(f.env, { orderId: order.orderId, operation: 'purchase' });
  const signed = signedPaddle(f.env, data);
  const input = (raw = signed.raw) =>
    new Request('https://licensing.example/v1/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'paddle-signature': signed.headers.get('paddle-signature'),
      },
      body: raw,
    });
  assert.equal(
    (await authorityRequest(input(), { ...f.env, PADDLE_WEBHOOK_SECRET: '' }, f.authority)).status,
    503,
  );
  f.env.PAYMENTS_ENABLED = 'true';
  assert.equal((await authorityRequest(input(`${signed.raw} `), f.env, f.authority)).status, 401);
  await assert.rejects(claimOrder(f.authority, order), { code: 'payment_pending' });
  const first = await authorityRequest(input(), f.env, f.authority);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).duplicate, false);
  assert.equal(
    (await (await authorityRequest(input(), f.env, f.authority)).json()).duplicate,
    true,
  );
  f.setNow(NOW + 6);
  assert.equal((await authorityRequest(input(), f.env, f.authority)).status, 401);
  assert.match((await claimOrder(f.authority, order)).licenseKey, /^KD1\./u);
});

test('a checkout created before closing fulfils once while new checkout and public config remain closed', async (t) => {
  t.mock.method(console, 'log', () => undefined);
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(f, deviceId(8));
  const signed = signedPaddle(f.env, paddleTransaction(f.env, intent));
  f.env.PAYMENTS_ENABLED = 'false';
  const recordCount = () => f.database.prepare('SELECT COUNT(*) AS n FROM records').get().n;
  const originalRecords = recordCount();
  const closed = await authorityRequest(
    request('/v1/checkout', { requestId: deviceId(9), operation: 'purchase' }),
    f.env,
    f.authority,
    { fetcher: () => assert.fail('closed checkout must never call Paddle') },
  );
  assert.equal(closed.status, 503);
  assert.deepEqual(await closed.json(), { error: { code: 'payment_provider_not_configured' } });
  const config = await worker.fetch(
    new Request('https://licensing.example/v1/public/config'),
    f.env,
  );
  assert.deepEqual(await config.json(), {
    enabled: false,
    provider: null,
    environment: null,
    clientToken: null,
    purchase: { amount: 4950, currency: 'USD' },
    renewal: { amount: 2000, currency: 'USD' },
  });
  const input = (raw = signed.raw) =>
    new Request('https://licensing.example/v1/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'paddle-signature': signed.headers.get('paddle-signature'),
      },
      body: raw,
    });
  const invalid = await authorityRequest(input(`${signed.raw} `), f.env, f.authority);
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: { code: 'invalid_payment_signature' } });
  assert.equal(recordCount(), originalRecords);
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'payment_pending' });
  const first = await authorityRequest(input(), f.env, f.authority);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true, duplicate: false });
  const licence = await claimOrder(f.authority, checkout);
  assert.match(licence.licenseKey, /^KD1\./u);
  const fulfilledRecords = recordCount();
  const duplicate = await authorityRequest(input(), f.env, f.authority);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });
  assert.equal(recordCount(), fulfilledRecords);
  assert.deepEqual(await claimOrder(f.authority, checkout), licence);
});
