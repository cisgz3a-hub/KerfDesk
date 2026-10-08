import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { attestSandboxVersion, sandboxSettingsFingerprint } from './sandbox-restoration-guards.mjs';
import { sandboxUploadMetadata } from './refresh-sandbox-script.mjs';
import {
  originalVersion,
  fixtureTag,
  nextVersion,
  unrelatedVersion,
  code,
  token,
  settings,
  versionResources,
  attestFixture,
  harness,
  run,
} from './refresh-sandbox-test-fixtures.mjs';
const kinds = (adapter) => adapter.mutations.map(({ kind }) => kind);
const binding = (version, name) => version.resources.bindings.find((item) => item.name === name);

test('documented targeted aliases share fingerprints, snapshots and exact upload metadata', () => {
  for (const field of ['region', 'host', 'hostname']) {
    const canonical = { mode: 'targeted', target: [{ [field]: token }] };
    const aliases = [{ [field]: token }, { mode: 'targeted', [field]: token }, canonical];
    const value = settings();
    value.placement = canonical;
    const baseline = attestSandboxVersion(
      { id: originalVersion, resources: versionResources(value) },
      originalVersion,
      value,
    );
    const fingerprint = sandboxSettingsFingerprint(value);
    for (const configured of aliases) {
      value.placement = configured;
      assert.equal(sandboxSettingsFingerprint(value), fingerprint);
      assert.deepEqual(
        sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag).placement,
        { mode: 'targeted', [field]: token },
      );
      for (const observed of aliases) {
        const version = { id: originalVersion, resources: versionResources(value) };
        version.resources.script.placement = {
          ...observed,
          status: 'SUCCESS',
          last_analyzed_at: token,
        };
        const diagnostic = {};
        assert.deepEqual(
          attestSandboxVersion(version, originalVersion, value, diagnostic, baseline),
          baseline,
        );
        assert.ok(Object.values(diagnostic.placement.fieldsEqual).every(Boolean));
        assert.ok(!JSON.stringify(diagnostic).includes(token));
      }
    }
  }
});

test('targeted provider format transitions preserve configured target through the staged restoration', async (t) => {
  attestFixture(t);
  for (const field of ['region', 'host', 'hostname']) {
    const canonical = { mode: 'targeted', target: [{ [field]: token }] };
    for (const placement of [{ [field]: token }, { mode: 'targeted', [field]: token }, canonical]) {
      const value = settings();
      value.placement = placement;
      const adapter = harness({
        initialSettings: value,
        originalResourceChange: (version) => {
          version.resources.script.placement = { mode: 'targeted', [field]: token };
        },
        stagedResourceChange: (version) => {
          version.resources.script.placement = structuredClone(canonical);
        },
        postChange: (current) => {
          current.placement = structuredClone(canonical);
        },
      });
      const receipt = await run(adapter);
      assert.equal(receipt.outcome, 'verified');
      assert.equal(receipt.protectedSettingsUnchanged, true);
      assert.equal(receipt.flag, 'false');
      assert.deepEqual(kinds(adapter), ['stage', 'activate']);
      assert.deepEqual(adapter.mutations[0].payload.placement, {
        mode: 'targeted',
        [field]: token,
      });
      assert.ok(!JSON.stringify(receipt).includes(token));
    }
  }
});

test('divergent active UUID bindings or runtime refuse before every upload with private diagnostics', async (t) => {
  attestFixture(t);
  const retainedBundle = gzipSync(code).toString('base64');
  for (const originalResourceChange of [
    (v) => {
      v.id = nextVersion;
    },
    (v) => {
      v.resources.bindings = v.resources.bindings.filter(({ name }) => name !== 'PADDLE_API_KEY');
    },
    (v) => {
      binding(v, 'PADDLE_API_KEY').type = 'plain_text';
      binding(v, 'PADDLE_API_KEY').text = token;
    },
    (v) => {
      binding(v, 'PADDLE_PURCHASE_PRICE_ID').text = token;
    },
    (v) => {
      binding(v, 'LICENSE_AUTHORITY').namespace_id = '0'.repeat(32);
    },
    (v) => {
      binding(v, 'LICENSE_AUTHORITY').class_name = 'LicenseAuthority';
    },
    (v) => {
      binding(v, 'WEBHOOK_RATE_LIMITER').namespace_id = '999999';
    },
    (v) => {
      binding(v, 'REQUEST_RATE_LIMITER').simple.limit = 10000;
    },
    (v) => {
      v.resources.script_runtime.compatibility_flags = ['other'];
    },
    (v) => {
      v.resources.script_runtime.compatibility_date = '2025-01-01';
    },
    (v) => {
      v.resources.script_runtime.usage_model = 'unbound';
    },
    (v) => {
      v.resources.script_runtime.limits = { cpu_ms: 1000 };
    },
    (v) => {
      v.resources.script.placement = { mode: 'smart' };
    },
    (v) => {
      v.cache_options = { enabled: true };
    },
    (v) => {
      v.resources.bindings.push({ name: token, type: token, text: code.toString() });
    },
  ]) {
    const adapter = harness({ originalResourceChange });
    await assert.rejects(run(adapter, { retainedBundle }), (error) => {
      assert.equal(error.receipt.failure.stage, 'sandbox-original-resource-verification');
      assert.equal(error.receipt.stagingAttempted, false);
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.mutated, false);
      assert.ok(error.receipt.versionResourceFailure);
      for (const privateValue of [token, code.toString(), retainedBundle])
        assert.ok(!JSON.stringify(error.receipt).includes(privateValue));
      return true;
    });
    assert.deepEqual(kinds(adapter), []);
    assert.equal(adapter.version(), originalVersion);
  }
});

