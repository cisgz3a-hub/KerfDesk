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
  originalNumber,
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

test('an initially newer inactive upload refuses restoration before every operator upload', async (t) => {
  attestFixture(t);
  for (const retainedBundle of [undefined, gzipSync(code).toString('base64')]) {
    const adapter = harness({ initialLatestVersion: unrelatedVersion });
    await assert.rejects(run(adapter, { retainedBundle }), (error) => {
      const receipt = error.receipt;
      assert.equal(receipt.failure.stage, 'sandbox-inheritance-baseline-verification');
      assert.equal(receipt.stagingAttempted, false);
      assert.equal(receipt.deploymentAttempted, false);
      assert.equal(receipt.mutated, false);
      assert.equal(receipt.inheritance.inferredProvenance, false);
      assert.equal(receipt.inheritance.atomicSourcePin, false);
      assert.ok(!JSON.stringify(receipt).includes(token));
      return true;
    });
    assert.deepEqual(kinds(adapter), []);
    assert.deepEqual(adapter.externalUploads, [unrelatedVersion]);
    assert.equal(adapter.latest(), unrelatedVersion);
    assert.equal(adapter.version(), originalVersion);
  }
});

test('a concurrent inactive upload at the preupload boundary refuses while active UUID is unchanged', async (t) => {
  attestFixture(t);
  const adapter = harness({ inactiveUploadAtLatestRead: 2 });
  await assert.rejects(run(adapter), (error) => {
    const receipt = error.receipt;
    assert.equal(receipt.failure.stage, 'sandbox-inheritance-pre-upload-verification');
    assert.equal(receipt.stagingAttempted, false);
    assert.equal(receipt.deploymentAttempted, false);
    assert.equal(receipt.inheritance.inferredProvenance, false);
    assert.equal(receipt.mutated, false);
    return true;
  });
  assert.equal(adapter.latestReads(), 2);
  assert.deepEqual(kinds(adapter), []);
  assert.deepEqual(adapter.externalUploads, [unrelatedVersion]);
  assert.equal(adapter.latest(), unrelatedVersion);
  assert.equal(adapter.version(), originalVersion);
});

test('candidate number and retained history mismatches prevent every activation', async (t) => {
  attestFixture(t);
  for (const options of [
    { stagedVersionNumber: originalNumber + 2 },
    {
      stagedResourceChange: (version) => {
        version.number = originalNumber + 2;
      },
    },
    {
      latestListChange: (items, readIndex) => {
        if (readIndex === 3) items[1].id = unrelatedVersion;
      },
    },
    {
      latestListChange: (items, readIndex) => {
        if (readIndex === 3) items[1].annotations = { 'workers/tag': token };
      },
    },
    { inactiveUploadAtLatestRead: 3 },
  ]) {
    const adapter = harness(options);
    await assert.rejects(run(adapter), (error) => {
      const receipt = error.receipt;
      assert.equal(receipt.failure.stage, 'sandbox-inheritance-staged-verification');
      assert.equal(receipt.stagingAttempted, true);
      assert.equal(receipt.uploadResponseReceived, true);
      assert.equal(receipt.stagedVersionVerified, false);
      assert.equal(receipt.inheritance.inferredProvenance, false);
      assert.equal(receipt.deploymentAttempted, false);
      assert.equal(receipt.recovery.rollbackAttempted, false);
      assert.equal(receipt.recovery.closedVerified, true);
      assert.equal(receipt.mutated, false);
      assert.ok(!JSON.stringify(receipt).includes(token));
      return true;
    });
    assert.deepEqual(kinds(adapter), ['stage']);
    assert.equal(adapter.version(), originalVersion);
  }
});

