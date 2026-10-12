import assert from 'node:assert/strict';
import test from 'node:test';
import { licensingRequest, publicConfig } from '../public/desktop-checkout-api.mjs';

test('availability works without AbortSignal.timeout and clears its timer after parsing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  let signal;
  try {
    const config = await publicConfig(async (_url, options) => {
      signal = options.signal;
      return Response.json({
        enabled: true,
        provider: 'paddle',
        environment: 'live',
        clientToken: `live_${'A'.repeat(27)}`,
        purchase: { amount: 4950, currency: 'USD' },
        renewal: { amount: 2000, currency: 'USD' },
      });
    });
    assert.equal(config.environment, 'live');
    t.mock.timers.tick(10_000);
    assert.equal(signal.aborted, false);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', timeout);
  }
});

test('the request aborts after eight seconds while waiting for response headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const request = licensingRequest((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, '/v1/public/config');
  const aborted = assert.rejects(request, { name: 'AbortError' });
  t.mock.timers.tick(7999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await aborted;
  assert.equal(signal.aborted, true);
});

test('the same deadline remains active while an incomplete response body is streaming', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const request = licensingRequest(async (_url, options) => {
    signal = options.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"enabled":'));
          signal.addEventListener('abort', () => controller.error(signal.reason), {
            once: true,
          });
        },
      }),
    );
  }, '/v1/public/config');
  const aborted = assert.rejects(request, { name: 'AbortError' });
  await Promise.resolve();
  t.mock.timers.tick(7999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await aborted;
  assert.equal(signal.aborted, true);
});

test('JSON stays bounded to 4096 bytes and failed reads clear the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = [
    { body: JSON.stringify({ data: 'x'.repeat(4085) }), valid: true },
    { body: JSON.stringify({ data: 'x'.repeat(4086) }), valid: false },
    { body: 'invalid JSON', valid: false },
  ];
  for (const value of values) {
    let signal;
    const request = licensingRequest(async (_url, options) => {
      signal = options.signal;
      return new Response(value.body);
    }, '/v1/public/config');
    if (value.valid) assert.equal((await request).data.length, 4085);
    else await assert.rejects(request);
    t.mock.timers.tick(10_000);
    assert.equal(signal.aborted, false);
  }
});

test('network and service failures keep their meaning and clear the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const networkFailure of [true, false]) {
    let signal;
    const request = licensingRequest(
      async (_url, options) => {
        signal = options.signal;
        if (networkFailure) throw new TypeError('Failed to fetch');
        return Response.json({ error: { code: 'payment_pending' } }, { status: 409 });
      },
      '/v1/orders/claim',
      { orderId: 'test-order', claimToken: 'test-claim' },
    );
    await assert.rejects(
      request,
      networkFailure ? { name: 'TypeError' } : { code: 'payment_pending' },
    );
    t.mock.timers.tick(10_000);
    assert.equal(signal.aborted, false);
  }
});
