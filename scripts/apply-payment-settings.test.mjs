import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { applyPaymentFlag, flagMetadata, guardedSettings } from './apply-payment-settings.mjs';

import {
  originalVersion,
  nextVersion,
  unrelatedVersion,
  target,
  settings,
  harness,
} from './apply-payment-test-fixtures.mjs';

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
  assert.deepEqual(metadata.annotations, {
    'workers/message': 'Enable authorised checkout; preserve code and authority',
  });
  assert.equal(metadata.bindings.length, value.bindings.length);
  assert.equal(value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text, 'false');
});

test('operation tags are optional, validated and unique for separate flag mutations', async () => {
  const value = settings();
  assert.equal(
    flagMetadata(value, originalVersion, 'false', 'payment-operation-123').annotations[
      'workers/tag'
    ],
    'payment-operation-123',
  );
  for (const tag of ['', 'contains spaces', 'x'.repeat(65), 123])
    assert.throws(() => flagMetadata(value, originalVersion, 'true', tag));
  const first = harness();
  const second = harness();
  const receipts = await Promise.all(
    [first, second].map((run) =>
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
    ),
  );
  assert.notEqual(receipts[0].operationTag, receipts[1].operationTag);
  for (const [index, run] of [first, second].entries()) {
    assert.equal(run.mutations[0].annotations['workers/tag'], receipts[index].operationTag);
    assert.ok(run.calls.some(({ url }) => url.endsWith('/versions/' + nextVersion)));
    assert.ok(run.calls.some(({ url }) => url.endsWith('/versions?deployable=true')));
  }
});

test('a refused open verifies the original closed deployment without a rollback POST', async () => {
  const run = harness({ refusePatch: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.deepEqual(error.receipt.failure, {
        stage: 'cloudflare-settings-patch',
        httpStatus: 403,
      });
      assert.equal(error.receipt.recovery.mode, 'verify-original-disabled-deployment');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.version, originalVersion);
      assert.equal(error.receipt.recovery.requestAttempted, undefined);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('a lost PATCH ACK with the original closed already active only verifies readback', async () => {
  const run = harness({ losePatchResponse: true, originalClosedAfterLostPatch: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.patchResponseReceived, false);
      assert.equal(error.receipt.recovery.mode, 'verify-original-disabled-deployment');
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.version, originalVersion);
      return true;
    },
  );
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('post-PATCH concurrent deployment is preserved even if the PATCH acknowledgement is lost', async () => {
  for (const losePatchResponse of [false, true]) {
    const run = harness({ concurrentAfterPatch: true, losePatchResponse });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.equal(error.receipt.patchResponseReceived, !losePatchResponse);
        assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
        assert.equal(error.receipt.recovery.verified, false);
        assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
        assert.equal(error.receipt.recovery.ownershipVerified, false);
        assert.equal(error.receipt.flag, null);
        assert.equal(error.receipt.version, null);
        assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
        return true;
      },
    );
    assert.equal(run.currentVersion(), unrelatedVersion);
    assert.equal(run.currentFlag(), 'true');
    assert.equal(run.mutations.length, 1);
    assert.ok(!run.calls.some(({ method }) => method === 'POST'));
  }
});

test('a concurrent deployment during public checks is never replaced by failed-open recovery', async () => {
  for (const badHealth of [false, true]) {
    const run = harness({ concurrentAfterHealth: true, badHealth });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.equal(
          error.receipt.failure.stage,
          badHealth ? 'public-health-get' : 'operation-deployment-verification',
        );
        assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
        assert.equal(error.receipt.recovery.verified, false);
        assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
        return true;
      },
    );
    // This unrelated deployment is closed, but belongs to someone else and is untouched.
    assert.equal(run.currentFlag(), 'false');
    assert.equal(run.currentVersion(), unrelatedVersion);
    assert.equal(run.mutations.length, 1);
    assert.ok(!run.calls.some(({ method }) => method === 'POST'));
  }
});

test('lost PATCH ACK requires exact top-level ownership and unique version list evidence', async () => {
  for (const option of [
    'missingOperationAnnotation',
    'nestedOperationAnnotation',
    'wrongVersionMetadataId',
    'duplicateOperationTag',
    'versionListFailure',
  ]) {
    const run = harness({ losePatchResponse: true, [option]: true });
    await assert.rejects(
      applyPaymentFlag(
        { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
        run.fetcher,
      ),
      (error) => {
        assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
        assert.equal(error.receipt.recovery.verified, false);
        assert.equal(error.receipt.recovery.ownershipVerified, false);
        assert.equal(error.receipt.recovery.requestAttempted, undefined);
        assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
        return true;
      },
    );
    assert.equal(run.currentVersion(), nextVersion);
    assert.equal(run.mutations.length, 1);
    assert.ok(!run.calls.some(({ method }) => method === 'POST'));
  }
});

test('lost PATCH ACK with unavailable active-version readback never sends a blind rollback', async () => {
  const run = harness({ losePatchResponse: true, unavailableRecoveryDeployment: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
      assert.equal(error.receipt.recovery.verified, false);
      assert.deepEqual(error.receipt.recovery.verificationFailure, {
        stage: 'cloudflare-deployments-get',
        httpStatus: 403,
      });
      assert.equal(error.receipt.flag, null);
      assert.equal(error.receipt.version, null);
      assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
      return true;
    },
  );
  assert.equal(run.currentVersion(), nextVersion);
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('a concurrent deployment after ownership metadata reads prevents the rollback POST', async () => {
  const run = harness({ alterNestedLimit: true, concurrentAtOwnershipBoundary: true });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'worker-settings-verification');
      assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
      assert.equal(
        error.receipt.recovery.verificationFailure.stage,
        'operation-deployment-verification',
      );
      assert.equal(error.receipt.recovery.verified, false);
      return true;
    },
  );
  assert.equal(run.currentVersion(), unrelatedVersion);
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
});

