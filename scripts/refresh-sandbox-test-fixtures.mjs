import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SANDBOX_WORKER,
  SANDBOX_ORIGIN,
  GOOD_CODE_SHA256,
  refreshSandboxScript,
} from './refresh-sandbox-script.mjs';

export const originalVersion = '11111111-1111-4111-8111-111111111111';
export const goodVersion = '202ea7dc-1111-4111-8111-111111111111';
export const nextVersion = '22222222-2222-4222-8222-222222222222';
export const unrelatedVersion = '33333333-3333-4333-8333-333333333333';
export const originalNumber = 3;
export const fixtureTag = 'kerfdesk-sandbox-refresh-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const code = Buffer.from(
  'export class SandboxLicenseAuthority {}; export default {fetch() {return new Response("ok");}};',
);
export const token = 'private-test-credential-never-print';
const buy = '<!doctype html><title>KerfDesk checkout</title>';
export const settings = () => ({
  compatibility_date: '2026-09-28',
  compatibility_flags: ['nodejs_compat'],
  usage_model: 'standard',
  logpush: false,
  observability: { enabled: true, logs: { enabled: true, invocation_logs: false } },
  tags: ['existing-sandbox'],
  assets: { config: { html_handling: 'none', not_found_handling: 'none' } },
  bindings: [
    ...Object.entries({
      LICENSING_ENABLED: 'true',
      PAYMENTS_ENABLED: 'false',
      PADDLE_ENVIRONMENT: 'sandbox',
      SIGNING_KEY_ID: 'sandbox-20260929',
      PAYMENT_PROVIDER: 'paddle',
      TRIALS_ENABLED: 'true',
      PADDLE_PURCHASE_PRICE_ID: 'current-sandbox-purchase',
      PADDLE_RENEWAL_PRICE_ID: 'current-sandbox-renewal',
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
      class_name: 'SandboxLicenseAuthority',
      namespace_id: 'b5b0cb9d97f4404582f884ff2b1a6ba8',
    },
    { name: 'ASSETS', type: 'assets' },
    ...['REQUEST_RATE_LIMITER', 'WEBHOOK_RATE_LIMITER', 'TRIAL_RATE_LIMITER'].map(
      (name, index) => ({
        name,
        type: 'ratelimit',
        namespace_id: String(1001 + index),
        simple: { limit: 30 + index, period: 60 },
      }),
    ),
  ],
});

// Only fixture bytes get a simulated attested digest. The helper's fixed production pin
// remains unchanged; different bytes and all protected-settings hashes use real SHA-256.
export function attestFixture(t) {
  const createHash = crypto.createHash;
  t.mock.method(crypto, 'createHash', (algorithm, ...args) => {
    const instance = createHash(algorithm, ...args);
    const update = instance.update.bind(instance);
    const digest = instance.digest.bind(instance);
    const chunks = [];
    instance.update = (value, encoding) => {
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, encoding));
      update(value, encoding);
      return instance;
    };
    instance.digest = (encoding) => {
      const actual = digest(encoding);
      return algorithm === 'sha256' && encoding === 'hex' && Buffer.concat(chunks).equals(code)
        ? GOOD_CODE_SHA256
        : actual;
    };
    return instance;
  });
}
export const content = ({
  bytes = code,
  entrypoint = 'worker.js',
  filename = 'worker.js',
  mimeType = 'application/javascript+module',
  extra = false,
} = {}) => {
  const form = new FormData();
  form.set(entrypoint, new Blob([bytes], { type: mimeType }), filename);
  if (extra) form.set('extra.js', new Blob(['export {};'], { type: mimeType }), 'extra.js');
  return new Response(form, { headers: { 'cf-entrypoint': entrypoint } });
};

