/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { deviceId, fixture, paddleTransaction } from './test-support.mjs';

const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(requireWrangler.resolve('miniflare')).href);

function start(env, outboundService) {
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('./worker.mjs', import.meta.url)),
    modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
    compatibilityDate: '2026-06-11',
    cf: false,
    bindings: { ...env, PAYMENTS_ENABLED: 'true' },
    durableObjects: { LICENSE_AUTHORITY: { className: 'LicenseAuthority', useSQLite: true } },
    ratelimits: { REQUEST_RATE_LIMITER: { simple: { limit: 100, period: 60 } } },
    outboundService,
    handleStructuredLogs: () => undefined,
  });
}

async function post(worker, body, path = '/v1/checkout', token) {
  const response = await worker.dispatchFetch(`https://licensing.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '192.0.2.2',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function intentFrom(body) {
  return {
    orderId: body.custom_data.kerfdesk_order_id,
    operation: body.custom_data.kerfdesk_operation,
    orderProof: body.custom_data.kerfdesk_order_proof,
  };
}

test('real workerd creates a Paddle checkout once and reuses its durable intent', async () => {
  const f = await fixture();
  let calls = 0;
  const worker = start(f.env, async (request) => {
    calls++;
    assert.equal(request.url, 'https://sandbox-api.paddle.com/transactions');
    assert.equal(request.method, 'POST');
    const intent = intentFrom(await request.json());
    return Response.json({ data: paddleTransaction(f.env, intent, { status: 'ready' }) });
  });
  try {
    const body = { requestId: deviceId(83), operation: 'purchase' };
    const first = await post(worker, body);
    assert.equal(first.status, 200);
    assert.match(first.body.checkoutUrl, /^https:\/\/kerfdesk.com\/buy.html\?_ptxn=txn_/u);
    assert.deepEqual(await post(worker, body), first);
    assert.equal(calls, 1);
  } finally {
    await worker.dispose();
    f.database.close();
  }
});

test('real workerd never follows Paddle redirects or retries a payable creation', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = await fixture();
    const destinations = [];
    const worker = start(f.env, (request) => {
      destinations.push(request.url);
      return new Response(null, {
        status,
        headers: { location: 'https://other.example/capture' },
      });
    });
    try {
      const body = { requestId: deviceId(84), operation: 'purchase' };
      const expected = { status: 409, body: { error: { code: 'checkout_pending' } } };
      assert.deepEqual(await post(worker, body), expected);
      assert.deepEqual(await post(worker, body), expected);
      assert.deepEqual(destinations, ['https://sandbox-api.paddle.com/transactions']);
    } finally {
      await worker.dispose();
      f.database.close();
    }
  }
});

test('real workerd reconciles a lost creation answer using only a provider GET', async () => {
  const f = await fixture();
  const methods = [];
  let data;
  const worker = start(f.env, async (request) => {
    methods.push(request.method);
    if (request.method === 'POST') {
      data = paddleTransaction(f.env, intentFrom(await request.json()), { status: 'ready' });
      return new Response('{}', { status: 503 });
    }
    assert.equal(request.url, `https://sandbox-api.paddle.com/transactions/${data.id}`);
    return Response.json({ data });
  });
  try {
    const purchase = { requestId: deviceId(85), operation: 'purchase' };
    assert.equal((await post(worker, purchase)).status, 409);
    const recovered = await post(
      worker,
      { orderId: data.custom_data.kerfdesk_order_id, transactionId: data.id },
      '/v1/admin/orders/reconcile',
      f.env.ADMIN_TOKEN,
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.orderStatus, 'pending');
    assert.equal((await post(worker, purchase)).status, 200);
    assert.deepEqual(methods, ['POST', 'GET']);
  } finally {
    await worker.dispose();
    f.database.close();
  }
});
