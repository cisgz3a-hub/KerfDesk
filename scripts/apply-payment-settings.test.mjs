import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
function harness({
  alterProtected = false,
  alterNestedLimit = false,
  reorderNested = false,
  badHealth = false,
  initialFlag = 'false',
  losePatchResponse = false,
  refusePatch = false,
  loseRollbackResponse = false,
  changeVersionAtBoundary = false,
  inspectHttpFailure = false,
  contentResponse,
} = {}) {
  let value = settings();
  value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text = initialFlag;
  const original = structuredClone(value);
  let version = originalVersion;
  let deploymentReads = 0;
  let contentReads = 0;
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
        if (refusePatch)
          return new Response('private-token-for-test-only provider body', { status: 403 });
        const flag = payload.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text;
        value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text = flag;
        if (alterProtected)
          value.bindings.find(({ name }) => name === 'SIGNING_KEY_ID').text = 'wrong-signing-key';
        if (alterNestedLimit)
          value.bindings.find(({ name }) => name === 'REQUEST_RATE_LIMITER').simple.limit = 9999;
        if (reorderNested) {
          const limit = value.bindings.find(({ name }) => name === 'REQUEST_RATE_LIMITER');
          limit.simple = { period: limit.simple.period, limit: limit.simple.limit };
        }
        version = nextVersion;
        if (losePatchResponse) throw new Error('Network lost with private-token-for-test-only');
        return ok(value);
      }
      if (url.endsWith('/settings'))
        return inspectHttpFailure
          ? new Response('private-token-for-test-only provider body', { status: 403 })
          : ok(value);
      if (url.endsWith('/deployments') && init.method === 'POST') {
        const payload = JSON.parse(init.body);
        mutations.push(payload);
        assert.deepEqual(payload.versions, [{ version_id: originalVersion, percentage: 100 }]);
        version = originalVersion;
        value = structuredClone(original);
        if (loseRollbackResponse) throw new Error('Lost rollback with private-token-for-test-only');
        return ok({ id: 'rolled-back' });
      }
      if (url.endsWith('/deployments')) {
        deploymentReads += 1;
        if (changeVersionAtBoundary && deploymentReads === 2) version = nextVersion;
        return ok({
          deployments: [
            {
              created_on: '2026-10-07T00:00:00Z',
              versions: [{ version_id: version, percentage: 100 }],
            },
          ],
        });
      }
      if (url.endsWith('/content/v2')) {
        contentReads += 1;
        return contentResponse
          ? contentResponse({ version, read: contentReads })
          : new Response('export default { fetch() { return new Response("ok"); } };', {
              headers: { 'Content-Type': 'application/javascript' },
            });
      }
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
  return {
    fetcher,
    mutations,
    calls,
    currentFlag: () => value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text,
  };
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

