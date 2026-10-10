import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { flagMetadata } from './apply-payment-settings.mjs';
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

test('sandbox upload inherits guarded latest bindings and assets without changing shared flag metadata', () => {
  const value = settings();
  const metadata = sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag);
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.main_module, 'worker.js');
  assert.equal(metadata.migrations, undefined);
  assert.equal(metadata.assets, undefined);
  assert.equal(metadata.annotations['workers/tag'], fixtureTag);
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'LICENSE_AUTHORITY'),
    { name: 'LICENSE_AUTHORITY', type: 'inherit', version_id: 'latest' },
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'ASSETS'),
    { name: 'ASSETS', type: 'inherit', version_id: 'latest' },
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === 'SIGNING_PRIVATE_JWK'),
    { name: 'SIGNING_PRIVATE_JWK', type: 'inherit', version_id: 'latest' },
  );
  assert.ok(!JSON.stringify(metadata).includes(goodVersion));
  assert.deepEqual(
    flagMetadata(value, originalVersion, 'false').bindings.find(
      ({ name }) => name === 'SIGNING_PRIVATE_JWK',
    ),
    { name: 'SIGNING_PRIVATE_JWK', type: 'inherit', version_id: originalVersion },
  );
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
    assert.ok(!adapter.calls.some(({ url }) => url.includes('?include=modules')));
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
test('retained attested bundle restores without historical lookup and reconciles lost ACKs privately', async (t) => {
  attestFixture(t);
  const retainedBundle = ' \r\n' + gzipSync(code).toString('base64') + '\r\n';
  for (const loseDeploymentResponse of [false, true]) {
    const adapter = harness({
      versions: [],
      expectedUploadName: 'sandbox-worker.js',
      loseDeploymentResponse,
    });
    const receipt = await run(adapter, { retainedBundle });
    assert.equal(receipt.outcome, 'verified');
    assert.equal(receipt.sourceKind, 'retained-attested-bundle');
    assert.equal(receipt.sourceVersion, null);
    assert.equal(receipt.sourceVersionPrefix, null);
    assert.equal(receipt.codeSha256, GOOD_CODE_SHA256);
    assert.equal(receipt.codeVerified, true);
    assert.equal(receipt.protectedSettingsUnchanged, true);
    assert.equal(receipt.buyHtmlUnchanged, true);
    assert.equal(receipt.health, true);
    assert.equal(receipt.flag, 'false');
    assert.equal(receipt.deploymentResponseReceived, !loseDeploymentResponse);
    if (loseDeploymentResponse) assert.equal(receipt.reconciliation.readBackVerified, true);
    assert.deepEqual(
      adapter.mutations.map(({ kind }) => kind),
      ['stage', 'activate'],
    );
    const beforeUpload = adapter.calls.slice(
      0,
      adapter.calls.findIndex(({ method }) => method === 'POST'),
    );
    assert.ok(beforeUpload.some(({ url }) => url.endsWith('/versions/' + originalVersion)));
    assert.ok(
      !adapter.calls.some(({ url }) => url.includes('/' + goodVersion + '?include=modules')),
    );
    assert.ok(!adapter.calls.some(({ url }) => url.includes('/content/v2')));
    for (const privateValue of [retainedBundle, code.toString(), token])
      assert.ok(!JSON.stringify(receipt).includes(privateValue));
  }
});

