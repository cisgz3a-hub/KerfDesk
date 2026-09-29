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

test(
  'real workerd SQLite DO signs trials and atomically caps concurrent seats',
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    const worker = new Miniflare({
      modules: true,
      scriptPath: fileURLToPath(new URL('./worker.mjs', import.meta.url)),
      modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
      compatibilityDate: '2026-06-11',
      cf: false,
      bindings: f.env,
      durableObjects: { LICENSE_AUTHORITY: { className: 'LicenseAuthority', useSQLite: true } },
      ratelimits: { REQUEST_RATE_LIMITER: { simple: { limit: 100, period: 60 } } },
    });
    const post = async (path, body, admin = false) => {
      const response = await worker.dispatchFetch(`https://licensing.example${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.2',
          ...(admin ? { authorization: `Bearer ${f.env.ADMIN_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
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
    } finally {
      await worker.dispose();
      f.database.close();
    }
  },
);
