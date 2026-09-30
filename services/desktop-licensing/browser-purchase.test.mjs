/* global console, Request */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { authorityRequest } from './http.mjs';
import { ROUTE } from './routes.mjs';
import {
  deviceId,
  fixture,
  paddleFetcher,
  paddleTransaction,
  request,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const ORIGIN = 'https://kerfdesk.com';
const HEADERS = { origin: ORIGIN, 'cf-connecting-ip': '192.0.2.2' };

async function setup(t) {
  const logs = [];
  for (const level of ['log', 'warn', 'error'])
    t.mock.method(console, level, (line) => logs.push(line));
  const f = await fixture();
  t.after(() => f.database.close());
  const calls = { provider: 0, authority: 0, limiter: 0 };
  let intent;
  const fetcher = paddleFetcher(f.env, (body) => {
    calls.provider++;
    intent = {
      orderId: body.custom_data.kerfdesk_order_id,
      orderProof: body.custom_data.kerfdesk_order_proof,
      operation: body.custom_data.kerfdesk_operation,
    };
  });
  f.env.REQUEST_RATE_LIMITER = {
    limit: async () => {
      calls.limiter++;
      return { success: true };
    },
  };
  f.env.LICENSE_AUTHORITY = {
    idFromName: () => 'id',
    get: () => ({
      fetch: (input) => {
        calls.authority++;
        return authorityRequest(input, f.env, f.authority, { fetcher });
      },
    }),
  };
  const post = (path, body, headers = {}) =>
    worker.fetch(request(path, body, { ...HEADERS, ...headers }), f.env);
  return { ...f, calls, logs, post, intent: () => intent };
}

function preflight(path = ROUTE.checkout, headers = {}) {
  return new Request(`https://licensing.example${path}`, {
    method: 'OPTIONS',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
      ...headers,
    },
  });
}

test('only first-party purchase and claim accept a JSON POST preflight without authority work', async (t) => {
  const f = await setup(t);
  f.env.LICENSING_ENABLED = 'false';
  for (const path of [ROUTE.checkout, ROUTE.claim]) {
    const response = await worker.fetch(preflight(path), f.env);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST');
    assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const path of [ROUTE.activate, ROUTE.trial, ROUTE.webhook, ROUTE.lookup]) {
    const response = await worker.fetch(preflight(path), f.env);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const headers of [
    { 'access-control-request-method': 'DELETE' },
    { 'access-control-request-headers': 'content-type, authorization' },
    { 'access-control-request-headers': 'x-claim-token' },
  ]) {
    const response = await worker.fetch(preflight(ROUTE.claim, headers), f.env);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('access-control-allow-methods'), null);
  }
  assert.deepEqual(f.calls, { provider: 0, authority: 0, limiter: 0 });
});