test('the real fixed SHA rejects an unverified retained bundle before every provider request', async () => {
  const adapter = harness();
  await assert.rejects(
    run(adapter, { retainedBundle: gzipSync(code).toString('base64') }),
    (error) => {
      assert.equal(error.receipt.failure.stage, 'sandbox-retained-bundle-verification');
      assert.equal(error.receipt.mutationAttempted, false);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 0);
});

test('malformed, noncanonical, oversized or wrong-pin retained inputs refuse before every provider request', async (t) => {
  attestFixture(t);
  const compressed = gzipSync(code);
  const corruptedCrc = Buffer.from(compressed);
  corruptedCrc[corruptedCrc.length - 8] ^= 1;
  const inputs = [
    '',
    null,
    {},
    token,
    'AB==',
    'A'.repeat(65540),
    compressed.toString('base64').slice(0, 4) + '\n' + compressed.toString('base64').slice(4),
    Buffer.from('{"private":"' + token + '"}').toString('base64'),
    gzipSync(Buffer.from(token)).toString('base64'),
    gzipSync(Buffer.alloc(0)).toString('base64'),
    gzipSync(Buffer.alloc(72533)).toString('base64'),
    gzipSync(Buffer.concat([code, Buffer.from('\n')])).toString('base64'),
    compressed.subarray(0, -1).toString('base64'),
    corruptedCrc.toString('base64'),
    Buffer.concat([compressed, Buffer.alloc(1)]).toString('base64'),
    Buffer.concat([gzipSync(Buffer.alloc(0)), compressed]).toString('base64'),
  ];
  for (const retainedBundle of inputs) {
    const adapter = harness();
    await assert.rejects(run(adapter, { retainedBundle }), (error) => {
      assert.deepEqual(error.receipt.failure, {
        stage: 'sandbox-retained-bundle-verification',
        httpStatus: null,
      });
      assert.equal(error.receipt.sourceKind, 'retained-attested-bundle');
      assert.equal(error.receipt.sourceVersion, null);
      assert.equal(error.receipt.mutationAttempted, false);
      assert.equal(error.receipt.flag, null);
      for (const privateValue of [token, code.toString(), retainedBundle])
        if (typeof privateValue === 'string' && privateValue)
          assert.ok(!JSON.stringify(error.receipt).includes(privateValue));
      return true;
    });
    assert.equal(adapter.calls.length, 0);
    assert.equal(adapter.mutations.length, 0);
  }
});

test('retained-source failed health restores only its owned deployment, including lost ACKs', async (t) => {
  attestFixture(t);
  const retainedBundle = gzipSync(code).toString('base64');
  for (const loseDeploymentResponse of [false, true]) {
    for (const concurrentAfterDeployment of [false, true]) {
      const adapter = harness({
        expectedUploadName: 'sandbox-worker.js',
        badHealth: true,
        loseDeploymentResponse,
        concurrentAfterDeployment,
      });
      await assert.rejects(run(adapter, { retainedBundle }), (error) => {
        assert.equal(error.receipt.sourceKind, 'retained-attested-bundle');
        assert.equal(error.receipt.sourceVersion, null);
        assert.equal(error.receipt.recovery.closedVerified, !concurrentAfterDeployment);
        if (!concurrentAfterDeployment)
          assert.equal(error.receipt.recovery.ownershipVerified, true);
        assert.equal(error.receipt.recovery.rollbackAttempted, !concurrentAfterDeployment);
        return true;
      });
      assert.deepEqual(
        adapter.mutations.map(({ kind }) => kind),
        concurrentAfterDeployment ? ['stage', 'activate'] : ['stage', 'activate', 'rollback'],
      );
      assert.equal(
        adapter.version(),
        concurrentAfterDeployment ? unrelatedVersion : originalVersion,
      );
    }
  }
});

test('the CLI maps the optional retained secret to private pre-request validation', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'data:text/javascript,' +
        encodeURIComponent(
          'globalThis.fetch = () => { throw new Error("No provider calls allowed"); };',
        ),
      resolve('scripts/refresh-sandbox-script.mjs'),
      'sandbox-refresh-code',
    ],
    {
      encoding: 'utf8',
      env: {
        KERFDESK_PAYMENT_LAUNCH_CF_TOKEN: token,
        KERFDESK_PAYMENT_SANDBOX_ATTESTED_BUNDLE: token,
      },
    },
  );
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  const receipt = JSON.parse(child.stderr);
  assert.equal(receipt.sourceKind, 'retained-attested-bundle');
  assert.equal(receipt.sourceVersion, null);
  assert.equal(receipt.failure.stage, 'sandbox-retained-bundle-verification');
  assert.equal(receipt.mutationAttempted, false);
  assert.ok(!child.stderr.includes(token));
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
test('public raw and multipart parsers preserve the supplied attested upload descriptor', async (t) => {
  attestFixture(t);
  for (const sourceType of [
    'multipart/form-data',
    'application/javascript',
    'application/javascript+module; charset=utf-8',
  ]) {
    const source = await readSandboxModule(
      sourceType === 'multipart/form-data'
        ? content()
        : new Response(code, {
            headers: { 'Content-Type': sourceType, 'cf-entrypoint': 'historical.js' },
          }),
    );
    const descriptor = {
      entrypoint: source.entrypoint,
      filename: source.filename,
      mimeType: source.mimeType,
    };
    for (const rawHeader of [undefined, descriptor.entrypoint]) {
      const restored = await readSandboxModule(
        new Response(code, {
          headers: {
            'Content-Type': 'application/javascript',
            ...(rawHeader ? { 'cf-entrypoint': rawHeader } : {}),
          },
        }),
        {},
        descriptor,
      );
      assert.deepEqual(restored, source);
    }
    const restoredMultipart = await readSandboxModule(
      content({ entrypoint: descriptor.entrypoint, filename: descriptor.filename }),
    );
    assert.deepEqual(restoredMultipart, source);
  }
});

