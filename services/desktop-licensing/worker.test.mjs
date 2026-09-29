/* global console, Request */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { LicenseAuthority } from './worker.mjs';
import { authorityRequest, json } from './http.mjs';
import {
  adminRequest,
  deviceId,
  fixture,
  paddleTransaction,
  request,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

function captureLogs(t) {
  const lines = [];
  for (const level of ['log', 'warn', 'error'])
    t.mock.method(console, level, (line) => lines.push({ level, ...line }));
  return lines;
}

function limiters(calls, refused = new Set()) {
  const limiter = (name) => ({
    limit: async ({ key }) => {
      calls.push({ name, key });
      return { success: !refused.has(name) };
    },
  });
  return {
    REQUEST_RATE_LIMITER: limiter('request'),
    WEBHOOK_RATE_LIMITER: limiter('webhook'),
    TRIAL_RATE_LIMITER: limiter('trial'),
  };
}

/** A Durable Object stand-in that runs the real authority in this process. */
function authorityBinding(f) {
  return {
    idFromName: () => 'id',
    get: () => ({ fetch: (input) => authorityRequest(input, f.env, f.authority) }),
  };
}

const from = (address) => ({ 'cf-connecting-ip': address });

test('each route draws on its own limiter, keyed by address or IPv6 /64', async (t) => {
  captureLogs(t);
  const calls = [];
  const refused = new Set();
  const env = {
    LICENSING_ENABLED: 'true',
    ...limiters(calls, refused),
    LICENSE_AUTHORITY: {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => json({ ok: true }) }),
    },
  };
  const post = (path, address) => worker.fetch(request(path, {}, from(address)), env);
  assert.equal((await post('/v1/payments/webhook', '2001:db8:1:2::7')).status, 200);
  assert.equal((await post('/v1/trials/start', '::ffff:192.0.2.9')).status, 200);
  assert.equal((await post('/v1/licenses/activate', '192.0.2.10')).status, 200);
  assert.equal((await post('/v1/admin/export', '2001:db8:1:2:aaaa::1')).status, 200);
  assert.deepEqual(calls, [
    { name: 'webhook', key: 'ipv6:2001:db8:1:2::/64' },
    { name: 'trial', key: 'ipv4:192.0.2.9' },
    { name: 'request', key: 'ipv4:192.0.2.10' },
    { name: 'request', key: 'ipv6:2001:db8:1:2::/64' },
  ]);
  // A flood of webhook retries cannot use up the trial or licence budgets.
  refused.add('webhook');
  assert.equal((await post('/v1/payments/webhook', '192.0.2.11')).status, 429);
  assert.equal((await post('/v1/trials/start', '192.0.2.11')).status, 200);
  assert.equal((await post('/v1/licenses/activate', '192.0.2.11')).status, 200);
  const malformed = await post('/v1/licenses/activate', 'not-an-address');
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: { code: 'client_address_required' } });
  calls.length = 0;
  for (const path of ['/v1/public/config', '/v1/public/health'])
    await worker.fetch(new Request(`https://licensing.example${path}`), env);
  assert.deepEqual(calls, []);
});

test('health checks the Durable Object without the rate limit, even while licensing is off', async (t) => {
  captureLogs(t);
  const f = await fixture();
  f.env.LICENSING_ENABLED = 'false';
  const calls = [];
  const object = new LicenseAuthority({ storage: f.storage }, f.env);
  const env = {
    ...f.env,
    ...limiters(calls),
    LICENSE_AUTHORITY: { idFromName: () => 'id', get: () => object },
  };
  const health = () => worker.fetch(new Request('https://licensing.example/v1/public/health'), env);
  const healthy = await health();
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { ok: true });
  assert.equal(healthy.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, []);
  // Everything else stays switched off.
  const trial = await object.fetch(request('/v1/trials/start', {}));
  assert.deepEqual(await trial.json(), { error: { code: 'service_unavailable' } });
  const failing = [
    { idFromName: () => 'id', get: () => ({ fetch: () => Promise.reject(new Error('down')) }) },
    { idFromName: () => 'id', get: () => ({ fetch: async () => json({}, 503) }) },
    { idFromName: () => 'id', get: () => ({ fetch: async () => json({ ok: 'yes' }) }) },
    undefined,
  ];
  for (const binding of failing) {
    env.LICENSE_AUTHORITY = binding;
    const response = await health();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false });
  }
});