test('inactive staged candidate failing protections, class state or exact bytes is never deployed or rolled back', async (t) => {
  attestFixture(t);
  for (const options of [
    {
      stagedResourceChange: (v) => {
        binding(v, 'TRIAL_RATE_LIMITER').simple.limit = 999;
      },
    },
    {
      stagedResourceChange: (v) => {
        binding(v, 'PADDLE_CLIENT_TOKEN').type = 'plain_text';
        binding(v, 'PADDLE_CLIENT_TOKEN').text = token;
      },
    },
    {
      stagedResourceChange: (v) => {
        v.resources.script_runtime.migration_tag = 'other';
      },
    },
    {
      stagedResourceChange: (v) => {
        v.resources.script_runtime.exports.SandboxLicenseAuthority.state = 'deleted';
      },
    },
    { stagedCode: Buffer.concat([code, Buffer.from('\n')]) },
    { readbackRaw: true, readbackRawHeader: token },
    { uploadOwnership: 'missing' },
    { uploadOwnership: 'wrong-id' },
  ]) {
    const adapter = harness(options);
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.stagingAttempted, true);
      assert.equal(error.receipt.uploadResponseReceived, true);
      assert.equal(error.receipt.stagedVersionVerified, false);
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, true);
      assert.equal(error.receipt.mutated, false);
      assert.ok(!JSON.stringify(error.receipt).includes(token));
      assert.ok(!JSON.stringify(error.receipt).includes(code.toString()));
      return true;
    });
    assert.deepEqual(kinds(adapter), ['stage']);
    assert.equal(adapter.version(), originalVersion);
  }
});

test('lost upload ACK records an attested inactive candidate but never auto-activates', async (t) => {
  attestFixture(t);
  for (const loseUploadBeforeApply of [false, true]) {
    const adapter = harness({ loseUploadResponse: true, loseUploadBeforeApply });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.failure.stage, 'sandbox-code-upload');
      assert.equal(error.receipt.uploadResponseReceived, false);
      assert.equal(error.receipt.stagedVersionVerified, !loseUploadBeforeApply);
      assert.equal(error.receipt.stagedVersion, loseUploadBeforeApply ? null : nextVersion);
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, true);
      assert.equal(error.receipt.mutated, false);
      return true;
    });
    assert.deepEqual(kinds(adapter), ['stage']);
    assert.equal(adapter.version(), originalVersion);
  }
});

test('concurrent activation-boundary changes leave both candidate and unrelated active deployment untouched', async (t) => {
  attestFixture(t);
  for (const options of [
    { concurrentAfterStage: true },
    { concurrentAtActivationSettings: true },
    { concurrentAfterStage: true, loseUploadResponse: true },
  ]) {
    const adapter = harness(options);
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, false);
      assert.equal(error.receipt.recovery.observedVersion, unrelatedVersion);
      return true;
    });
    assert.deepEqual(kinds(adapter), ['stage']);
    assert.equal(adapter.version(), unrelatedVersion);
  }
});

test('lost activation ACK distinguishes applied and unapplied deployments without repeating activation', async (t) => {
  attestFixture(t);
  for (const loseDeploymentBeforeApply of [false, true]) {
    const adapter = harness({ loseDeploymentResponse: true, loseDeploymentBeforeApply });
    const result = loseDeploymentBeforeApply
      ? await run(adapter).then(
          () => assert.fail('Unapplied activation cannot succeed'),
          (error) => error.receipt,
        )
      : await run(adapter);
    assert.equal(result.stagedVersionVerified, true);
    assert.equal(result.uploadResponseReceived, true);
    assert.equal(result.deploymentAttempted, true);
    assert.equal(result.deploymentResponseReceived, false);
    assert.equal(result.mutated, null);
    assert.equal(result.outcome, loseDeploymentBeforeApply ? 'failed' : 'verified');
    if (loseDeploymentBeforeApply) assert.equal(result.recovery.closedVerified, true);
    else assert.equal(result.reconciliation.readBackVerified, true);
    assert.deepEqual(kinds(adapter), ['stage', 'activate']);
    assert.equal(adapter.version(), loseDeploymentBeforeApply ? originalVersion : nextVersion);
  }
});