test('a nested limiter change is detected and the disabled original deployment is restored', async () => {
  const run = harness({ alterNestedLimit: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-settings-verification');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.flag, 'false');
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 2);
});

test('nested object key reordering does not falsely indicate a protected settings change', async () => {
  const run = harness({ reorderNested: true });
  const receipt = await applyPaymentFlag(
    { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
    run.fetcher,
  );
  assert.equal(receipt.protectedSettingsUnchanged, true);
  assert.equal(run.mutations.length, 1);
});

test('a PATCH applied before its response is lost is reconciled and rolled back when opening', async () => {
  const run = harness({ losePatchResponse: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'cloudflare-settings-patch');
      assert.equal(error.receipt.mutationAttempted, true);
      assert.equal(error.receipt.patchResponseReceived, false);
      assert.equal(error.receipt.mutated, null);
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.flag, 'false');
      assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
      assert.ok(!error.message.includes('private-token-for-test-only'));
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 2);
});

test('lost rollback acknowledgement is followed by verification of actual provider state', async () => {
  const run = harness({ losePatchResponse: true, loseRollbackResponse: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.recovery.requestAcknowledged, false);
      assert.equal(error.receipt.recovery.requestFailure.stage, 'cloudflare-deployments-post');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.version, originalVersion);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
});

test('unhealthy public proof after closing never redeploys the previously enabled version', async () => {
  const run = harness({ initialFlag: 'true', badHealth: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'close', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.deepEqual(error.receipt.failure, { stage: 'public-health-get', httpStatus: 503 });
      assert.equal(error.receipt.recovery.mode, 'keep-checkout-closed');
      assert.equal(error.receipt.recovery.workerVerified, true);
      assert.equal(error.receipt.recovery.flag, 'false');
      assert.equal(error.receipt.recovery.publicConfigEnabled, false);
      assert.equal(error.receipt.recovery.verified, false);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('a close PATCH with a lost response is reconciled without restoring enabled checkout', async () => {
  const run = harness({ initialFlag: 'true', losePatchResponse: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'close', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.recovery.mode, 'keep-checkout-closed');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.flag, 'false');
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('a refused close remains explicitly unverified and never redeploys enabled checkout', async () => {
  const run = harness({ initialFlag: 'true', refusePatch: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'close', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.deepEqual(error.receipt.failure, {
        stage: 'cloudflare-settings-patch',
        httpStatus: 403,
      });
      assert.equal(error.receipt.recovery.mode, 'keep-checkout-closed');
      assert.equal(error.receipt.recovery.verified, false);
      assert.equal(error.receipt.flag, null);
      assert.equal(error.receipt.requestedFlag, 'false');
      assert.equal(error.receipt.recovery.workerVerified, undefined);
      assert.equal(error.receipt.recovery.flag, undefined);
      assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'true');
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('a changed active version at the mutation boundary stops before any provider write', async () => {
  const run = harness({ changeVersionAtBoundary: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'pre-mutation-version-verification');
      assert.equal(error.receipt.mutationAttempted, false);
      assert.equal(error.receipt.recovery.mode, 'not-needed');
      return true;
    },
  );
  assert.equal(run.mutations.length, 0);
});

test('inspect HTTP failure reports only a redacted stage and status with no provider mutation', async () => {
  const run = harness({ inspectHttpFailure: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'inspect', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.deepEqual(error.receipt.failure, {
        stage: 'cloudflare-settings-get',
        httpStatus: 403,
      });
      assert.equal(error.receipt.outcome, 'failed');
      assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
      assert.ok(!error.message.includes('private-token-for-test-only'));
      return true;
    },
  );
  assert.equal(run.mutations.length, 0);
});

test('a failed inspect writes a redacted receipt for the always-upload workflow artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-payment-flag-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  try {
    const run = harness({ inspectHttpFailure: true });
    await assert.rejects(
      applyPaymentFlag(
        {
          targetName: 'production',
          state: 'inspect',
          token: 'private-token-for-test-only',
          output: directory,
        },
        run.fetcher,
      ),
    );
    const text = await readFile(join(directory, 'payment-flag-receipt.json'), 'utf8');
    const receipt = JSON.parse(text);
    assert.equal(receipt.outcome, 'failed');
    assert.deepEqual(receipt.failure, { stage: 'cloudflare-settings-get', httpStatus: 403 });
    assert.ok(!text.includes('private-token-for-test-only'));
    assert.equal(run.mutations.length, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

const workerModules = () => [
  {
    field: 'index.js',
    filename: 'index.js',
    type: 'application/javascript+module',
    bytes: 'export default { fetch() { return new Response("ok"); } };',
  },
  {
    field: 'other.js',
    filename: 'other.js',
    type: 'application/javascript+module',
    bytes: 'export default { fetch() { return new Response("other"); } };',
  },
];
const multipartContent = ({ modules = workerModules(), entrypoint = 'index.js' } = {}) => {
  const form = new FormData();
  for (const part of modules)
    form.append(part.field, new Blob([part.bytes], { type: part.type }), part.filename);
  return new Response(form, {
    headers: entrypoint === null ? {} : { 'cf-entrypoint': entrypoint },
  });
};

test('v2 multipart fingerprint is stable across boundaries and reversed module order', async () => {
  const run = harness({
    contentResponse: ({ read }) =>
      multipartContent({ modules: read % 2 === 0 ? workerModules().reverse() : workerModules() }),
  });
  const receipt = await applyPaymentFlag(
    { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
    run.fetcher,
  );
  assert.equal(receipt.codeUnchanged, true);
  assert.equal(run.mutations.length, 1);
  assert.ok(run.calls.some(({ url }) => url.endsWith('/content/v2')));
  assert.ok(!run.calls.some(({ url }) => url.endsWith('/content')));
});

test('changed multipart module bytes roll back an opening and verify original code', async () => {
  const run = harness({
    contentResponse: ({ version }) => {
      const modules = workerModules();
      if (version === nextVersion) modules[0].bytes += '\n// unexpected code change';
      return multipartContent({ modules });
    },
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-content-verification');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.version, originalVersion);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 2);
});

test('changed multipart entrypoint with identical module bytes rolls back an opening', async () => {
  const run = harness({
    contentResponse: ({ version }) =>
      multipartContent({ entrypoint: version === nextVersion ? 'other.js' : 'index.js' }),
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-content-verification');
      assert.equal(error.receipt.recovery.verified, true);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 2);
});

test('changed multipart module MIME type rolls back even when bytes and names are unchanged', async () => {
  const run = harness({
    contentResponse: ({ version }) => {
      const modules = workerModules();
      if (version === nextVersion) modules[1].type = 'text/plain';
      return multipartContent({ modules });
    },
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-content-verification');
      assert.equal(error.receipt.recovery.verified, true);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
});

test('changed multipart filename is detected independently of the unchanged field and bytes', async () => {
  const run = harness({
    contentResponse: ({ version }) => {
      const modules = workerModules();
      if (version === nextVersion) modules[1].filename = 'renamed.js';
      return multipartContent({ modules });
    },
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-content-verification');
      assert.equal(error.receipt.recovery.verified, true);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
});

test('HTTP 200 JSON errors cannot serve as Worker code, even with a JavaScript MIME type', async () => {
  for (const contentType of ['application/json', 'application/javascript']) {
    const run = harness({
      contentResponse: () =>
        new Response(JSON.stringify({ success: false, error: 'private-token-for-test-only' }), {
          headers: { 'Content-Type': contentType },
        }),
    });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.deepEqual(error.receipt.failure, {
          stage: 'cloudflare-content-get',
          httpStatus: 200,
        });
        assert.equal(error.receipt.mutationAttempted, false);
        assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
        return true;
      },
    );
    assert.equal(run.mutations.length, 0);
  }
});

test('empty, missing-type and HTML raw content fail before any mutation', async () => {
  for (const [body, contentType] of [
    ['', 'application/javascript'],
    ['   \n', 'application/javascript'],
    ['<html>provider error</html>', 'text/html'],
    ['<html>provider error</html>', 'application/javascript'],
    [new Uint8Array([1, 2, 3]), null],
  ]) {
    const run = harness({
      contentResponse: () =>
        new Response(body, { headers: contentType ? { 'Content-Type': contentType } : {} }),
    });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.equal(error.receipt.failure.stage, 'cloudflare-content-get');
        assert.equal(error.receipt.mutationAttempted, false);
        return true;
      },
    );
    assert.equal(run.mutations.length, 0);
  }
});

test('multipart must name an unambiguous nonempty entrypoint file', async () => {
  const malformed = [
    () => multipartContent({ entrypoint: null }),
    () => multipartContent({ entrypoint: 'absent.js' }),
    () => {
      const modules = workerModules();
      modules[0].bytes = '';
      return multipartContent({ modules });
    },
    () => multipartContent({ modules: [...workerModules(), workerModules()[0]] }),
    () => {
      const form = new FormData();
      form.set('index.js', 'a string is not a module file');
      return new Response(form, { headers: { 'cf-entrypoint': 'index.js' } });
    },
  ];
  for (const contentResponse of malformed) {
    const run = harness({ contentResponse });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.equal(error.receipt.failure.stage, 'cloudflare-content-get');
        assert.equal(error.receipt.mutationAttempted, false);
        return true;
      },
    );
    assert.equal(run.mutations.length, 0);
  }
});

test('expected nonempty binary content can be fingerprinted without execution', async () => {
  const run = harness({
    contentResponse: () =>
      new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), {
        headers: { 'Content-Type': 'application/wasm' },
      }),
  });
  const receipt = await applyPaymentFlag(
    { targetName: 'production', state: 'inspect', token: 'private-token-for-test-only' },
    run.fetcher,
  );
  assert.equal(receipt.codeUnchanged, true);
  assert.equal(run.mutations.length, 0);
});