test('exhausting the 180s normal budget after PATCH preserves the 240s recovery reserve', async (context) => {
  let now = 0;
  context.mock.method(Date, 'now', () => now);
  const run = harness({
    afterPatch: () => {
      now = 180001;
    },
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.deepEqual(error.receipt.failure, {
        stage: 'cloudflare-settings-get',
        httpStatus: null,
      });
      assert.equal(error.receipt.recovery.ownershipVerified, true);
      assert.equal(error.receipt.recovery.requestAcknowledged, true);
      assert.equal(error.receipt.recovery.verified, true);
      assert.equal(error.receipt.recovery.version, originalVersion);
      return true;
    },
  );
  assert.equal(run.currentFlag(), 'false');
  assert.equal(run.mutations.length, 2);
});

test('the absolute 240s recovery deadline stops further requests before any rollback', async (context) => {
  let now = 0;
  context.mock.method(Date, 'now', () => now);
  const run = harness({
    afterPatch: () => {
      now = 180001;
    },
    afterVersionList: () => {
      now = 240001;
    },
  });
  await assert.rejects(
    applyPaymentFlag(
      { targetName: 'production', state: 'open', token: 'private-token-for-test-only' },
      run.fetcher,
    ),
    (error) => {
      assert.equal(error.receipt.recovery.mode, 'preserve-unverified-deployment');
      assert.deepEqual(error.receipt.recovery.verificationFailure, {
        stage: 'cloudflare-deployments-get',
        httpStatus: null,
      });
      assert.equal(error.receipt.recovery.verified, false);
      assert.equal(error.receipt.flag, null);
      assert.ok(!JSON.stringify(error.receipt).includes('private-token-for-test-only'));
      return true;
    },
  );
  assert.equal(run.currentVersion(), nextVersion);
  assert.equal(run.mutations.length, 1);
  assert.ok(!run.calls.some(({ method }) => method === 'POST'));
  assert.ok(run.calls.at(-1).url.endsWith('/versions?deployable=true'));
});

const sandboxTarget = {
  environment: 'sandbox',
  signing: 'sandbox-20260929',
  authority: 'SandboxLicenseAuthority',
};
const sandboxSettings = () => {
  const value = settings();
  value.bindings.find(({ name }) => name === 'PADDLE_ENVIRONMENT').text = 'sandbox';
  value.bindings.find(({ name }) => name === 'SIGNING_KEY_ID').text = sandboxTarget.signing;
  Object.assign(
    value.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY'),
    {
      class_name: sandboxTarget.authority,
      namespace_id: 'b5b0cb9d97f4404582f884ff2b1a6ba8',
    },
  );
  return value;
};

test('sandbox accepts its existing hidden or correctly formatted public client token without rewriting it', () => {
  const value = sandboxSettings();
  assert.equal(guardedSettings(value, sandboxTarget), 'false');
  Object.assign(
    value.bindings.find(({ name }) => name === 'PADDLE_CLIENT_TOKEN'),
    {
      type: 'plain_text',
      text: 'test_' + 'A1b'.repeat(9),
    },
  );
  const before = structuredClone(value);
  assert.equal(guardedSettings(value, sandboxTarget), 'false');
  assert.deepEqual(value, before);
  assert.deepEqual(
    flagMetadata(value, originalVersion, 'false').bindings.find(
      ({ name }) => name === 'PADDLE_CLIENT_TOKEN',
    ),
    { name: 'PADDLE_CLIENT_TOKEN', type: 'inherit', version_id: originalVersion },
  );
});

test('sandbox refuses blank, malformed and live public client tokens', () => {
  for (const text of [
    undefined,
    null,
    '',
    ' ',
    'test_',
    'test_' + 'a'.repeat(26),
    'test_' + 'a'.repeat(28),
    'live_' + 'a'.repeat(27),
    'test_' + '_'.repeat(27),
    'test_' + 'a'.repeat(26) + '!',
    'test_' + 'a'.repeat(27) + '\n',
    ' test_' + 'a'.repeat(27),
  ]) {
    const value = sandboxSettings();
    Object.assign(
      value.bindings.find(({ name }) => name === 'PADDLE_CLIENT_TOKEN'),
      { type: 'plain_text', text },
    );
    assert.throws(() => guardedSettings(value, sandboxTarget));
  }
});

test('production refuses every plaintext client token, including correctly formatted live and sandbox tokens', () => {
  for (const prefix of ['live_', 'test_']) {
    const value = settings();
    Object.assign(
      value.bindings.find(({ name }) => name === 'PADDLE_CLIENT_TOKEN'),
      {
        type: 'plain_text',
        text: prefix + 'a'.repeat(27),
      },
    );
    assert.throws(() => guardedSettings(value, target));
  }
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
      assert.equal(error.receipt.recovery.ownershipVerified, true);
      assert.equal(error.receipt.recovery.requestAttempted, true);
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