test('public raw parser rejects wrong MIME, empty, HTML, JSON and changed bytes with private format facts', async (t) => {
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
    const format = {};
    await assert.rejects(
      readSandboxModule(
        new Response(sourceBytes, {
          headers: sourceRawType ? { 'Content-Type': sourceRawType } : {},
        }),
        format,
      ),
    );
    assert.equal(format.contentType, sourceRawType);
    assert.ok(!JSON.stringify(format).includes(token));
    assert.ok(!JSON.stringify(format).includes(code.toString()));
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
  assert.equal(adapter.mutations.length, 2);
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
  for (const loseDeploymentResponse of [false, true]) {
    const value = settings();
    const binding = { name: 'PADDLE_CLIENT_TOKEN', type: 'plain_text', text: publicToken };
    Object.assign(
      value.bindings.find(({ name }) => name === binding.name),
      binding,
    );
    const adapter = harness({ initialSettings: value, loseDeploymentResponse });
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
        version_id: 'latest',
      },
    );
    assert.equal(adapter.mutations.length, 2);
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate', 'rollback'],
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate', 'rollback'],
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
test('upload HTTP400 diagnostics survive staged readback without activating an ambiguous upload', async (t) => {
  attestFixture(t);
  const retainedBundle = gzipSync(code).toString('base64');
  const uploadErrorBody = {
    success: false,
    errors: [
      {
        code: 10021,
        message: 'TypeError: inherited ASSETS binding ' + token + code.toString(),
        source: { pointer: token },
        documentation_url: token,
      },
    ],
    result: token,
  };
  for (const uploadErrorAfterApply of [false, true]) {
    const adapter = harness({
      expectedUploadName: 'sandbox-worker.js',
      uploadErrorBody,
      uploadErrorAfterApply,
      refuseUpload: !uploadErrorAfterApply,
    });
    await assert.rejects(run(adapter, { retainedBundle }), (error) => {
      const receipt = error.receipt;
      assert.deepEqual(receipt.failure, { stage: 'sandbox-code-upload', httpStatus: 400 });
      assert.equal(receipt.recovery.closedVerified, true);
      assert.equal(receipt.recovery.rollbackAttempted, false);
      assert.equal(receipt.deploymentAttempted, false);
      assert.equal(receipt.stagedVersionVerified, false);
      assert.equal(receipt.mutated, false);
      assert.equal(receipt.apiFailure.stage, 'sandbox-code-upload');
      assert.equal(receipt.apiFailure.httpStatus, 400);
      assert.deepEqual(receipt.apiFailure.errors.codes, [10021]);
      assert.deepEqual(receipt.apiFailure.errors.exceptionTypes, ['TypeError']);
      assert.deepEqual(receipt.apiFailure.errors.identifiers, [
        'SandboxLicenseAuthority',
        'ASSETS',
      ]);
      assert.equal(receipt.apiFailure.metadataShape.types.bindings, 'array');
      assert.equal(receipt.apiFailure.metadataShape.types.keep_assets, 'boolean');
      for (const privateValue of [token, code.toString(), retainedBundle])
        assert.ok(!JSON.stringify(receipt).includes(privateValue));
      return true;
    });
    assert.equal(adapter.version(), originalVersion);
    assert.deepEqual(
      adapter.mutations.map(({ kind }) => kind),
      ['stage'],
    );
  }
});

test('applied deployment with lost acknowledgement is reconciled by exact code/settings/assets/health proof', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseDeploymentResponse: true });
  const receipt = await run(adapter);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.deploymentResponseReceived, false);
  assert.equal(receipt.mutated, null);
  assert.equal(receipt.reconciliation.readBackVerified, true);
  assert.equal(receipt.reconciliation.initialFailure.stage, 'sandbox-staged-deployment');
  assert.equal(receipt.flag, 'false');
  assert.equal(adapter.mutations.length, 2);
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate', 'rollback'],
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
  const adapter = harness({ concurrentAfterDeployment: true });
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate'],
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate'],
  );
  assert.equal(adapter.version(), unrelatedVersion);
});