export function versionResources(value) {
  return {
    bindings: structuredClone(value.bindings),
    script: {
      placement: structuredClone(value.placement ?? { mode: 'off' }),
      named_handlers: [{ name: 'SandboxLicenseAuthority', handlers: [] }],
    },
    script_runtime: {
      compatibility_date: value.compatibility_date,
      compatibility_flags: structuredClone(value.compatibility_flags),
      usage_model: value.usage_model,
      ...(value.limits === undefined ? {} : { limits: structuredClone(value.limits) }),
      migration_tag: 'sandbox-v1',
      exports: {
        SandboxLicenseAuthority: { type: 'durable-object', storage: 'sqlite', state: 'created' },
      },
    },
  };
}
const ok = (result) => Response.json({ success: true, result });
export function harness({
  versions = [{ id: goodVersion }],
  initialSettings,
  changeVersionAtBoundary = false,
  changeVersionAfterSettingsRead = false,
  concurrentAfterDeployment = false,
  concurrentAfterStage = false,
  concurrentAtActivationSettings = false,
  concurrentScriptSettingsChange,
  concurrentDuringRollbackOwnership = false,
  postUploadGradual = false,
  uploadOwnership = 'owned',
  ownershipAfterDeployment,
  duplicateOperationTag = false,
  loseUploadBeforeApply = false,
  sourceBytes = code,
  sourceExtra = false,
  sourceRaw = false,
  expectedUploadName = 'worker.js',
  sourceRawType = 'application/javascript',
  sourceRawHeader,
  sourceResponse,
  sourceBetaChange,
  stagedBetaChange,
  originalBetaChange,
  standardContentReturnsActive = false,
  readbackRaw = false,
  readbackRawHeader = null,
  loseUploadResponse = false,
  loseDeploymentResponse = false,
  loseDeploymentBeforeApply = false,
  refuseUpload = false,
  uploadErrorBody,
  uploadErrorAfterApply = false,
  deploymentErrorBody,
  postChange,
  originalResourceChange,
  stagedResourceChange,
  initialLatestVersion,
  inactiveUploadAtLatestRead,
  latestListChange,
  stagedVersionNumber,
  stagedCode = code,
  badHealth = false,
  changedBuy = false,
  currentIsGood = false,
  failedSettingsStatus,
} = {}) {
  let value = initialSettings ?? settings();
  const original = structuredClone(value);
  let version = currentIsGood ? goodVersion : originalVersion;
  const originalId = version;
  let reads = 0,
    settingsReads = 0,
    latestReads = 0,
    healthFailures = 0;
  let uploadedTag, staged;
  let activated = false;
  const records = new Map([
    [
      originalId,
      {
        value: original,
        bytes: currentIsGood ? code : Buffer.from('old dispatcher'),
        name: 'worker.js',
      },
    ],
  ]);
  const history = [
    { id: originalId, number: originalNumber },
    ...versions
      .filter(({ id }) => id !== originalId)
      .map((item, index) => ({ number: Math.max(1, originalNumber - index - 1), ...item })),
  ];
  const externalUploads = [];
  const uploadInactive = (id) => {
    assert.ok(!history.some((item) => item.id === id), 'Fixture inactive upload must be new.');
    const number = Math.max(...history.map((item) => item.number)) + 1;
    history.unshift({ id, number, annotations: { 'workers/tag': 'unrelated-operator' } });
    records.set(id, {
      value: structuredClone(original),
      bytes: Buffer.from('unrelated inactive upload'),
      name: 'worker.js',
    });
    externalUploads.push(id);
  };
  if (initialLatestVersion && initialLatestVersion !== originalId)
    uploadInactive(initialLatestVersion);
  const calls = [],
    mutations = [];
  const authorityState = {
    licence: 'existing-private-entitlement',
    orders: ['existing-paid-order'],
    devices: 2,
  };
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const endpoint = new URL(url);
    if (endpoint.origin === 'https://api.cloudflare.com') {
      assert.ok(
        endpoint.pathname.endsWith('/' + SANDBOX_WORKER) ||
          endpoint.pathname.includes('/' + SANDBOX_WORKER + '/'),
      );
      assert.ok(!endpoint.pathname.endsWith('/kerfdesk-desktop-licensing'));
      if (endpoint.pathname.endsWith('/settings')) {
        settingsReads += 1;
        if (concurrentScriptSettingsChange && staged && settingsReads === 4)
          concurrentScriptSettingsChange(value);
        if (
          (changeVersionAfterSettingsRead && settingsReads === 2) ||
          (concurrentAtActivationSettings && staged && settingsReads === 4)
        )
          version = unrelatedVersion;
        return failedSettingsStatus
          ? new Response(token, { status: failedSettingsStatus })
          : ok(value);
      }
      if (
        endpoint.pathname.includes('/workers/workers/') &&
        endpoint.pathname.includes('/versions/')
      ) {
        assert.equal(init.method ?? 'GET', 'GET');
        assert.equal(endpoint.search, '?include=modules');
        const selected = endpoint.pathname.split('/').at(-1);
        assert.ok([goodVersion, originalVersion, nextVersion, unrelatedVersion].includes(selected));
        const record = records.get(selected) ?? { bytes: sourceBytes, name: 'worker.js' };
        const result = {
          id: selected,
          number: history.find((item) => item.id === selected)?.number ?? originalNumber - 1,
          main_module: record.name,
          modules: [
            {
              name: record.name,
              content_type: 'application/javascript+module',
              content_base64: record.bytes.toString('base64'),
            },
          ],
        };
        if (selected === goodVersion && sourceExtra)
          result.modules.push({
            name: 'extra.js',
            content_type: 'application/javascript+module',
            content_base64: Buffer.from('export {};').toString('base64'),
          });
        if (selected === originalId && originalBetaChange) originalBetaChange(result);
        if (selected === goodVersion && sourceBetaChange) sourceBetaChange(result);
        if (selected === nextVersion && stagedBetaChange) stagedBetaChange(result);
        return ok(result);
      }
      if (endpoint.pathname.includes('/versions/')) {
        const selected = endpoint.pathname.split('/').at(-1);
        assert.ok([goodVersion, originalVersion, nextVersion, unrelatedVersion].includes(selected));
        const ownership =
          activated && ownershipAfterDeployment ? ownershipAfterDeployment : uploadOwnership;
        if (selected === nextVersion && ownership === 'unavailable')
          return new Response(token, { status: 503 });
        const annotations =
          selected === nextVersion && uploadedTag
            ? ownership === 'missing'
              ? {}
              : { 'workers/tag': ownership === 'different-tag' ? fixtureTag : uploadedTag }
            : { 'workers/tag': 'unrelated-operator' };
        const selectedValue = selected === nextVersion ? staged.value : original;
        const result = {
          id: selected === nextVersion && ownership === 'wrong-id' ? unrelatedVersion : selected,
          number: history.find((item) => item.id === selected)?.number ?? originalNumber - 1,
          metadata: { source: 'api', created_on: '2026-10-08T00:00:00Z' },
          annotations,
          resources: versionResources(selectedValue),
          ...(selectedValue.cache_options === undefined
            ? {}
            : { cache_options: selectedValue.cache_options }),
        };
        if (selected === nextVersion && ownership === 'nested-only') {
          result.metadata.annotations = annotations;
          delete result.annotations;
        }
        if (selected === originalId && originalResourceChange) originalResourceChange(result);
        if (selected === nextVersion && stagedResourceChange) stagedResourceChange(result);
        if (concurrentDuringRollbackOwnership && healthFailures >= 2 && selected === nextVersion)
          version = unrelatedVersion;
        return ok(result);
      }
      if (endpoint.pathname.endsWith('/versions') && init.method !== 'POST') {
        if (!endpoint.searchParams.has('deployable')) {
          for (const key of endpoint.searchParams.keys())
            assert.ok(['page', 'per_page'].includes(key));
          assert.equal(endpoint.searchParams.get('page') ?? '1', '1');
          latestReads += 1;
          if (inactiveUploadAtLatestRead === latestReads) uploadInactive(unrelatedVersion);
          const items = structuredClone(history.slice(0, 10));
          if (latestListChange) latestListChange(items, latestReads);
          return ok({ items });
        }
        assert.equal(endpoint.search, '?deployable=true');
        return ok({
          items: [
            ...versions,
            ...(staged ? [structuredClone(history.find((item) => item.id === nextVersion))] : []),
            ...(duplicateOperationTag && staged
              ? [{ id: unrelatedVersion, annotations: { 'workers/tag': uploadedTag } }]
              : []),
          ],
        });
      }
      if (endpoint.pathname.endsWith('/content/v2')) {
        const selected = endpoint.searchParams.get('version');
        assert.ok([goodVersion, originalVersion, nextVersion, unrelatedVersion].includes(selected));
        // The standard endpoint can ignore the requested UUID and serve active code.
        // Exact-version operator verification must never depend on this response.
        if (standardContentReturnsActive) {
          const active = records.get(version);
          return content({ bytes: active.bytes, entrypoint: active.name, filename: active.name });
        }
        if (selected === goodVersion && sourceResponse) return sourceResponse();
        const record = records.get(selected) ?? { bytes: sourceBytes, name: 'worker.js' };
        if (selected === nextVersion && readbackRaw)
          return new Response(record.bytes, {
            headers: {
              'Content-Type': 'application/javascript',
              ...(readbackRawHeader === null
                ? {}
                : {
                    'cf-entrypoint':
                      readbackRawHeader === 'match' ? record.name : readbackRawHeader,
                  }),
            },
          });
        if (selected === goodVersion && sourceRaw)
          return new Response(sourceBytes, {
            headers: {
              ...(sourceRawType ? { 'Content-Type': sourceRawType } : {}),
              ...(sourceRawHeader ? { 'cf-entrypoint': sourceRawHeader } : {}),
            },
          });
        return selected === goodVersion
          ? content({ bytes: sourceBytes, extra: sourceExtra })
          : content({ bytes: record.bytes, entrypoint: record.name, filename: record.name });
      }
      if (endpoint.pathname.endsWith('/deployments') && init.method === 'POST') {
        const payload = JSON.parse(init.body);
        const selected = payload.versions[0].version_id;
        assert.deepEqual(payload.versions, [{ version_id: selected, percentage: 100 }]);
        assert.equal(payload.strategy, 'percentage');
        assert.ok([nextVersion, originalId].includes(selected));
        mutations.push({
          method: 'POST',
          kind: selected === nextVersion ? 'activate' : 'rollback',
          payload,
        });
        if (selected === nextVersion && loseDeploymentBeforeApply) throw new Error(token);
        const record = records.get(selected);
        value = structuredClone(record.value);
        version = selected;
        if (selected === nextVersion) {
          activated = true;
          if (postChange) postChange(value);
          staged.value = value;
          if (concurrentAfterDeployment) version = unrelatedVersion;
          if (loseDeploymentResponse) throw new Error('Ambiguous activation ' + token);
          if (deploymentErrorBody) return Response.json(deploymentErrorBody, { status: 400 });
        }
        return ok({ id: 'explicit-deployment' });
      }
      if (endpoint.pathname.endsWith('/deployments')) {
        reads += 1;
        if (changeVersionAtBoundary && reads === 2) version = nextVersion;
        return ok({
          deployments: [
            {
              created_on: '2026-10-08T00:00:00Z',
              versions:
                postUploadGradual && activated
                  ? [
                      { version_id: nextVersion, percentage: 50 },
                      { version_id: unrelatedVersion, percentage: 50 },
                    ]
                  : [{ version_id: version, percentage: 100 }],
            },
          ],
        });
      }
      if (endpoint.pathname.endsWith('/versions') && init.method === 'POST') {
        assert.equal(endpoint.search, '?bindings_inherit=strict');
        const payload = JSON.parse(init.body.get('metadata'));
        const file = init.body.get(payload.main_module);
        assert.ok(file && typeof file !== 'string');
        assert.equal(file.type, 'application/javascript+module');
        assert.ok(Buffer.from(await file.arrayBuffer()).equals(code));
        assert.equal(payload.keep_assets, true);
        assert.equal(payload.main_module, expectedUploadName);
        assert.equal(payload.migrations, undefined);
        assert.equal(payload.bindings.length, original.bindings.length);
        for (const binding of payload.bindings)
          assert.deepEqual(
            binding,
            binding.name === 'PAYMENTS_ENABLED'
              ? { name: 'PAYMENTS_ENABLED', type: 'plain_text', text: 'false' }
              : { name: binding.name, type: 'inherit', version_id: 'latest' },
          );
        assert.deepEqual(payload.observability, original.observability);
        assert.deepEqual(payload.tags, original.tags);
        assert.match(
          payload.annotations['workers/tag'],
          /^kerfdesk-sandbox-refresh-[0-9a-f-]{36}$/u,
        );
        uploadedTag = payload.annotations['workers/tag'];
        mutations.push({ method: 'POST', kind: 'stage', payload });
        if (loseUploadBeforeApply) throw new Error(token);
        if (refuseUpload)
          return uploadErrorBody
            ? Response.json(uploadErrorBody, { status: 400 })
            : new Response(token, { status: 403 });
        staged = { value: structuredClone(original), bytes: stagedCode, name: payload.main_module };
        records.set(nextVersion, staged);
        history.unshift({
          id: nextVersion,
          number: stagedVersionNumber ?? Math.max(...history.map((item) => item.number)) + 1,
          annotations: { 'workers/tag': uploadedTag },
        });
        if (concurrentAfterStage) version = unrelatedVersion;
        if (loseUploadResponse) throw new Error('Ambiguous staged response ' + token);
        if (uploadErrorAfterApply) return Response.json(uploadErrorBody, { status: 400 });
        return ok({ id: nextVersion });
      }
      throw new Error('Unexpected sandbox API destination.');
    }
    assert.equal(endpoint.origin, SANDBOX_ORIGIN);
    if (endpoint.pathname === '/v1/public/config')
      return Response.json({
        enabled: value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text === 'true',
      });
    if (endpoint.pathname === '/buy.html')
      return new Response(changedBuy && version === nextVersion ? buy + '<!-- changed -->' : buy, {
        headers: { 'Content-Type': 'text/html' },
      });
    if (endpoint.pathname === '/v1/public/health') {
      const healthy = !badHealth && [goodVersion, nextVersion, unrelatedVersion].includes(version);
      if (!healthy) healthFailures += 1;
      return Response.json(
        { ok: healthy },
        { status: healthy ? 200 : version === originalVersion ? 405 : 503 },
      );
    }
    throw new Error('Unexpected public destination.');
  };
  return {
    fetcher,
    calls,
    mutations,
    flag: () => value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text,
    version: () => version,
    latest: () => history[0].id,
    latestReads: () => latestReads,
    externalUploads,
    binding: (name) => structuredClone(value.bindings.find((binding) => binding.name === name)),
    authorityState,
  };
}
export const run = (adapter, extra = {}) =>
  refreshSandboxScript({ operation: 'sandbox-refresh-code', token, ...extra }, adapter.fetcher);