test('foreign/null origins, queries and protected routes cannot reach the authority', async (t) => {
  const f = await setup(t);
  for (const origin of [
    'null',
    'https://evil.example',
    'https://kerfdesk.com.evil.example',
    'http://kerfdesk.com',
    'https://www.kerfdesk.com',
    `${ORIGIN}:444`,
  ]) {
    for (const input of [
      preflight(ROUTE.checkout, { origin }),
      request(ROUTE.checkout, {}, { ...HEADERS, origin }),
    ]) {
      const response = await worker.fetch(input, f.env);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  }
  for (const path of [
    ROUTE.activate,
    ROUTE.trial,
    ROUTE.webhook,
    ROUTE.lookup,
    `${ROUTE.claim}?claimToken=secret`,
  ]) {
    const response = await f.post(path, {});
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.deepEqual(f.calls, { provider: 0, authority: 0, limiter: 0 });
});

test('browser renewal and credential injection are rejected inside the authority; desktop remains accepted', async (t) => {
  const f = await setup(t);
  const requestId = deviceId(100);
  for (const body of [
    { requestId, operation: 'renewal' },
    { requestId, operation: 'purchase', licenseKey: 'injected' },
    { operation: 'purchase' },
  ]) {
    const response = await authorityRequest(
      request(ROUTE.checkout, body, HEADERS),
      f.env,
      f.authority,
    );
    assert.equal(response.status, 400);
  }
  const injected = await f.post(
    ROUTE.checkout,
    { requestId, operation: 'purchase' },
    { authorization: 'Bearer injected' },
  );
  assert.equal(injected.status, 400);
  // A no-Origin desktop renewal reaches the unchanged provider configuration gate.
  const desktop = await authorityRequest(
    request(ROUTE.checkout, { requestId, operation: 'renewal' }),
    f.env,
    f.authority,
  );
  assert.deepEqual(await desktop.json(), { error: { code: 'payment_provider_not_configured' } });
  assert.equal(f.calls.provider, 0);
});

test('browser receives safe disabled, rate-limited, malformed and pending errors', async (t) => {
  const f = await setup(t);
  const body = { requestId: deviceId(101), operation: 'purchase' };
  const disabled = await f.post(ROUTE.checkout, body);
  assert.equal(disabled.status, 503);
  assert.equal(disabled.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(disabled.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(await disabled.json(), { error: { code: 'payment_provider_not_configured' } });
  const malformed = await f.post(ROUTE.checkout, body, { 'content-type': 'text/plain' });
  assert.equal(malformed.status, 415);
  assert.equal(malformed.headers.get('access-control-allow-origin'), ORIGIN);
  f.env.REQUEST_RATE_LIMITER.limit = async () => ({ success: false });
  const limited = await f.post(ROUTE.checkout, body);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('access-control-allow-origin'), ORIGIN);
  f.env.LICENSING_ENABLED = 'false';
  const unavailable = await f.post(ROUTE.claim, {});
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(f.calls.provider, 0);
});

test('purchase retries once, verified claim uses no seat and still works after sales close, without secret logs', async (t) => {
  const f = await setup(t);
  f.env.PAYMENTS_ENABLED = 'true';
  const body = { requestId: deviceId(102), operation: 'purchase' };
  const created = await f.post(ROUTE.checkout, body);
  assert.equal(created.status, 200);
  const order = await created.json();
  assert.deepEqual(await (await f.post(ROUTE.checkout, body)).json(), order);
  assert.equal(f.calls.provider, 1);
  const claim = { orderId: order.orderId, claimToken: order.claimToken };
  const pending = await f.post(ROUTE.claim, claim);
  assert.equal(pending.status, 409);
  assert.deepEqual(await pending.json(), { error: { code: 'payment_pending' } });
  assert.equal(pending.headers.get('access-control-allow-origin'), ORIGIN);
  const signed = signedPaddle(f.env, paddleTransaction(f.env, f.intent()));
  const fulfilled = await authorityRequest(webhookRequest(signed), f.env, f.authority);
  assert.equal(fulfilled.status, 200);
  f.env.PAYMENTS_ENABLED = 'false';
  const received = await f.post(ROUTE.claim, claim);
  assert.equal(received.status, 200);
  const key = await received.json();
  assert.match(key.licenseKey, /^KD1\./u);
  assert.deepEqual(await (await f.post(ROUTE.claim, claim)).json(), key);
  assert.deepEqual(f.records.get(`license:${key.licenseId}`).active, []);
  const wrong = await f.post(ROUTE.claim, { ...claim, claimToken: deviceId(103) });
  assert.equal(wrong.status, 401);
  const extra = await f.post(ROUTE.claim, { ...claim, deviceId: deviceId(104) });
  assert.equal(extra.status, 400);
  assert.deepEqual(f.records.get(`license:${key.licenseId}`).active, []);
  for (const secret of [
    body.requestId,
    order.claimToken,
    order.orderId,
    key.licenseKey,
    key.licenseId,
  ])
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
});
