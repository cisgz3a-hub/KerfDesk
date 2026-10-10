import test from 'node:test';
import assert from 'node:assert/strict';
import {
  originalVersion,
  goodVersion,
  nextVersion,
  unrelatedVersion,
  code,
  token,
  attestFixture,
  harness,
  run,
} from './refresh-sandbox-test-fixtures.mjs';

test('the operator verifies source and candidate through exact beta UUID module reads, including lost activation ACKs', async (t) => {
  attestFixture(t);
  for (const loseDeploymentResponse of [false, true]) {
    const adapter = harness({ loseDeploymentResponse });
    const receipt = await run(adapter);
    assert.equal(receipt.outcome, 'verified');
    assert.equal(receipt.codeVerified, true);
    assert.equal(receipt.protectedSettingsUnchanged, true);
    assert.equal(receipt.flag, 'false');
    assert.equal(adapter.mutations.length, 2);
    assert.equal(adapter.mutations[0].payload.main_module, 'worker.js');
    assert.equal(receipt.deploymentResponseReceived, !loseDeploymentResponse);
    if (loseDeploymentResponse) assert.equal(receipt.reconciliation.readBackVerified, true);
    for (const version of [goodVersion, nextVersion])
      assert.ok(
        adapter.calls.some(
          ({ url, method }) =>
            method === 'GET' &&
            url.includes('/workers/workers/') &&
            url.endsWith('/versions/' + version + '?include=modules'),
        ),
      );
    assert.ok(!adapter.calls.some(({ url }) => url.includes('/content/v2')));
    assert.ok(!JSON.stringify(receipt).includes(code.toString()));
    assert.ok(!JSON.stringify(receipt).includes(token));
  }
});

test('credential-shaped beta names and MIME are redacted and mismatched candidate descriptors never activate', async (t) => {
  attestFixture(t);
  for (const mode of ['source-name', 'source-mime', 'readback']) {
    const privateModule = (version) => {
      version.main_module = token;
      Object.assign(version.modules[0], { name: token, content_type: 'application/' + token });
    };
    const adapter = harness({
      sourceBetaChange:
        mode === 'source-name'
          ? privateModule
          : mode === 'source-mime'
            ? (version) => {
                version.modules[0].content_type = 'application/' + token;
              }
            : undefined,
      stagedBetaChange: mode === 'readback' ? privateModule : undefined,
    });
    await assert.rejects(run(adapter), (error) => {
      const format = error.receipt.moduleFormatFailure;
      assert.equal(format.contentType, 'application/json');
      assert.equal(format.exactVersion, true);
      assert.equal(format.moduleCount, 1);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      assert.ok(!JSON.stringify(error.receipt).includes(code.toString()));
      assert.equal(format.singleModule.mimeType, null);
      if (mode !== 'source-mime') assert.equal(format.singleModule.name, null);
      if (mode === 'readback') {
        assert.equal(error.receipt.failure.stage, 'sandbox-staged-content-get');
        assert.equal(error.receipt.deploymentAttempted, false);
        assert.equal(error.receipt.recovery.closedVerified, true);
      } else assert.equal(error.receipt.mutationAttempted, false);
      return true;
    });
    assert.deepEqual(
      adapter.mutations.map(({ kind }) => kind),
      mode === 'readback' ? ['stage'] : [],
    );
  }
});

test('wrong exact beta UUID, invalid encoding, extra modules or changed code fail before upload or candidate activation', async (t) => {
  attestFixture(t);
  const changes = [
    (version) => {
      version.id = unrelatedVersion;
    },
    (version) => {
      delete version.id;
    },
    (version) => {
      version.modules[0].content_base64 = '!!!!';
    },
    (version) => {
      version.modules[0].content_base64 = 'AB==';
    },
    (version) => {
      version.modules[0].content_base64 = code.toString('base64') + '\n';
    },
    (version) => {
      version.modules[0].content_base64 = '';
    },
    (version) => {
      version.modules.push({
        name: 'worker.js.map',
        content_type: 'application/source-map',
        content_base64: Buffer.from(token).toString('base64'),
      });
    },
    (version) => {
      delete version.main_module;
    },
    (version) => {
      version.main_module = 'absent.js';
    },
    (version) => {
      version.modules[0].content_type = 'application/javascript';
    },
    (version) => {
      version.modules[0].content_base64 = Buffer.concat([code, Buffer.from('\n')]).toString(
        'base64',
      );
    },
    (version) => {
      version.package_dependencies = [{ name: token, version: '1.0.0' }];
    },
  ];
  for (const phase of ['source', 'candidate']) {
    for (const change of changes) {
      const adapter = harness({
        [phase === 'source' ? 'sourceBetaChange' : 'stagedBetaChange']: change,
      });
      await assert.rejects(run(adapter), (error) => {
        assert.equal(
          error.receipt.failure.stage,
          phase === 'source' ? 'sandbox-attested-content-get' : 'sandbox-staged-content-get',
        );
        assert.equal(error.receipt.failure.httpStatus, 200);
        assert.equal(error.receipt.deploymentAttempted, false);
        assert.equal(error.receipt.stagedVersionVerified, false);
        assert.equal(error.receipt.recovery.rollbackAttempted, false);
        if (phase === 'candidate') assert.equal(error.receipt.recovery.closedVerified, true);
        assert.ok(!JSON.stringify(error.receipt).includes(token));
        assert.ok(!JSON.stringify(error.receipt).includes(code.toString()));
        return true;
      });
      assert.deepEqual(
        adapter.mutations.map(({ kind }) => kind),
        phase === 'source' ? [] : ['stage'],
      );
      assert.equal(adapter.version(), originalVersion);
      assert.ok(!adapter.calls.some(({ url }) => url.includes('/content/v2')));
    }
  }
});

test('changed beta candidate bytes refuse activation even when standard version queries keep returning active bytes', async (t) => {
  attestFixture(t);
  const adapter = harness({
    standardContentReturnsActive: true,
    stagedCode: Buffer.concat([code, Buffer.from('\n')]),
  });
  const standard = (version) =>
    'https://api.cloudflare.com/client/v4/accounts/fixture/workers/scripts/kerfdesk-desktop-licensing-sandbox/content/v2?version=' +
    version;
  const readStandardBytes = async (version) => {
    const form = await (await adapter.fetcher(standard(version))).formData();
    return Buffer.from(await form.get('worker.js').arrayBuffer());
  };
  const before = await readStandardBytes(originalVersion);
  const firstOperatorCall = adapter.calls.length;
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-staged-content-get');
    assert.equal(error.receipt.moduleFormatFailure.exactVersion, true);
    assert.equal(error.receipt.stagedVersionVerified, false);
    assert.equal(error.receipt.deploymentAttempted, false);
    assert.equal(error.receipt.recovery.closedVerified, true);
    return true;
  });
  const lastOperatorCall = adapter.calls.length;
  const after = await readStandardBytes(nextVersion);
  assert.ok(
    after.equals(before),
    'Standard candidate queries still expose the unchanged active dispatcher.',
  );
  assert.deepEqual(
    adapter.mutations.map(({ kind }) => kind),
    ['stage'],
  );
  assert.equal(adapter.version(), originalVersion);
  const operatorCalls = adapter.calls.slice(firstOperatorCall, lastOperatorCall);
  assert.ok(!operatorCalls.some(({ url }) => url.includes('/content/v2')));
  assert.ok(
    operatorCalls.some(
      ({ url }) =>
        url.includes('/workers/workers/') &&
        url.endsWith('/versions/' + nextVersion + '?include=modules'),
    ),
  );
});