test('health reuses its answer for ten seconds, so polling cannot queue ahead of licence calls', async (t) => {
  captureLogs(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let pings = 0;
  let up = true;
  const binding = {
    idFromName: () => 'id',
    get: () => ({
      fetch: async () => {
        pings += 1;
        return up ? json({ ok: true }) : json({}, 503);
      },
    }),
  };
  const env = { ...limiters([]), LICENSE_AUTHORITY: binding };
  const health = () => worker.fetch(new Request('https://licensing.example/v1/public/health'), env);
  for (let call = 0; call < 5; call += 1) assert.equal((await health()).status, 200);
  assert.equal(pings, 1);
  up = false;
  t.mock.timers.tick(9_999);
  assert.equal((await health()).status, 200);
  assert.equal(pings, 1);
  t.mock.timers.tick(1);
  const down = await health();
  assert.deepEqual([down.status, await down.json()], [503, { ok: false }]);
  assert.equal(pings, 2);
  // A failure is remembered as briefly, and another binding asks for itself.
  assert.equal((await health()).status, 503);
  const other = { ...env, LICENSE_AUTHORITY: { ...binding } };
  up = true;
  assert.equal(
    (await worker.fetch(new Request('https://licensing.example/v1/public/health'), other)).status,
    200,
  );
  assert.equal(pings, 3);
});

test('one log line per request with route, status, code and time, and never a secret', async (t) => {
  const lines = captureLogs(t);
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const address = '198.51.100.7';
  const env = { ...f.env, ...limiters([]), LICENSE_AUTHORITY: authorityBinding(f) };
  const send = (input) => worker.fetch(input, env);
  const post = (path, body, headers = {}) =>
    send(request(path, body, { ...from(address), ...headers }));
  const device = deviceId(60);
  await post('/v1/trials/start', { deviceId: device, deviceName: 'PC' });
  const grantRequest = adminRequest(
    '/v1/admin/developer-grants',
    { grantId: 'logged', displayName: 'Logged' },
    f.env.ADMIN_TOKEN,
  );
  grantRequest.headers.set('cf-connecting-ip', address);
  const grant = await (await send(grantRequest)).json();
  const activation = await (
    await post('/v1/licenses/activate', {
      licenseKey: grant.licenseKey,
      deviceId: deviceId(61),
      deviceName: 'PC',
    })
  ).json();
  const last = grant.licenseKey.at(-1);
  await post('/v1/licenses/activate', {
    licenseKey: `${grant.licenseKey.slice(0, -1)}${last === 'A' ? 'E' : 'A'}`,
    deviceId: deviceId(62),
    deviceName: 'PC',
  });
  // A mistyped URL holding a key is logged as "other", never by its path.
  await post(`/v1/licenses/${grant.licenseKey}`, {});
  const foreign = paddleTransaction(f.env, { operation: 'purchase' }, { custom_data: null });
  const refused = paddleTransaction(f.env, { orderId: 'no-such', operation: 'purchase' });
  for (const [data, eventId] of [
    [foreign, 'evt_foreign'],
    [refused, 'evt_refused'],
  ]) {
    const input = webhookRequest(signedPaddle(f.env, data, eventId));
    input.headers.set('cf-connecting-ip', address);
    await send(input);
  }
  await send(new Request('https://licensing.example/v1/public/config'));
  assert.equal(lines.length, 8);
  for (const line of lines) {
    assert.equal(line.message, 'licensing request');
    assert.equal(typeof line.ms, 'number');
    assert.ok(['GET', 'POST'].includes(line.method));
  }
  assert.deepEqual(
    lines.map(({ level, route, status, code, outcome }) => [level, route, status, code, outcome]),
    [
      ['log', '/v1/trials/start', 200, null, undefined],
      ['log', '/v1/admin/developer-grants', 200, null, undefined],
      ['log', '/v1/licenses/activate', 200, null, undefined],
      ['log', '/v1/licenses/activate', 401, 'invalid_credentials', undefined],
      ['log', 'other', 404, 'not_found', undefined],
      ['log', '/v1/payments/webhook', 200, null, 'ignored'],
      ['warn', '/v1/payments/webhook', 200, null, 'rejected'],
      ['log', '/v1/public/config', 200, null, undefined],
    ],
  );
  const logged = JSON.stringify(lines);
  for (const secret of [
    grant.licenseKey,
    grant.licenseId,
    activation.activationToken,
    f.env.ADMIN_TOKEN,
    device,
    address,
    'no-such',
  ])
    assert.equal(logged.includes(secret), false, secret);
});

test('an unexpected fault logs its type as an error and never reaches the caller', async (t) => {
  const lines = captureLogs(t);
  const env = {
    LICENSING_ENABLED: 'true',
    ...limiters([]),
    LICENSE_AUTHORITY: {
      idFromName: () => 'id',
      get: () => ({
        fetch: async () => {
          throw new TypeError('secret detail from input');
        },
      }),
    },
  };
  const response = await worker.fetch(request('/v1/licenses/activate', {}, from('192.0.2.1')), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-licensing-fault'), null);
  assert.deepEqual(await response.json(), { error: { code: 'service_unavailable' } });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'error');
  assert.equal(lines[0].fault, 'TypeError');
  assert.equal(lines[0].code, 'service_unavailable');
  assert.equal(JSON.stringify(lines).includes('secret detail'), false);
});
