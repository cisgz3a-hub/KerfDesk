import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPaymentFlag, flagMetadata, guardedSettings } from './apply-payment-settings.mjs';

const originalVersion = '11111111-1111-4111-8111-111111111111';
const nextVersion = '22222222-2222-4222-8222-222222222222';
const target = {
  environment: 'live',
  signing: 'entitlement-2026-09',
  authority: 'LicenseAuthority',
};
const settings = () => ({
  compatibility_date: '2026-09-28',
  compatibility_flags: [],
  observability: { enabled: true },
  bindings: [
    ...Object.entries({
      LICENSING_ENABLED: 'true',
      PAYMENTS_ENABLED: 'false',
      PADDLE_ENVIRONMENT: 'live',
      SIGNING_KEY_ID: 'entitlement-2026-09',
      PADDLE_PURCHASE_PRICE_ID: 'pri_01m4ajbzk3nx9km7ejhze8hzad',
      PADDLE_RENEWAL_PRICE_ID: 'pri_01m4ajpg52ch0cq8qh15vveq21',
      PADDLE_CHECKOUT_URL: 'https://kerfdesk.com/buy.html',
    }).map(([name, text]) => ({ name, type: 'plain_text', text })),
    ...[
      'SIGNING_PRIVATE_JWK',
      'ADMIN_TOKEN',
      'HASH_SECRET',
      'DERIVATION_SECRET',
      'PADDLE_API_KEY',
      'PADDLE_CLIENT_TOKEN',
      'PADDLE_WEBHOOK_SECRET',
    ].map((name) => ({ name, type: 'secret_text' })),
    {
      name: 'LICENSE_AUTHORITY',
      type: 'durable_object_namespace',
      class_name: 'LicenseAuthority',
      namespace_id: '12345678901234567890123456789012',
    },
    ...['REQUEST_RATE_LIMITER', 'WEBHOOK_RATE_LIMITER', 'TRIAL_RATE_LIMITER'].map((name) => ({
      name,
      type: 'ratelimit',
      namespace_id: '1001',
      simple: { limit: 30, period: 60 },
    })),
  ],
});
const ok = (result) => Response.json({ success: true, result });
function harness({ alterProtected = false, badHealth = false } = {}) {
  let value = settings();
  let version = originalVersion;
  const mutations = [];
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.includes('api.cloudflare.com')) {
      if (url.endsWith('/settings') && init.method === 'PATCH') {
        const payload = JSON.parse(await init.body.get('settings').text());
        mutations.push(payload);
        assert.ok(
          payload.bindings
            .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
            .every(({ type, version_id }) => type === 'inherit' && version_id === originalVersion),
        );
        value = {
          ...value,
          bindings: value.bindings.map((binding) =>
            binding.name === 'PAYMENTS_ENABLED' ? { ...binding, text: 'true' } : binding,
          ),
        };
        if (alterProtected)
          value.bindings.find(({ name }) => name === 'SIGNING_KEY_ID').text = 'wrong-signing-key';
        version = nextVersion;
        return ok(value);
      }
      if (url.endsWith('/settings')) return ok(value);
      if (url.endsWith('/deployments') && init.method === 'POST') {
        mutations.push(JSON.parse(init.body));
        version = originalVersion;
        value = settings();
        return ok({ id: 'rolled-back' });
      }
      if (url.endsWith('/deployments'))
        return ok({
          deployments: [
            {
              created_on: '2026-10-07T00:00:00Z',
              versions: [{ version_id: version, percentage: 100 }],
            },
          ],
        });
      if (url.endsWith('/content'))
        return new Response('unchanged worker bytes', {
          headers: { 'Content-Type': 'application/javascript' },
        });
    }
    if (url === 'https://license.kerfdesk.com/v1/public/config') {
      const enabled =
        value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text === 'true';
      return Response.json({
        enabled,
        provider: enabled ? 'paddle' : null,
        environment: enabled ? 'live' : null,
        purchase: { amount: 4950, currency: 'USD' },
        renewal: { amount: 2000, currency: 'USD' },
        clientToken: enabled ? 'public-client-token' : null,
      });
    }
    if (url === 'https://license.kerfdesk.com/v1/public/health')
      return Response.json({ ok: !badHealth }, { status: badHealth ? 503 : 200 });
    throw new Error('Unexpected external destination.');
  };
  return { fetcher, mutations, calls };
}

test('flag patch inherits every other binding from the active version without reading secrets', () => {
  const value = settings();
  const metadata = flagMetadata(value, originalVersion, 'true');
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED'),
    { name: 'PAYMENTS_ENABLED', type: 'plain_text', text: 'true' },
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'SIGNING_PRIVATE_JWK'),
    { name: 'SIGNING_PRIVATE_JWK', type: 'inherit', version_id: originalVersion },
  );
  assert.equal(metadata.bindings.length, value.bindings.length);
  assert.equal(value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text, 'false');
});

test('wrong environment, namespace, missing secrets and duplicate bindings stop before mutation', () => {
  for (const mutate of [
    (value) => {
      value.bindings.find(({ name }) => name === 'PADDLE_ENVIRONMENT').text = 'sandbox';
    },
    (value) => {
      value.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY').namespace_id = '';
    },
    (value) => {
      value.bindings = value.bindings.filter(({ name }) => name !== 'HASH_SECRET');
    },
    (value) => {
      value.bindings.push(value.bindings[0]);
    },
  ]) {
    const value = settings();
    mutate(value);
    assert.throws(() => guardedSettings(value, target));
  }
});

test('inspect has no mutations, no merchant calls and no credential values in the receipt', async () => {
  const run = harness();
  const receipt = await applyPaymentFlag(
    { targetName: 'production', state: 'inspect', token: 'private-token-for-test-only' },
    run.fetcher,
  );
  assert.equal(run.mutations.length, 0);
  assert.equal(receipt.flag, 'false');
  assert.ok(!JSON.stringify(receipt).includes('private-token'));
  assert.ok(
    run.calls.every(
      ({ url }) =>
        url.startsWith('https://api.cloudflare.com/') ||
        url.startsWith('https://license.kerfdesk.com/'),
    ),
  );
});

test('open verifies stable code, protected settings and public provider amounts', async () => {
  const run = harness();
  const receipt = await applyPaymentFlag(
    { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
    run.fetcher,
  );
  assert.equal(run.mutations.length, 1);
  assert.equal(receipt.version, nextVersion);
  assert.equal(receipt.codeUnchanged, true);
  assert.equal(receipt.protectedSettingsUnchanged, true);
  assert.equal(receipt.realMoneyTransaction, false);
});

test('unexpected protected setting change rolls back the exact original deployment', async () => {
  const run = harness({ alterProtected: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
  );
  assert.equal(run.mutations.length, 2);
  assert.deepEqual(run.mutations[1].versions, [{ version_id: originalVersion, percentage: 100 }]);
});

test('unhealthy public authority rolls back an opening operation', async () => {
  const run = harness({ badHealth: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
  );
  assert.equal(run.mutations.length, 2);
  assert.deepEqual(run.mutations[1].versions, [{ version_id: originalVersion, percentage: 100 }]);
});
