import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SANDBOX_ORIGIN,
  GOOD_VERSION_PREFIX,
  GOOD_CODE_SHA256,
  guardSandboxRefresh,
  sandboxUploadMetadata,
  readSandboxModule,
} from './refresh-sandbox-script.mjs';

import {
  originalVersion,
  goodVersion,
  nextVersion,
  unrelatedVersion,
  fixtureTag,
  code,
  token,
  settings,
  attestFixture,
  content,
  harness,
  run,
} from './refresh-sandbox-test-fixtures.mjs';

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
test('attested raw and multipart representation transitions verify the upload identity, including lost ACKs', async (t) => {
  attestFixture(t);
  for (const [sourceRaw, readbackRaw, readbackRawHeader, sourceRawType] of [
    [true, false, null, 'application/javascript'],
    [true, false, null, 'application/javascript+module; charset=utf-8'],
    [false, true, null, null],
    [false, true, 'match', null],
    [true, true, null, 'application/javascript'],
    [true, true, 'match', 'application/javascript'],
  ]) {
    for (const loseUploadResponse of [false, true]) {
      const adapter = harness({
        sourceRaw,
        readbackRaw,
        readbackRawHeader,
        sourceRawType,
        sourceRawHeader: 'historical.js',
        loseUploadResponse,
      });
      const receipt = await run(adapter);
      assert.equal(receipt.outcome, 'verified');
      assert.equal(receipt.codeVerified, true);
      assert.equal(receipt.protectedSettingsUnchanged, true);
      assert.equal(receipt.flag, 'false');
      assert.equal(adapter.mutations.length, 1);
      assert.equal(
        adapter.mutations[0].payload.main_module,
        sourceRaw ? 'sandbox-worker.js' : 'worker.js',
      );
      assert.equal(receipt.uploadResponseReceived, !loseUploadResponse);
      if (loseUploadResponse) assert.equal(receipt.reconciliation.readBackVerified, true);
      assert.ok(adapter.calls.some(({ url }) => url.includes('content/v2?version=' + nextVersion)));
      assert.ok(!JSON.stringify(receipt).includes(code.toString()));
      assert.ok(!JSON.stringify(receipt).includes(token));
    }
  }
});

test('raw wrong MIME, empty, HTML, JSON and one-byte changes refuse before any upload with redacted format facts', async (t) => {
  attestFixture(t);
  for (const [sourceBytes, sourceRawType] of [
    [code, 'text/javascript'],
    [code, 'application/octet-stream'],
    [code, null],
    [Buffer.alloc(0), 'application/javascript'],
    [Buffer.from('<html>' + token + '</html>'), 'application/javascript'],
    [Buffer.from(JSON.stringify({ error: token })), 'application/javascript'],
    [Buffer.concat([code, Buffer.from('\n')]), 'application/javascript'],
  ]) {
    const adapter = harness({ sourceRaw: true, sourceBytes, sourceRawType });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.failure.stage, 'sandbox-attested-content-get');
      assert.equal(error.receipt.failure.httpStatus, 200);
      assert.equal(error.receipt.mutationAttempted, false);
      assert.equal(error.receipt.moduleFormatFailure.contentType, sourceRawType);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      assert.ok(!JSON.stringify(error.receipt).includes(code.toString()));
      return true;
    });
    assert.equal(adapter.mutations.length, 0);
  }
});

