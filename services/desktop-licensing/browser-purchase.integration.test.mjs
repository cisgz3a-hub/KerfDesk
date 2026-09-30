/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { deviceId, fixture, paddleTransaction, signedPaddle } from './test-support.mjs';

const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(requireWrangler.resolve('miniflare')).href);
const ORIGIN = 'https://kerfdesk.com';
const API = 'https://licensing.example';

test(
  'real workerd browser preflight, idempotent purchase and authenticated claim consume no device seat',
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    let calls = 0;
    let intent;
    const worker = new Miniflare({
      modules: true,
      scriptPath: fileURLToPath(new URL('./worker.mjs', import.meta.url)),
      modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
      compatibilityDate: '2026-06-11',
      cf: false,
      bindings: { ...f.env, PAYMENTS_ENABLED: 'true' },
      durableObjects: { LICENSE_AUTHORITY: { className: 'LicenseAuthority', useSQLite: true } },
      ratelimits: {
        REQUEST_RATE_LIMITER: { simple: { limit: 100, period: 60 } },
        WEBHOOK_RATE_LIMITER: { simple: { limit: 100, period: 60 } },
      },
      outboundService: async (request) => {
        calls++;
        assert.equal(request.url, 'https://sandbox-api.paddle.com/transactions');
        const body = await request.json();
        intent = {
          orderId: body.custom_data.kerfdesk_order_id,
          orderProof: body.custom_data.kerfdesk_order_proof,
          operation: body.custom_data.kerfdesk_operation,
        };
        return Response.json({ data: paddleTransaction(f.env, intent, { status: 'ready' }) });
      },
      handleStructuredLogs: () => undefined,
    });
    const post = (path, body, headers = { origin: ORIGIN }) =>
      worker.dispatchFetch(`${API}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.2',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    try {
      const preflight = await worker.dispatchFetch(`${API}/v1/checkout`, {
        method: 'OPTIONS',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
      const requestId = deviceId(105);
      assert.equal((await post('/v1/checkout', { requestId, operation: 'renewal' })).status, 400);
      assert.equal((await post('/v1/licenses/activate', {})).status, 400);
      assert.equal(
        (
          await post(
            '/v1/checkout',
            { requestId, operation: 'purchase' },
            { origin: 'https://other.example' },
          )
        ).status,
        400,
      );
      assert.equal(calls, 0);
      const created = await post('/v1/checkout', { requestId, operation: 'purchase' });
      assert.equal(created.status, 200);
      assert.equal(created.headers.get('access-control-allow-origin'), ORIGIN);
      const order = await created.json();
      assert.deepEqual(
        await (await post('/v1/checkout', { requestId, operation: 'purchase' })).json(),
        order,
      );
      assert.equal(calls, 1);
      const claim = { orderId: order.orderId, claimToken: order.claimToken };
      assert.equal((await post('/v1/orders/claim', claim)).status, 409);
      const signed = signedPaddle(
        f.env,
        paddleTransaction(f.env, intent),
        'evt_browser',
        Math.floor(Date.now() / 1000),
      );
      const webhook = await worker.dispatchFetch(`${API}/v1/payments/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.3',
          'paddle-signature': signed.headers.get('paddle-signature'),
        },
        body: signed.raw,
      });
      assert.equal(webhook.status, 200);
      assert.equal((await webhook.json()).duplicate, false);
      const received = await post('/v1/orders/claim', claim);
      assert.equal(received.status, 200);
      assert.equal(received.headers.get('access-control-allow-origin'), ORIGIN);
      const key = await received.json();
      assert.match(key.licenseKey, /^KD1\./u);
      assert.deepEqual(await (await post('/v1/orders/claim', claim)).json(), key);
      const lookup = await post(
        '/v1/admin/licenses/lookup',
        { orderId: order.orderId },
        { authorization: `Bearer ${f.env.ADMIN_TOKEN}` },
      );
      assert.equal(lookup.status, 200);
      assert.equal((await lookup.json()).activeDevices, 0);
    } finally {
      await worker.dispose();
      f.database.close();
    }
  },
);
