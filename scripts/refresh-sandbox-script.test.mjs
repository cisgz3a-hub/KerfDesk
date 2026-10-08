import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SANDBOX_WORKER,
  SANDBOX_ORIGIN,
  GOOD_VERSION_PREFIX,
  GOOD_CODE_SHA256,
  guardSandboxRefresh,
  sandboxUploadMetadata,
  readSandboxModule,
  refreshSandboxScript,
} from './refresh-sandbox-script.mjs';

const originalVersion = '11111111-1111-4111-8111-111111111111';
const goodVersion = '202ea7dc-1111-4111-8111-111111111111';
const nextVersion = '22222222-2222-4222-8222-222222222222';
const unrelatedVersion = '33333333-3333-4333-8333-333333333333';
const fixtureTag = 'kerfdesk-sandbox-refresh-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const code = Buffer.from(
  'export class SandboxLicenseAuthority {}; export default {fetch() {return new Response("ok");}};',
);
const token = 'private-test-credential-never-print';
const buy = '<!doctype html><title>KerfDesk checkout</title>';
const settings = () => ({
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
function attestFixture(t) {
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
const content = ({
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
const ok = (result) => Response.json({ success: true, result });
function harness({
  versions = [{ id: goodVersion }],
  initialSettings,
  changeVersionAtBoundary = false,
  changeVersionAfterSettingsRead = false,
  concurrentAfterUpload = false,
  concurrentDuringRollbackOwnership = false,
  postUploadGradual = false,
  uploadOwnership = 'owned',
  duplicateOperationTag = false,
  loseUploadBeforeApply = false,
  sourceBytes = code,
  sourceExtra = false,
  loseUploadResponse = false,
  refuseUpload = false,
  postChange,
  badHealth = false,
  changedBuy = false,
  currentIsGood = false,
  failedSettingsStatus,
} = {}) {
  let value = initialSettings ?? settings();
  const original = structuredClone(value);
  let version = currentIsGood ? goodVersion : originalVersion;
  let deployedCode = currentIsGood ? code : Buffer.from('old dispatcher');
  let reads = 0;
  let settingsReads = 0;
  let ownershipReads = 0;
  let uploadedTag;
  const calls = [];
  const mutations = [];
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
        if (changeVersionAfterSettingsRead && settingsReads === 2) version = unrelatedVersion;
        return failedSettingsStatus
          ? new Response(token, { status: failedSettingsStatus })
          : ok(value);
      }
      if (endpoint.pathname.includes('/versions/')) {
        const selected = endpoint.pathname.split('/').at(-1);
        assert.ok([goodVersion, originalVersion, nextVersion, unrelatedVersion].includes(selected));
        ownershipReads += 1;
        if (selected === nextVersion && uploadOwnership === 'unavailable')
          return new Response(token, { status: 503 });
        const annotations =
          selected === nextVersion && uploadedTag
            ? uploadOwnership === 'missing'
              ? {}
              : { 'workers/tag': uploadOwnership === 'different-tag' ? fixtureTag : uploadedTag }
            : { 'workers/tag': 'unrelated-operator' };
        const result = {
          id: uploadOwnership === 'wrong-id' ? unrelatedVersion : selected,
          number: 3,
          metadata: { source: 'api', created_on: '2026-10-08T00:00:00Z' },
          annotations,
          resources: {},
        };
        if (uploadOwnership === 'nested-only') {
          result.metadata.annotations = annotations;
          delete result.annotations;
        }
        if (concurrentDuringRollbackOwnership && ownershipReads === 3) version = unrelatedVersion;
        return ok(result);
      }
      if (endpoint.pathname.endsWith('/versions')) {
        assert.equal(endpoint.search, '?deployable=true');
        return ok({
          items: [
            ...versions,
            ...(uploadedTag && !refuseUpload && !loseUploadBeforeApply
              ? [{ id: nextVersion, annotations: { 'workers/tag': uploadedTag } }]
              : []),
            ...(duplicateOperationTag && uploadedTag
              ? [{ id: unrelatedVersion, annotations: { 'workers/tag': uploadedTag } }]
              : []),
          ],
        });
      }
      if (endpoint.pathname.endsWith('/content/v2')) {
        const selected = endpoint.searchParams.get('version');
        assert.ok([goodVersion, originalVersion, nextVersion, unrelatedVersion].includes(selected));
        return selected === goodVersion
          ? content({ bytes: sourceBytes, extra: sourceExtra })
          : content({ bytes: deployedCode });
      }
      if (endpoint.pathname.endsWith('/deployments') && init.method === 'POST') {
        const payload = JSON.parse(init.body);
        assert.deepEqual(payload.versions, [
          { version_id: currentIsGood ? goodVersion : originalVersion, percentage: 100 },
        ]);
        mutations.push({ method: 'POST', payload });
        value = structuredClone(original);
        version = currentIsGood ? goodVersion : originalVersion;
        deployedCode = currentIsGood ? code : Buffer.from('old dispatcher');
        return ok({ id: 'original-current-version-restored' });
      }
      if (endpoint.pathname.endsWith('/deployments')) {
        reads += 1;
        if (changeVersionAtBoundary && reads === 2) version = nextVersion;
        return ok({
          deployments: [
            {
              created_on: '2026-10-08T00:00:00Z',
              versions:
                postUploadGradual && uploadedTag
                  ? [
                      { version_id: nextVersion, percentage: 50 },
                      { version_id: unrelatedVersion, percentage: 50 },
                    ]
                  : [{ version_id: version, percentage: 100 }],
            },
          ],
        });
      }
      if (endpoint.pathname.endsWith('/' + SANDBOX_WORKER) && init.method === 'PUT') {
        assert.equal(endpoint.search, '?bindings_inherit=strict');
        const payload = JSON.parse(init.body.get('metadata'));
        const file = init.body.get(payload.main_module);
        assert.ok(file && typeof file !== 'string');
        assert.equal(file.type, 'application/javascript+module');
        assert.ok(Buffer.from(await file.arrayBuffer()).equals(code));
        assert.equal(payload.keep_assets, true);
        assert.equal(payload.main_module, 'worker.js');
        assert.equal(payload.migrations, undefined);
        assert.equal(payload.bindings.length, original.bindings.length);
        for (const binding of payload.bindings)
          assert.deepEqual(
            binding,
            binding.name === 'PAYMENTS_ENABLED'
              ? { name: 'PAYMENTS_ENABLED', type: 'plain_text', text: 'false' }
              : { name: binding.name, type: 'inherit', version_id: originalVersion },
          );
        assert.deepEqual(payload.observability, original.observability);
        assert.deepEqual(payload.tags, original.tags);
        assert.match(
          payload.annotations['workers/tag'],
          /^kerfdesk-sandbox-refresh-[0-9a-f-]{36}$/u,
        );
        uploadedTag = payload.annotations['workers/tag'];
        mutations.push({ method: 'PUT', payload });
        if (loseUploadBeforeApply)
          throw new Error('Response lost before any applied change: ' + token);
        if (refuseUpload) return new Response(token, { status: 403 });
        version = nextVersion;
        deployedCode = code;
        if (postChange) postChange(value);
        if (concurrentAfterUpload) version = unrelatedVersion;
        if (loseUploadResponse) throw new Error('Ambiguous response with ' + token);
        return ok({ id: SANDBOX_WORKER });
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
  };
}
const run = (adapter, extra = {}) =>
  refreshSandboxScript({ operation: 'sandbox-refresh-code', token, ...extra }, adapter.fetcher);

test('upload metadata inherits every current binding and asset, without migrations or historic settings', () => {
  const value = settings();
  const metadata = sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag);
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.main_module, 'worker.js');
  assert.equal(metadata.migrations, undefined);
  assert.equal(metadata.assets, undefined);
  assert.equal(metadata.annotations['workers/tag'], fixtureTag);
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY'),
    { name: 'LICENSE_AUTHORITY', type: 'inherit', version_id: originalVersion },
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'ASSETS'),
    { name: 'ASSETS', type: 'inherit', version_id: originalVersion },
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'SIGNING_PRIVATE_JWK'),
    { name: 'SIGNING_PRIVATE_JWK', type: 'inherit', version_id: originalVersion },
  );
  assert.ok(!JSON.stringify(metadata).includes(goodVersion));
});
test('wrong environment, enabled checkout, namespace, class or missing assets stop before mutation', async () => {
  for (const mutate of [
    (s) => {
      s.bindings.find(({ name }) => name === 'PADDLE_ENVIRONMENT').text = 'live';
    },
    (s) => {
      s.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text = 'true';
    },
    (s) => {
      s.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY').namespace_id =
        '00000000000000000000000000000000';
    },
    (s) => {
      s.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY').class_name = 'LicenseAuthority';
    },
    (s) => {
      s.bindings = s.bindings.filter(({ name }) => name !== 'ASSETS');
    },
  ]) {
    const value = settings();
    mutate(value);
    assert.throws(() => guardSandboxRefresh(value));
    const adapter = harness({ initialSettings: value });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.mutationAttempted, false);
      assert.equal(error.receipt.flag, null);
      return true;
    });
    assert.equal(adapter.mutations.length, 0);
  }
});
test('only the exact sandbox-refresh-code operation is accepted', async () => {
  const adapter = harness();
  await assert.rejects(run(adapter, { operation: 'production-refresh-code' }));
  assert.equal(adapter.calls.length, 0);
});
test('missing, ambiguous or short source-version matches fail before upload', async () => {
  for (const versions of [
    [],
    [{ id: goodVersion }, { id: '202ea7dc-2222-4222-8222-222222222222' }],
    [{ id: GOOD_VERSION_PREFIX }],
  ]) {
    const adapter = harness({ versions });
    await assert.rejects(run(adapter));
    assert.equal(adapter.mutations.length, 0);
    assert.ok(!adapter.calls.some(({ url }) => url.includes('/content/v2')));
  }
});
test('the real fixed code SHA rejects unverified fixture bytes before mutation', async () => {
  assert.notEqual(crypto.createHash('sha256').update(code).digest('hex'), GOOD_CODE_SHA256);
  const adapter = harness();
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-attested-content-get');
    return true;
  });
  assert.equal(adapter.mutations.length, 0);
});
test('attested content must be exactly one JavaScript module with a matching cf-entrypoint', async (t) => {
  attestFixture(t);
  await assert.rejects(readSandboxModule(content({ extra: true })));
  await assert.rejects(readSandboxModule(content({ mimeType: 'application/json' })));
  const noHeader = content();
  noHeader.headers.delete('cf-entrypoint');
  await assert.rejects(readSandboxModule(noHeader));
  const wrongHeader = content();
  wrongHeader.headers.set('cf-entrypoint', 'absent.js');
  await assert.rejects(readSandboxModule(wrongHeader));
  await assert.rejects(readSandboxModule(Response.json({ success: false })));
});
test('refresh preserves current authority/resources/assets and verifies fresh code, closed checkout and health', async (t) => {
  attestFixture(t);
  const adapter = harness();
  const receipt = await run(adapter);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.sourceVersion, goodVersion);
  assert.equal(receipt.version, nextVersion);
  assert.equal(receipt.operationVersion, nextVersion);
  assert.equal(adapter.mutations[0].payload.annotations['workers/tag'], receipt.operationTag);
  assert.equal(receipt.flag, 'false');
  assert.equal(receipt.health, true);
  assert.equal(receipt.codeVerified, true);
  assert.equal(receipt.buyHtmlUnchanged, true);
  assert.equal(receipt.protectedSettingsUnchanged, true);
  assert.equal(adapter.mutations.length, 1);
  assert.ok(!JSON.stringify(receipt).includes(token));
  assert.ok(
    adapter.calls.every(
      ({ url }) =>
        url.startsWith('https://api.cloudflare.com/') || url.startsWith(SANDBOX_ORIGIN + '/'),
    ),
  );
});
test('already active attested code is verified without uploading or changing any setting', async (t) => {
  attestFixture(t);
  const adapter = harness({ currentIsGood: true });
  const receipt = await run(adapter);
  assert.equal(receipt.mutationAttempted, false);
  assert.equal(receipt.version, goodVersion);
  assert.equal(adapter.mutations.length, 0);
});
test('active-version race stops before any upload', async (t) => {
  attestFixture(t);
  const adapter = harness({ changeVersionAtBoundary: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-pre-mutation-version-check');
    return true;
  });
  assert.equal(adapter.mutations.length, 0);
});
test('nested current limiter changes trigger rollback to the original current closed version', async (t) => {
  attestFixture(t);
  const adapter = harness({
    postChange: (s) => {
      s.bindings.find(({ name }) => name === 'REQUEST_RATE_LIMITER').simple.limit = 9999;
    },
  });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-protected-settings-verification');
    assert.equal(error.receipt.recovery.closedVerified, true);
    assert.equal(error.receipt.recovery.version, originalVersion);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT', 'POST'],
  );
  assert.equal(adapter.flag(), 'false');
});
test('exposed nested asset configuration changes are detected rather than certified preserved', async (t) => {
  attestFixture(t);
  const adapter = harness({
    postChange: (s) => {
      s.assets.config.html_handling = 'force-trailing-slash';
    },
  });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-protected-settings-verification');
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.equal(adapter.flag(), 'false');
});
test('changed public buy HTML fails and verifies restoration of current checkout assets', async (t) => {
  attestFixture(t);
  const adapter = harness({ changedBuy: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-buy-html-verification');
    assert.equal(error.receipt.recovery.buyHtmlUnchanged, true);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.equal(adapter.flag(), 'false');
});
test('applied upload with lost acknowledgement is reconciled by exact code/settings/assets/health proof', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseUploadResponse: true });
  const receipt = await run(adapter);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.uploadResponseReceived, false);
  assert.equal(receipt.mutated, null);
  assert.equal(receipt.reconciliation.readBackVerified, true);
  assert.equal(receipt.reconciliation.initialFailure.stage, 'sandbox-code-upload');
  assert.equal(receipt.flag, 'false');
  assert.equal(adapter.mutations.length, 1);
  assert.ok(!JSON.stringify(receipt).includes(token));
});
test('failed refresh health proof never opens checkout and restores only the original current version', async (t) => {
  attestFixture(t);
  const adapter = harness({ badHealth: true });
  await assert.rejects(run(adapter), (error) => {
    assert.deepEqual(error.receipt.failure, {
      stage: 'sandbox-public-health-get',
      httpStatus: 503,
    });
    assert.equal(error.receipt.health, false);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.equal(adapter.flag(), 'false');
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT', 'POST'],
  );
});
test('refused upload is reconciled without printing private provider or network error bodies', async (t) => {
  attestFixture(t);
  const adapter = harness({ refuseUpload: true });
  await assert.rejects(run(adapter), (error) => {
    assert.deepEqual(error.receipt.failure, { stage: 'sandbox-code-upload', httpStatus: 403 });
    assert.ok(!JSON.stringify(error.receipt).includes(token));
    assert.ok(!error.message.includes(token));
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.equal(adapter.flag(), 'false');
});
test('a deployment arriving after the final settings read stops before upload', async (t) => {
  attestFixture(t);
  const adapter = harness({ changeVersionAfterSettingsRead: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-final-pre-upload-version-check');
    return true;
  });
  assert.equal(adapter.mutations.length, 0);
  assert.equal(adapter.version(), unrelatedVersion);
});

test('a concurrent post-upload deployment is left untouched even with matching code and settings', async (t) => {
  attestFixture(t);
  const adapter = harness({ concurrentAfterUpload: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-operation-ownership-verification');
    assert.equal(error.receipt.recovery.mode, 'not-restored-unowned-deployment');
    assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, false);
    assert.equal(error.receipt.flag, null);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT'],
  );
  assert.equal(adapter.version(), unrelatedVersion);
});

test('a deployment arriving during rollback ownership read prevents rollback', async (t) => {
  attestFixture(t);
  const adapter = harness({ badHealth: true, concurrentDuringRollbackOwnership: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(
      error.receipt.recovery.ownershipFailure.stage,
      'sandbox-rollback-ownership-boundary-check',
    );
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, false);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT'],
  );
  assert.equal(adapter.version(), unrelatedVersion);
});

test('lost upload acknowledgement never permits rollback without exact top-level version ownership', async (t) => {
  attestFixture(t);
  for (const uploadOwnership of [
    'missing',
    'different-tag',
    'nested-only',
    'wrong-id',
    'unavailable',
  ]) {
    const adapter = harness({ loseUploadResponse: true, uploadOwnership });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.uploadResponseReceived, false);
      assert.equal(error.receipt.recovery.mode, 'not-restored-unowned-deployment');
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, false);
      assert.equal(error.receipt.flag, null);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ method }) => method),
      ['PUT'],
    );
    assert.equal(adapter.version(), nextVersion);
  }
});