test('credential-shaped names and MIME are redacted on refusal and mismatched raw readback recovers safely', async (t) => {
  attestFixture(t);
  for (const mode of ['multipart', 'raw-source', 'readback']) {
    const sourceResponse = () => {
      const form = new FormData();
      form.set(token, new Blob([code], { type: 'application/' + token }), token);
      return new Response(form, { headers: { 'cf-entrypoint': token } });
    };
    const adapter = harness({
      sourceResponse: mode === 'multipart' ? sourceResponse : undefined,
      sourceRaw: mode === 'raw-source',
      sourceRawType: 'application/' + token,
      sourceRawHeader: token,
      readbackRaw: mode === 'readback',
      readbackRawHeader: token,
    });
    await assert.rejects(run(adapter), (error) => {
      const format = error.receipt.moduleFormatFailure;
      assert.equal(format.entrypoint, null);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      assert.ok(!JSON.stringify(error.receipt).includes(code.toString()));
      if (format.parts)
        assert.deepEqual(
          format.parts.map(({ field, filename, mimeType }) => [field, filename, mimeType]),
          [[null, null, null]],
        );
      if (mode === 'raw-source') assert.equal(format.contentType, null);
      if (mode === 'readback') {
        assert.equal(error.receipt.failure.stage, 'sandbox-restored-content-get');
        assert.equal(error.receipt.recovery.ownershipVerified, true);
        assert.equal(error.receipt.recovery.closedVerified, true);
      } else assert.equal(error.receipt.mutationAttempted, false);
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ method }) => method),
      mode === 'readback' ? ['PUT', 'POST'] : [],
    );
  }
});

test('multipart still refuses source maps and records only bounded part metadata', async () => {
  const form = new FormData();
  form.set('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');
  form.set('worker.js.map', new Blob([token], { type: 'application/source-map' }), 'worker.js.map');
  const format = {};
  await assert.rejects(
    readSandboxModule(new Response(form, { headers: { 'cf-entrypoint': 'worker.js' } }), format),
  );
  assert.equal(format.partCount, 2);
  assert.deepEqual(
    format.parts.map(({ field }) => field),
    ['worker.js', 'worker.js.map'],
  );
  assert.equal(format.parts[1].mimeType, 'application/source-map');
  assert.match(format.parts[1].sha256, /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(format).includes(token));
  assert.ok(!JSON.stringify(format).includes(code.toString()));
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
test('refresh and lost-ACK readback preserve an existing public sandbox token by inheritance without recording it', async (t) => {
  attestFixture(t);
  const publicToken = 'test_' + 'A1b'.repeat(9);
  for (const loseUploadResponse of [false, true]) {
    const value = settings();
    const binding = { name: 'PADDLE_CLIENT_TOKEN', type: 'plain_text', text: publicToken };
    Object.assign(
      value.bindings.find(({ name }) => name === binding.name),
      binding,
    );
    const adapter = harness({ initialSettings: value, loseUploadResponse });
    const receipt = await run(adapter);
    assert.equal(receipt.outcome, 'verified');
    assert.equal(receipt.protectedSettingsUnchanged, true);
    assert.equal(receipt.flag, 'false');
    assert.deepEqual(adapter.binding(binding.name), binding);
    assert.deepEqual(
      adapter.mutations[0].payload.bindings.find(({ name }) => name === binding.name),
      {
        name: binding.name,
        type: 'inherit',
        version_id: originalVersion,
      },
    );
    assert.equal(adapter.mutations.length, 1);
    assert.ok(!JSON.stringify(receipt).includes(publicToken));
    assert.ok(!JSON.stringify(adapter.mutations).includes(publicToken));
  }
});

test('refresh detects a changed but valid public sandbox token and restores the original binding', async (t) => {
  attestFixture(t);
  const value = settings();
  const binding = {
    name: 'PADDLE_CLIENT_TOKEN',
    type: 'plain_text',
    text: 'test_' + 'A1b'.repeat(9),
  };
  Object.assign(
    value.bindings.find(({ name }) => name === binding.name),
    binding,
  );
  const adapter = harness({
    initialSettings: value,
    postChange: (current) => {
      current.bindings.find(({ name }) => name === binding.name).text = 'test_' + 'c2D'.repeat(9);
    },
  });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-protected-settings-verification');
    assert.equal(error.receipt.recovery.closedVerified, true);
    assert.ok(!JSON.stringify(error.receipt).includes(binding.text));
    return true;
  });
  assert.deepEqual(adapter.binding(binding.name), binding);
  assert.deepEqual(
    adapter.mutations.map(({ method }) => method),
    ['PUT', 'POST'],
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