test('an inactive upload after candidate code verification prevents activation and stays untouched', async (t) => {
  attestFixture(t);
  const adapter = harness({ inactiveUploadAtLatestRead: 4 });
  await assert.rejects(run(adapter), (error) => {
    const receipt = error.receipt;
    assert.equal(receipt.failure.stage, 'sandbox-inheritance-pre-activation-verification');
    assert.equal(receipt.stagedVersionVerified, true);
    assert.equal(receipt.inheritance.inferredProvenance, true);
    assert.equal(receipt.inheritance.lastVerifiedStage, 'sandbox-inheritance-staged-verification');
    assert.equal(receipt.inheritance.atomicSourcePin, false);
    assert.equal(receipt.inheritance.opaqueSecretEqualityProven, false);
    assert.equal(receipt.deploymentAttempted, false);
    assert.equal(receipt.recovery.rollbackAttempted, false);
    assert.equal(receipt.recovery.closedVerified, true);
    return true;
  });
  const finalPageIndex = adapter.calls.findLastIndex(({ url }) => url.endsWith('/versions'));
  assert.ok(
    adapter.calls
      .slice(0, finalPageIndex)
      .some(({ url }) => url.includes('/content/v2?version=' + nextVersion)),
  );
  assert.equal(adapter.latestReads(), 4);
  assert.deepEqual(kinds(adapter), ['stage']);
  assert.deepEqual(adapter.externalUploads, [unrelatedVersion]);
  assert.equal(adapter.latest(), unrelatedVersion);
  assert.equal(adapter.version(), originalVersion);
});

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

test('lost upload ACK records inactive readback evidence without qualifying or activating the candidate', async (t) => {
  attestFixture(t);
  for (const loseUploadBeforeApply of [false, true]) {
    const adapter = harness({ loseUploadResponse: true, loseUploadBeforeApply });
    await assert.rejects(run(adapter), (error) => {
      assert.equal(error.receipt.failure.stage, 'sandbox-code-upload');
      assert.equal(error.receipt.uploadResponseReceived, false);
      assert.equal(error.receipt.stagedVersionVerified, false);
      assert.equal(error.receipt.stagedVersion, loseUploadBeforeApply ? null : nextVersion);
      assert.equal(error.receipt.inheritance.inferredProvenance, false);
      assert.equal(error.receipt.inheritance.atomicSourcePin, false);
      assert.equal(error.receipt.inheritance.opaqueSecretEqualityProven, false);
      assert.equal(error.receipt.recovery.stagingReadBackVerified === true, !loseUploadBeforeApply);
      assert.equal(error.receipt.deploymentAttempted, false);
      assert.equal(error.receipt.recovery.rollbackAttempted, false);
      assert.equal(error.receipt.recovery.closedVerified, true);
      assert.equal(error.receipt.mutated, false);
      return true;
    });
    assert.deepEqual(kinds(adapter), ['stage']);
    assert.equal(adapter.latestReads(), 2);
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

test('staged activation preserves fixture bindings and records inferred latest provenance without atomic or opaque-secret proof', async (t) => {
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
  assert.deepEqual(receipt.inheritance, {
    mode: 'guarded-latest',
    inferredProvenance: true,
    atomicSourcePin: false,
    opaqueSecretEqualityProven: false,
    originalVersion,
    candidateVersion: nextVersion,
    originalNumber,
    candidateNumber: originalNumber + 1,
    retainedHistoryRows: 2,
    lastVerifiedStage: 'sandbox-inheritance-pre-activation-verification',
  });
  assert.equal(adapter.latestReads(), 4);
  assert.deepEqual(adapter.authorityState, state);
  for (const item of value.bindings) assert.deepEqual(adapter.binding(item.name), item);
  const metadata = adapter.mutations[0].payload;
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.migrations, undefined);
  assert.equal(metadata.assets, undefined);
  assert.ok(
    metadata.bindings
      .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
      .every(({ type, version_id }) => type === 'inherit' && version_id === 'latest'),
  );
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
      version_id: 'latest',
    },
  );
  assert.deepEqual(kinds(adapter), ['stage', 'activate']);
});
