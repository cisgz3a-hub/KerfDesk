// Operator-only flag change. No code upload, secret retrieval or merchant request.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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

function canonicalJson(value) {
  const normalise = (item) => {
    if (Array.isArray(item)) return item.map(normalise);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalise(item[key])]),
      );
    return item;
  };
  return JSON.stringify(normalise(value));
}

function protectedFingerprint(settings) {
  const bindings = settings.bindings
    .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
    .map(canonicalJson)
    .sort();
  const fields = Object.fromEntries(
    configurationKeys
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
  return hash(canonicalJson({ bindings, fields }));
}

export function flagMetadata(settings, version, enabled, operationTag) {
  assert.ok(uuid.test(version), 'Active Worker version unavailable.');
  assert.ok(['true', 'false'].includes(enabled), 'Invalid payment flag.');
  if (operationTag !== undefined)
    assert.ok(
      typeof operationTag === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(operationTag),
      'Invalid payment operation tag.',
    );
  const fields = Object.fromEntries(
    configurationKeys
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
  return {
    ...fields,
    annotations: {
      ...(operationTag === undefined ? {} : { 'workers/tag': operationTag }),
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
  const started = Date.now();
  let recovering = false;
  let stage = 'operation-validation';
  let httpStatus = null;
  let before;
  let originalFlag;
  let originalVersion;
  let originalCode;
  let requested;
  let version;
  let mutationAttempted = false;
  let patchResponseReceived = false;
  const operationTag = 'payment-flag-' + randomUUID();
  const setStage = (value) => {
    stage = value;
    httpStatus = null;
  };
  const signal = (requestLimit) => {
    const remaining = started + (recovering ? 240000 : 180000) - Date.now();
    assert.ok(remaining > 0, 'Operator verification time budget exhausted.');
    return AbortSignal.timeout(Math.min(requestLimit, remaining));
  };
  const base =
    'https://api.cloudflare.com/client/v4/accounts/' +
    ACCOUNT +
    '/workers/scripts/' +
    target?.worker;
  const api = async (suffix, init = {}) => {
    setStage('cloudflare-' + suffix.slice(1) + '-' + (init.method ?? 'GET').toLowerCase());
    const response = await fetcher(base + suffix, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, ...init.headers },
      redirect: 'error',
      signal: signal(30000),
    });
    httpStatus = response.status;
    assert.ok(response.ok, 'Cloudflare request failed.');
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
    const current = newest.versions[0].version_id;
    assert.ok(uuid.test(current), 'Active Worker version unavailable.');
    return current;
  };
  const verifyOperationVersion = async (current) => {
    // Version annotations are top-level in Cloudflare's ApiVersion contract.
    const value = await api('/versions/' + current);
    setStage('operation-version-ownership-verification');
    assert.equal(value?.id, current, 'Wrong Worker version metadata.');
    assert.equal(
      value.annotations?.['workers/tag'],
      operationTag,
      'Active Worker version belongs to another operation.',
    );
    const result = await api('/versions?deployable=true');
    setStage('operation-version-uniqueness-verification');
    assert.ok(Array.isArray(result?.items), 'Deployable Worker versions unavailable.');
    const matches = result.items.filter(
      (item) => item.annotations?.['workers/tag'] === operationTag,
    );
    assert.equal(matches.length, 1, 'Worker operation ownership is ambiguous.');
    assert.equal(matches[0].id, current, 'Operation tag belongs to another Worker version.');
    const boundaryVersion = await activeVersion();
    setStage('operation-deployment-verification');
    assert.equal(boundaryVersion, current, 'Active Worker version changed during ownership check.');
  };
  const codeFingerprint = async () => {
    setStage('cloudflare-content-get');
    const response = await fetcher(base + '/content/v2', {
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: signal(30000),
    });
    httpStatus = response.status;
    assert.ok(response.ok, 'Worker content unavailable.');
    const mimeType = (response.headers.get('content-type') ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (mimeType !== 'multipart/form-data') {
      assert.ok(
        [
          'application/javascript',
          'application/javascript+module',
          'text/javascript',
          'application/octet-stream',
          'application/wasm',
        ].includes(mimeType),
        'Unexpected Worker content type.',
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString('utf8').trim();
      assert.ok(bytes.length && text.length, 'Worker content empty.');
      assert.ok(!text.startsWith('<'), 'HTML is not Worker content.');
      let json = false;
      try {
        JSON.parse(text);
        json = true;
      } catch {
        // Raw Worker JavaScript or binary content is not a JSON response document.
      }
      assert.equal(json, false, 'JSON is not Worker content.');
      return hash(canonicalJson({ mimeType, bytesSha256: hash(bytes) }));
    }
    const entrypoint = response.headers.get('cf-entrypoint');
    assert.ok(entrypoint && entrypoint.trim(), 'Worker entrypoint unavailable.');
    const parts = await response.formData();
    const entrypointPart = parts.get(entrypoint);
    assert.ok(
      entrypointPart && typeof entrypointPart !== 'string',
      'Worker entrypoint file unavailable.',
    );
    const modules = [];
    const names = new Set();
    for (const [name, part] of parts) {
      assert.ok(!names.has(name), 'Duplicate Worker module field.');
      names.add(name);
      assert.ok(
        typeof part !== 'string' && part.name && part.type,
        'Unexpected Worker module part.',
      );
      const bytes = Buffer.from(await part.arrayBuffer());
      if (name === entrypoint) assert.ok(bytes.length, 'Worker entrypoint empty.');
      modules.push([name, part.name, part.type, hash(bytes)]);
    }
    modules.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return hash(canonicalJson({ entrypoint, modules }));
  };
  const patchFlag = async () => {
    const form = new FormData();
    form.set(
      'settings',
      new Blob([JSON.stringify(flagMetadata(before, originalVersion, requested, operationTag))], {
        type: 'application/json',
      }),
      'settings.json',
    );
    // A lost HTTP response cannot establish that the provider did not apply the PATCH.
    mutationAttempted = true;
    await api('/settings', { method: 'PATCH', body: form });
    patchResponseReceived = true;
  };
  const verifyWorker = async (flag, expectedVersion) => {
    const value = await api('/settings');
    setStage('worker-settings-verification');
    assert.equal(guardedSettings(value, target), flag, 'Payment flag did not persist.');
    assert.equal(
      protectedFingerprint(value),
      protectedFingerprint(before),
      'Protected Worker settings changed.',
    );
    const code = await codeFingerprint();
    setStage('worker-content-verification');
    assert.equal(code, originalCode, 'Worker code changed.');
    const current = await activeVersion();
    setStage('worker-deployment-verification');
    if (expectedVersion) assert.equal(current, expectedVersion, 'Wrong active Worker version.');
    return current;
  };
  const verifyPublicConfig = async (flag) => {
    setStage('public-config-get');
    const response = await fetcher(target.origin + '/v1/public/config', {
      redirect: 'error',
      cache: 'no-store',
      signal: signal(15000),
    });
    httpStatus = response.status;
    assert.equal(response.status, 200, 'Public payment configuration unavailable.');
    const config = await response.json();
    setStage('public-config-verification');
    assert.equal(config.enabled, flag === 'true', 'Public payment flag disagrees.');
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
    return config;
  };
  const verifyHealth = async () => {
    setStage('public-health-get');
    const response = await fetcher(target.origin + '/v1/public/health', {
      redirect: 'error',
      cache: 'no-store',
      signal: signal(15000),
    });
    httpStatus = response.status;
    assert.equal(response.status, 200, 'Public licence health unavailable.');
    const health = await response.json();
    setStage('public-health-verification');
    assert.equal(health.ok, true, 'Public licence authority unhealthy.');
  };
  const receiptFields = () => ({
    checkedAt: new Date().toISOString(),
    account: ACCOUNT,
    worker: target?.worker ?? null,
    environment: target?.environment ?? null,
    operation: ['inspect', 'open', 'close'].includes(state) ? state : null,
    mutationAttempted,
    patchResponseReceived,
    operationTag: mutationAttempted ? operationTag : null,
    mutated: patchResponseReceived ? true : mutationAttempted ? null : false,
    originalFlag: originalFlag ?? null,
    flag: requested ?? null,
    originalVersion: originalVersion ?? null,
    version: version ?? null,
    codeSha256: originalCode ?? null,
    realMoneyTransaction: false,
  });
  const saveReceipt = async (receipt) => {
    if (!output) return;
    await mkdir(resolve(output), { recursive: true });
    await writeFile(
      resolve(output, 'payment-flag-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
  };
  try {
    assert.ok(
      target && ['inspect', 'open', 'close'].includes(state),
      'Invalid payment settings operation.',
    );
    assert.ok(
      typeof token === 'string' && token.length >= 20,
      'Cloudflare credential unavailable.',
    );
    originalVersion = await activeVersion();
    version = originalVersion;
    before = await api('/settings');
    setStage('preflight-settings-verification');
    originalFlag = guardedSettings(before, target);
    originalCode = await codeFingerprint();
    requested = state === 'inspect' ? originalFlag : state === 'open' ? 'true' : 'false';
    if (requested !== originalFlag) {
      const boundaryVersion = await activeVersion();
      setStage('pre-mutation-version-verification');
      assert.equal(
        boundaryVersion,
        originalVersion,
        'Active Worker version changed before mutation.',
      );
      await patchFlag();
      version = await verifyWorker(requested);
      await verifyOperationVersion(version);
    }
    const config = await verifyPublicConfig(requested);
    await verifyHealth();
    if (mutationAttempted) {
      const boundaryVersion = await activeVersion();
      setStage('operation-deployment-verification');
      assert.equal(boundaryVersion, version, 'Active Worker version changed during public checks.');
    }
    const receipt = {
      ...receiptFields(),
      outcome: 'verified',
      codeUnchanged: true,
      protectedSettingsUnchanged: true,
      protectedBindingNames: before.bindings
        .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
        .map(({ name }) => name)
        .sort(),
      health: true,
      publicConfigEnabled: config.enabled,
    };
    setStage('receipt-write');
    await saveReceipt(receipt);
    return receipt;
  } catch {
    // Never expose provider response bodies, assertion values or credential-bearing errors.
    const failure = { stage, httpStatus };
    const recovery = { mode: 'not-needed', verified: false };
    if (mutationAttempted) {
      recovering = true;
      recovery.mode =
        requested === 'true' && originalFlag === 'false'
          ? 'preserve-unverified-deployment'
          : 'keep-checkout-closed';
      try {
        const current = await activeVersion();
        recovery.observedVersion = current;
        let expectedVersion = current;
        if (requested === 'true' && originalFlag === 'false') {
          if (current === originalVersion) {
            // A refused or unacknowledged PATCH may already leave the original closed.
            recovery.mode = 'verify-original-disabled-deployment';
          } else {
            recovery.mode = 'verify-operation-ownership';
            recovery.ownershipVerified = false;
            await verifyOperationVersion(current);
            recovery.ownershipVerified = true;
            recovery.mode = 'restore-original-disabled-deployment';
            recovery.requestAttempted = true;
            recovery.requestAcknowledged = false;
            try {
              await api('/deployments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  strategy: 'percentage',
                  versions: [{ version_id: originalVersion, percentage: 100 }],
                }),
              });
              recovery.requestAcknowledged = true;
            } catch {
              recovery.requestFailure = { stage, httpStatus };
            }
          }
          expectedVersion = originalVersion;
        } else {
          // Closing must never restore a version whose checkout flag was enabled.
          recovery.mode = 'keep-checkout-closed';
          if (current !== originalVersion) await verifyOperationVersion(current);
        }
        recovery.version = await verifyWorker('false', expectedVersion);
        recovery.flag = 'false';
        recovery.workerVerified = true;
        recovery.publicConfigEnabled = (await verifyPublicConfig('false')).enabled;
        await verifyHealth();
        recovery.health = true;
        const boundaryVersion = await activeVersion();
        setStage('recovery-deployment-verification');
        assert.equal(
          boundaryVersion,
          expectedVersion,
          'Active Worker version changed during recovery.',
        );
        recovery.verified = true;
      } catch {
        if (recovery.mode === 'verify-operation-ownership')
          recovery.mode = 'preserve-unverified-deployment';
        recovery.verificationFailure = { stage, httpStatus };
      }
    }
    const receipt = {
      ...receiptFields(),
      outcome: 'failed',
      requestedFlag: requested ?? null,
      flag: recovery.flag ?? (mutationAttempted ? null : (originalFlag ?? null)),
      version: recovery.version ?? (mutationAttempted ? null : (version ?? null)),
      failure,
      recovery,
    };
    try {
      await saveReceipt(receipt);
    } catch {
      receipt.evidenceWritten = false;
    }
    const error = new Error('Payment flag operation failed at ' + failure.stage + '.');
    error.name = 'PaymentFlagOperationError';
    error.receipt = receipt;
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
    .catch((error) => {
      console.error(
        JSON.stringify(
          error.receipt ?? { outcome: 'failed', failure: { stage: 'operation-validation' } },
        ),
      );
      process.exitCode = 1;
    });
}
