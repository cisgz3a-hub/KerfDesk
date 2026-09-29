/* global setTimeout */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { decode64 } from './crypto.mjs';
import { claims, credentials, deviceId, fixture } from './test-support.mjs';

// Reuse the repository's pinned Wrangler runtime: no additional service packages.
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(requireWrangler.resolve('miniflare')).href);

const ADDRESS = '192.0.2.2';

function start(env, logs = []) {
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('./worker.mjs', import.meta.url)),
    modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
    compatibilityDate: '2026-06-11',
    cf: false,
    bindings: env,
    durableObjects: { LICENSE_AUTHORITY: { className: 'LicenseAuthority', useSQLite: true } },
    ratelimits: {
      REQUEST_RATE_LIMITER: { simple: { limit: 100, period: 60 } },
      WEBHOOK_RATE_LIMITER: { simple: { limit: 100, period: 60 } },
      // Tight enough to reach in the test: trial starts have their own budget.
      TRIAL_RATE_LIMITER: { simple: { limit: 2, period: 60 } },
    },
    handleStructuredLogs: (entry) => {
      logs.push(entry);
    },
  });
}

function send(worker, env, path, body, admin) {
  return worker.dispatchFetch(`https://licensing.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ADDRESS,
      ...(admin ? { authorization: `Bearer ${env.ADMIN_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function poster(worker, env) {
  return async (path, body, admin = false) => {
    const response = await send(worker, env, path, body, admin);
    return { status: response.status, body: await response.json() };
  };
}

test(
  'real workerd SQLite DO signs trials and atomically caps concurrent seats',
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const logs = [];
    const worker = start(f.env, logs);
    const post = poster(worker, f.env);
    try {
      const trial = await post('/v1/trials/start', {
        deviceId: deviceId(20),
        deviceName: 'Workerd test',
      });
      assert.equal(trial.status, 200, JSON.stringify(trial.body));
      assert.equal(claims(trial.body).tier, 'trial');
      assert.equal(
        await webcrypto.subtle.verify(
          'Ed25519',
          f.pair.publicKey,
          decode64(trial.body.entitlement.signature),
          decode64(trial.body.entitlement.payload),
        ),
        true,
      );
      const trials = [21, 22].map((number) => ({ deviceId: deviceId(number), deviceName: 'PC' }));
      assert.equal((await post('/v1/trials/start', trials[0])).status, 200);
      assert.deepEqual(await post('/v1/trials/start', trials[1]), {
        status: 429,
        body: { error: { code: 'rate_limited' } },
      });
      const grant = await post(
        '/v1/admin/developer-grants',
        { grantId: 'runtime-test', displayName: 'Test only' },
        true,
      );
      assert.equal(grant.status, 200);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          post('/v1/licenses/activate', {
            licenseKey: grant.body.licenseKey,
            deviceId: deviceId(i),
            deviceName: `Runtime${i}`,
          }),
        ),
      );
      assert.equal(results.filter((item) => item.status === 200).length, 3);
      assert.equal(
        results.filter(
          (item) => item.status === 409 && item.body.error.code === 'device_limit_reached',
        ).length,
        3,
      );
      const active = results.find((item) => item.status === 200).body;
      assert.equal((await post('/v1/activations/deactivate', credentials(active))).status, 200);
      assert.equal((await post('/v1/activations/refresh', credentials(active))).status, 403);
      assert.equal(
        (
          await post('/v1/licenses/activate', {
            licenseKey: grant.body.licenseKey,
            deviceId: deviceId(50),
            deviceName: 'Replacement',
          })
        ).status,
        200,
      );
      const health = await worker.dispatchFetch('https://licensing.example/v1/public/health');
      assert.deepEqual([health.status, await health.json()], [200, { ok: true }]);
      // workerd printed one line per request (14), and none carries a secret or address.
      // Its output reaches this process a moment after each answer.
      const lines = () => logs.filter((entry) => entry.message.includes('licensing request'));
      for (let wait = 0; lines().length < 14 && wait < 50; wait += 1)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(lines().length, 14);
      assert.ok(lines().some((entry) => entry.message.includes('rate_limited')));
      const printed = JSON.stringify(logs);
      for (const secret of [
        grant.body.licenseKey,
        grant.body.licenseId,
        f.env.ADMIN_TOKEN,
        active.activationToken,
        deviceId(20),
        ADDRESS,
      ])
        assert.equal(printed.includes(secret), false);
    } finally {
      await worker.dispose();
      f.database.close();
    }
  },
);

test(
  'real workerd answers the health check while licensing is switched off',
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const worker = start({ ...f.env, LICENSING_ENABLED: 'false' });
    try {
      const health = await worker.dispatchFetch('https://licensing.example/v1/public/health');
      assert.deepEqual([health.status, await health.json()], [200, { ok: true }]);
      const trial = await worker.dispatchFetch('https://licensing.example/v1/trials/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ADDRESS },
        body: JSON.stringify({ deviceId: deviceId(23), deviceName: 'PC' }),
      });
      assert.deepEqual(await trial.json(), { error: { code: 'service_unavailable' } });
    } finally {
      await worker.dispose();
      f.database.close();
    }
  },
);

test(
  'real workerd SQLite exports every record and deletes one customer by JSON field',
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const worker = start(f.env);
    const post = poster(worker, f.env);
    try {
      const grants = [];
      for (const grantId of ['kept', 'erased']) {
        const grant = await post('/v1/admin/developer-grants', { grantId, displayName: 'T' }, true);
        assert.equal(grant.status, 200);
        const seat = await post('/v1/licenses/activate', {
          licenseKey: grant.body.licenseKey,
          deviceId: deviceId(grants.length + 60),
          deviceName: 'PC',
        });
        assert.equal(seat.status, 200);
        grants.push({ ...grant.body, seat: seat.body });
      }
      const [kept, erased] = grants;
      const exported = await send(worker, f.env, '/v1/admin/export', { limit: 3 }, true);
      assert.equal(exported.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
      const [header, ...lines] = (await exported.text()).trimEnd().split('\n').map(JSON.parse);
      assert.deepEqual([header.count, lines.length, typeof header.next], [3, 3, 'string']);
      const rest = await send(worker, f.env, '/v1/admin/export', { after: header.next }, true);
      const all = [...lines, ...(await rest.text()).trimEnd().split('\n').map(JSON.parse).slice(1)];
      assert.ok(all.some(({ key }) => key === `license:${erased.licenseId}`));
      assert.equal(JSON.stringify(all).includes(erased.licenseKey), false);
      const status = { licenseId: erased.licenseId, status: 'revoked' };
      assert.equal((await post('/v1/admin/licenses/status', status, true)).status, 200);
      const deleted = await post(
        '/v1/admin/customers/delete',
        { licenseId: erased.licenseId },
        true,
      );
      // Licence, its seat and its grant, found through json_extract on the stored JSON.
      assert.deepEqual(deleted, {
        status: 200,
        body: { licenseId: erased.licenseId, deletedRecords: 3 },
      });
      const again = { licenseKey: erased.licenseKey, deviceId: deviceId(70), deviceName: 'PC' };
      assert.equal((await post('/v1/licenses/activate', again)).status, 401);
      assert.equal((await post('/v1/activations/refresh', credentials(kept.seat))).status, 200);
      const lookup = await post('/v1/admin/licenses/lookup', { licenseId: kept.licenseId }, true);
      assert.equal(lookup.body.activeDevices, 1);
    } finally {
      await worker.dispose();
      f.database.close();
    }
  },
);