test('a lost acknowledgement followed by an unrelated deployment never reverts that deployment', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseUploadResponse: true, concurrentAfterUpload: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT'],
  );
  assert.equal(adapter.version(), unrelatedVersion);
});

test('owned upload with lost acknowledgement and failed health can restore the original closed version', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseUploadResponse: true, badHealth: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.uploadResponseReceived, false);
    assert.equal(error.receipt.recovery.ownershipVerified, true);
    assert.equal(error.receipt.recovery.rollbackAttempted, true);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT', 'POST'],
  );
  assert.equal(adapter.version(), originalVersion);
});

test('unapplied ambiguous upload verifies the already-original closed version without POST', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseUploadBeforeApply: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.recovery.mode, 'original-closed-sandbox-deployment-already-active');
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT'],
  );
  assert.equal(adapter.version(), originalVersion);
});

test('duplicate operation tags cannot establish ownership or permit rollback', async (t) => {
  attestFixture(t);
  for (const loseUploadResponse of [false, true]) {
    const adapter = harness({ duplicateOperationTag: true, loseUploadResponse });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(
        error.receipt.recovery.ownershipFailure.stage,
        'sandbox-operation-uniqueness-verification',
      );
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, false);
      assert.equal(error.receipt.flag, null);
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ method }) => method),
      ['PUT'],
    );
    assert.equal(adapter.version(), nextVersion);
  }
});

test('a concurrent gradual deployment cannot establish rollback ownership', async (t) => {
  attestFixture(t);
  const adapter = harness({ postUploadGradual: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, false);
    assert.equal(error.receipt.flag, null);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT'],
  );
});

test('separate refresh attempts receive distinct ownership tags', async (t) => {
  attestFixture(t);
  const first = harness();
  const second = harness();
  const one = await run(first);
  const two = await run(second);
  assert.notEqual(one.operationTag, two.operationTag);
  assert.equal(first.mutations[0].payload.annotations['workers/tag'], one.operationTag);
  assert.equal(second.mutations[0].payload.annotations['workers/tag'], two.operationTag);
});

test('preflight HTTP failure writes a redacted operator receipt without any provider mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-sandbox-refresh-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  try {
    const adapter = harness({ failedSettingsStatus: 429 });
    await assert.rejects(run(adapter, { output: directory }));
    const raw = await readFile(join(directory, 'sandbox-refresh-receipt.json'), 'utf8');
    const receipt = JSON.parse(raw);
    assert.deepEqual(receipt.failure, { stage: 'sandbox-settings-get', httpStatus: 429 });
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.productionCalls, false);
    assert.ok(!raw.includes(token));
    assert.equal(adapter.mutations.length, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});