test('lost deployment acknowledgement never permits rollback without exact top-level version ownership', async (t) => {
  attestFixture(t);
  for (const uploadOwnership of [
    'missing',
    'different-tag',
    'nested-only',
    'wrong-id',
    'unavailable',
  ]) {
    const adapter = harness({
      loseDeploymentResponse: true,
      ownershipAfterDeployment: uploadOwnership,
    });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.deploymentResponseReceived, false);
      assert.equal(error.receipt.recovery.mode, 'not-restored-unowned-deployment');
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, false);
      assert.equal(error.receipt.flag, null);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ kind }) => kind),
      ['stage', 'activate'],
    );
    assert.equal(adapter.version(), nextVersion);
  }
});

test('a lost acknowledgement followed by an unrelated deployment never reverts that deployment', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseDeploymentResponse: true, concurrentAfterDeployment: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate'],
  );
  assert.equal(adapter.version(), unrelatedVersion);
});

test('owned deployment with lost acknowledgement and failed health can restore the original closed version', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseDeploymentResponse: true, badHealth: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.deploymentResponseReceived, false);
    assert.equal(error.receipt.recovery.ownershipVerified, true);
    assert.equal(error.receipt.recovery.rollbackAttempted, true);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate', 'rollback'],
  );
  assert.equal(adapter.version(), originalVersion);
});

test('unapplied ambiguous upload verifies the already-original closed version without deployment', async (t) => {
  attestFixture(t);
  const adapter = harness({ loseUploadBeforeApply: true });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.recovery.mode, 'original-closed-sandbox-deployment-already-active');
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  assert.deepEqual(
    adapter.mutations.map(({ kind }) => kind),
    ['stage'],
  );
  assert.equal(adapter.version(), originalVersion);
});

test('duplicate operation tags cannot permit activation or rollback', async (t) => {
  attestFixture(t);
  for (const loseUploadResponse of [false, true]) {
    const adapter = harness({ duplicateOperationTag: true, loseUploadResponse });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, true);
      assert.equal(error.receipt.flag, 'false');
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ kind }) => kind),
      ['stage'],
    );
    assert.equal(adapter.version(), originalVersion);
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
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate'],
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
