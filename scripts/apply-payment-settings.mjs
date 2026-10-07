// Operator-only flag change. No code upload, secret retrieval or merchant request.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ACCOUNT = '10d5d0bdb9bf11ca0468db275a787e20';
const TARGETS = Object.freeze({
  production: {
    worker: 'kerfdesk-desktop-licensing',
    origin: 'https://license.kerfdesk.com',
    environment: 'live',
    signing: 'entitlement-2026-09',
    authority: 'LicenseAuthority',
  },
  sandbox: {
    worker: 'kerfdesk-desktop-licensing-sandbox',
    origin: 'https://kerfdesk-desktop-licensing-sandbox.cisgz3a.workers.dev',
    environment: 'sandbox',
    signing: 'sandbox-20260929',
    authority: 'SandboxLicenseAuthority',
  },
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const configurationKeys = [
  'compatibility_date',
  'compatibility_flags',
  'usage_model',
  'logpush',
  'tail_consumers',
  'observability',
  'limits',
  'placement',
  'cache_options',
];

export function guardedSettings(settings, target) {
  assert.ok(settings && Array.isArray(settings.bindings), 'Worker bindings unavailable.');
  const bindings = settings.bindings;
  const names = bindings.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length, 'Duplicate Worker bindings.');
  const variable = (name) =>
    bindings.find((binding) => binding.name === name && binding.type === 'plain_text')?.text;
  assert.equal(variable('LICENSING_ENABLED'), 'true', 'Licensing must remain enabled.');
  assert.ok(['true', 'false'].includes(variable('PAYMENTS_ENABLED')), 'Payment flag unavailable.');
  assert.equal(variable('PADDLE_ENVIRONMENT'), target.environment, 'Wrong Paddle environment.');
  assert.equal(variable('SIGNING_KEY_ID'), target.signing, 'Wrong signing identity.');
  const authority = bindings.find(({ name }) => name === 'LICENSE_AUTHORITY');
  assert.equal(authority?.type, 'durable_object_namespace', 'Wrong authority binding.');
  assert.equal(authority?.class_name, target.authority, 'Wrong authority class.');
  assert.ok(
    /^[a-f0-9]{32}$/u.test(authority?.namespace_id ?? ''),
    'Authority namespace unavailable.',
  );
  if (target.environment === 'sandbox')
    assert.equal(
      authority.namespace_id,
      'b5b0cb9d97f4404582f884ff2b1a6ba8',
      'Wrong sandbox database.',
    );
  for (const name of [
    'SIGNING_PRIVATE_JWK',
    'ADMIN_TOKEN',
    'HASH_SECRET',
    'DERIVATION_SECRET',
    'PADDLE_API_KEY',
    'PADDLE_CLIENT_TOKEN',
    'PADDLE_WEBHOOK_SECRET',
  ]) {
    assert.ok(
      bindings.some((binding) => binding.name === name && binding.type === 'secret_text'),
      'Required protected binding unavailable.',
    );
  }
  assert.ok(
    bindings.some(({ name }) => name === 'REQUEST_RATE_LIMITER'),
    'Request limiter unavailable.',
  );
  assert.ok(
    bindings.some(({ name }) => name === 'WEBHOOK_RATE_LIMITER'),
    'Webhook limiter unavailable.',
  );
  assert.ok(
    bindings.some(({ name }) => name === 'TRIAL_RATE_LIMITER'),
    'Trial limiter unavailable.',
  );
  if (target.environment === 'live') {
    assert.equal(
      variable('PADDLE_PURCHASE_PRICE_ID'),
      'pri_01m4ajbzk3nx9km7ejhze8hzad',
      'Wrong live purchase price.',
    );
    assert.equal(
      variable('PADDLE_RENEWAL_PRICE_ID'),
      'pri_01m4ajpg52ch0cq8qh15vveq21',
      'Wrong live renewal price.',
    );
    assert.equal(
      variable('PADDLE_CHECKOUT_URL'),
      'https://kerfdesk.com/buy.html',
      'Wrong live checkout page.',
    );
  }
  return variable('PAYMENTS_ENABLED');
}

function protectedFingerprint(settings) {
  const bindings = settings.bindings
    .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
    .map((binding) => JSON.stringify(binding, Object.keys(binding).sort()))
    .sort();
  const fields = Object.fromEntries(
    configurationKeys
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
  return hash(JSON.stringify({ bindings, fields }));
}

export function flagMetadata(settings, version, enabled) {
  assert.ok(uuid.test(version), 'Active Worker version unavailable.');
  assert.ok(['true', 'false'].includes(enabled), 'Invalid payment flag.');
  const fields = Object.fromEntries(
    configurationKeys
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
  return {
    ...fields,
    annotations: {
      'workers/message': `${enabled === 'true' ? 'Enable' : 'Close'} authorised checkout; preserve code and authority`,
    },
    bindings: settings.bindings.map(({ name }) =>
      name === 'PAYMENTS_ENABLED'
        ? { name, type: 'plain_text', text: enabled }
        : { name, type: 'inherit', version_id: version },
    ),
  };
}

export async function applyPaymentFlag({ targetName, state, token, output }, fetcher = fetch) {
  const target = TARGETS[targetName];
  assert.ok(
    target && ['inspect', 'open', 'close'].includes(state),
    'Invalid payment settings operation.',
  );
  assert.ok(typeof token === 'string' && token.length >= 20, 'Cloudflare credential unavailable.');
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${target.worker}`;
  const api = async (suffix, init = {}) => {
    const response = await fetcher(base + suffix, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, `Cloudflare request failed (${response.status}).`);
    const body = await response.json();
    assert.equal(body.success, true, 'Cloudflare refused payment settings operation.');
    return body.result;
  };
  const activeVersion = async () => {
    const result = await api('/deployments');
    const deployments = Array.isArray(result) ? result : result.deployments;
    assert.ok(Array.isArray(deployments) && deployments.length, 'Active deployment unavailable.');
    const newest = [...deployments].sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
    assert.equal(newest.versions?.length, 1, 'Gradual deployment requires separate review.');
    assert.equal(
      newest.versions[0].percentage,
      100,
      'Gradual deployment requires separate review.',
    );
    const version = newest.versions[0].version_id;
    assert.ok(uuid.test(version), 'Active Worker version unavailable.');
    return version;
  };
  const codeFingerprint = async () => {
    const response = await fetcher(base + '/content', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, 'Worker content unavailable.');
    if (!(response.headers.get('content-type') ?? '').includes('multipart/form-data'))
      return hash(Buffer.from(await response.arrayBuffer()));
    const parts = await response.formData();
    const modules = [];
    for (const [name, part] of parts)
      if (typeof part !== 'string')
        modules.push([name, hash(Buffer.from(await part.arrayBuffer()))]);
    assert.ok(modules.length, 'Worker modules unavailable.');
    return hash(JSON.stringify(modules.sort(([a], [b]) => a.localeCompare(b))));
  };
  const before = await api('/settings');
  const originalFlag = guardedSettings(before, target);
  const originalVersion = await activeVersion();
  const originalCode = await codeFingerprint();
  const requested = state === 'inspect' ? originalFlag : state === 'open' ? 'true' : 'false';
  let mutated = false;
  let after = before;
  let version = originalVersion;
  if (requested !== originalFlag) {
    const settings = flagMetadata(before, originalVersion, requested);
    const form = new FormData();
    form.set(
      'settings',
      new Blob([JSON.stringify(settings)], { type: 'application/json' }),
      'settings.json',
    );
    await api('/settings', { method: 'PATCH', body: form });
    mutated = true;
    try {
      after = await api('/settings');
      assert.equal(guardedSettings(after, target), requested, 'Payment flag did not persist.');
      assert.equal(
        protectedFingerprint(after),
        protectedFingerprint(before),
        'Protected Worker settings changed.',
      );
      assert.equal(await codeFingerprint(), originalCode, 'Worker code changed.');
      version = await activeVersion();
    } catch (error) {
      await api('/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'percentage',
          versions: [{ version_id: originalVersion, percentage: 100 }],
        }),
      });
      throw error;
    }
  }
  try {
    const configResponse = await fetcher(target.origin + '/v1/public/config', {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(configResponse.status, 200, 'Public payment configuration unavailable.');
    const config = await configResponse.json();
    assert.equal(config.enabled, requested === 'true', 'Public payment flag disagrees.');
    if (config.enabled) {
      assert.equal(config.environment, target.environment, 'Public Paddle environment disagrees.');
      assert.equal(config.provider, 'paddle', 'Public payment provider disagrees.');
      assert.deepEqual(
        config.purchase,
        { amount: 4950, currency: 'USD' },
        'Public purchase amount disagrees.',
      );
      assert.deepEqual(
        config.renewal,
        { amount: 2000, currency: 'USD' },
        'Public renewal amount disagrees.',
      );
    }
    const health = await fetcher(target.origin + '/v1/public/health', {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(health.status, 200, 'Public licence health unavailable.');
    assert.equal((await health.json()).ok, true, 'Public licence authority unhealthy.');
    const receipt = {
      checkedAt: new Date().toISOString(),
      account: ACCOUNT,
      worker: target.worker,
      environment: target.environment,
      operation: state,
      mutated,
      originalFlag,
      flag: requested,
      originalVersion,
      version,
      codeSha256: originalCode,
      codeUnchanged: true,
      protectedSettingsUnchanged: true,
      protectedBindingNames: before.bindings
        .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
        .map(({ name }) => name)
        .sort(),
      health: true,
      publicConfigEnabled: config.enabled,
      realMoneyTransaction: false,
    };
    if (output) {
      await mkdir(resolve(output), { recursive: true });
      await writeFile(
        resolve(output, 'payment-flag-receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n',
      );
    }
    return receipt;
  } catch (error) {
    if (mutated)
      await api('/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'percentage',
          versions: [{ version_id: originalVersion, percentage: 100 }],
        }),
      });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const operation = process.argv[2]?.match(/^(production|sandbox)-(inspect|open|close)$/u);
  applyPaymentFlag({
    targetName: operation?.[1],
    state: operation?.[2],
    token: process.env.KERFDESK_PAYMENT_LAUNCH_CF_TOKEN,
    output: process.env.KERFDESK_PAYMENT_FLAG_EVIDENCE,
  })
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch(() => {
      console.error(
        'Payment flag operation failed. Review the redacted workflow evidence; no credential values were printed.',
      );
      process.exitCode = 1;
    });
}
