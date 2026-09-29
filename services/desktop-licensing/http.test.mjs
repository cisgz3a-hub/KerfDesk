/* global Request, ReadableStream, TextEncoder */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { authorityRequest } from './http.mjs';
import { claimOrder, prepareOrder } from './payments.mjs';
import { fixture, NOW, paddleTransaction, request, signedPaddle } from './test-support.mjs';

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

test('worker fails closed for disabled service, missing rate limiter, rate exceedance and unavailable storage', async () => {
  const input = () => request('/v1/trials/start', {}, { 'cf-connecting-ip': '192.0.2.1' });
  assert.equal((await worker.fetch(input(), { LICENSING_ENABLED: 'false' })).status, 503);
  assert.equal((await worker.fetch(input(), { LICENSING_ENABLED: 'true' })).status, 503);
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
    REQUEST_RATE_LIMITER: { limit: async () => ({ success: false }) },
  };
  assert.equal((await worker.fetch(input(), env)).status, 429);
  env.REQUEST_RATE_LIMITER.limit = async () => ({ success: true });
  const result = await worker.fetch(input(), env);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: { code: 'service_unavailable' } });
});

test('public config reveals only public token after full payment configuration and exact-origin CORS', async () => {
  const f = await fixture();
  const input = () =>
    new Request('https://licensing.example/v1/public/config', {
      headers: { origin: 'https://kerfdesk.com' },
    });
  const disabled = await worker.fetch(input(), f.env);
  assert.equal((await disabled.json()).enabled, false);
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

test('HTTP webhook stays disabled until configured; invalid signatures grant nothing; duplicate valid payment grants once', async () => {
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
  assert.equal((await authorityRequest(input(), f.env, f.authority)).status, 503);
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