test('staged activation preserves authority data, opaque secrets, rates and public token by strict UUID inheritance', async (t) => {
  attestFixture(t);
  const value = settings(),
    publicToken = 'test_' + 'A1b'.repeat(9);
  Object.assign(
    value.bindings.find(({ name }) => name === 'PADDLE_CLIENT_TOKEN'),
    { type: 'plain_text', text: publicToken },
  );
  value.limits = { cpu_ms: 50 };
  value.placement = { mode: 'smart' };
  value.cache_options = { enabled: false };
  const adapter = harness({ initialSettings: value });
  const state = structuredClone(adapter.authorityState);
  const receipt = await run(adapter);
  assert.deepEqual(kinds(adapter), ['stage', 'activate']);
  assert.equal(receipt.stagedVersionVerified, true);
  assert.equal(receipt.deploymentResponseReceived, true);
  assert.equal(receipt.mutated, true);
  assert.equal(receipt.flag, 'false');
  assert.deepEqual(adapter.authorityState, state);
  for (const item of value.bindings) assert.deepEqual(adapter.binding(item.name), item);
  const metadata = adapter.mutations[0].payload;
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.migrations, undefined);
  assert.equal(metadata.assets, undefined);
  assert.ok(!JSON.stringify(metadata).includes('latest'));
  const activationIndex = adapter.calls.findIndex(
    ({ url, method }) => url.endsWith('/deployments') && method === 'POST',
  );
  assert.ok(
    adapter.calls
      .slice(0, activationIndex)
      .some(({ url }) => url.includes('/content/v2?version=' + nextVersion)),
  );
  assert.ok(
    adapter.calls
      .slice(0, activationIndex)
      .some(({ url }) => url.endsWith('/versions/' + originalVersion)),
  );
  assert.ok(
    !adapter.calls.some(({ url }) => /\/script-settings|\/authority|paddle\.com/u.test(url)),
  );
  for (const privateValue of [token, publicToken, state.licence, code.toString()])
    assert.ok(!JSON.stringify(receipt).includes(privateValue));
});

test('nonversioned settings changing at the activation boundary refuse without an inactive-candidate rollback', async (t) => {
  attestFixture(t);
  const adapter = harness({
    concurrentScriptSettingsChange: (value) => {
      value.observability.logs.destinations = [token];
    },
  });
  await assert.rejects(run(adapter), (error) => {
    assert.equal(error.receipt.failure.stage, 'sandbox-protected-settings-verification');
    assert.equal(error.receipt.stagedVersionVerified, true);
    assert.equal(error.receipt.deploymentAttempted, false);
    assert.equal(error.receipt.recovery.rollbackAttempted, false);
    assert.equal(error.receipt.recovery.protectedSettingsUnchanged, undefined);
    assert.ok(!JSON.stringify(error.receipt).includes(token));
    return true;
  });
  assert.deepEqual(kinds(adapter), ['stage']);
  assert.equal(adapter.version(), originalVersion);
});

test('successful restoration preserves unknown binding inheritance while redacting its name from receipts', async (t) => {
  attestFixture(t);
  const value = settings();
  const privateName = 'pdl_live_apikey_' + 'A'.repeat(32) + '_synthetic_only';
  const privateBinding = { name: privateName, type: 'secret_text' };
  value.bindings.push(privateBinding);
  const adapter = harness({ initialSettings: value });
  const receipt = await run(adapter);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.protectedSettingsUnchanged, true);
  assert.equal(receipt.protectedBindingNamesRedacted, true);
  assert.ok(receipt.protectedBindingNames.includes('PADDLE_API_KEY'));
  assert.ok(
    receipt.protectedBindingNames.every((name) =>
      value.bindings.some((item) => item.name === name),
    ),
  );
  assert.ok(!JSON.stringify(receipt).includes(privateName));
  assert.deepEqual(adapter.binding(privateName), privateBinding);
  assert.deepEqual(
    adapter.mutations[0].payload.bindings.find(({ name }) => name === privateName),
    {
      name: privateName,
      type: 'inherit',
      version_id: originalVersion,
    },
  );
  assert.deepEqual(kinds(adapter), ['stage', 'activate']);
});
