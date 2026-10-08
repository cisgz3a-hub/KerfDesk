import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attestSandboxVersion,
  sandboxConfiguredPlacement,
  sandboxSettingsFingerprint,
} from './sandbox-restoration-guards.mjs';
import { sandboxUploadMetadata } from './refresh-sandbox-script.mjs';
import {
  originalVersion,
  settings,
  versionResources,
  token,
  fixtureTag,
  attestFixture,
  harness,
  run,
} from './refresh-sandbox-test-fixtures.mjs';
const info = (value) => ({
  id: originalVersion,
  resources: versionResources(value),
  ...(value.cache_options === undefined ? {} : { cache_options: value.cache_options }),
});
const targeted = (field, value) => ({ mode: 'targeted', target: [{ [field]: value }] });

test('version resources use documented locations and omit nonversioned settings', () => {
  const value = settings();
  value.limits = { cpu_ms: 50 };
  value.placement = { mode: 'smart' };
  value.cache_options = { enabled: false };
  const version = info(value);
  delete version.resources.script.placement;
  version.resources.script.placement_mode = 'smart';
  version.resources.script_runtime.compatibility_date += 'T00:00:00.000Z';
  const diagnostic = {};
  const baseline = attestSandboxVersion(version, originalVersion, value, diagnostic);
  assert.equal(diagnostic.bindingsEqual, true);
  assert.ok(Object.values(diagnostic.valuesEqual).every(Boolean));
  assert.equal(version.resources.script_runtime.observability, undefined);
  assert.equal(version.resources.script_runtime.logpush, undefined);
  assert.equal(version.resources.script_runtime.tail_consumers, undefined);
  assert.equal(
    attestSandboxVersion(info(value), originalVersion, value, {}, baseline).runtime.migration_tag,
    'sandbox-v1',
  );
});

test('only documented empty/default runtime representations compare equivalently', () => {
  const value = settings();
  value.compatibility_flags = [];
  const version = info(value);
  delete version.resources.script_runtime.compatibility_flags;
  version.resources.script_runtime.limits = null;
  delete version.resources.script.placement;
  version.cache_options = null;
  assert.doesNotThrow(() => attestSandboxVersion(version, originalVersion, value));
  for (const mutate of [
    (v) => {
      v.resources.script_runtime.compatibility_date = '2026-09-28T01:00:00Z';
    },
    (v) => {
      delete v.resources.script_runtime.usage_model;
    },
    (v) => {
      v.resources.script_runtime.compatibility_flags = ['different-runtime'];
    },
    (v) => {
      v.resources.script.placement_mode = token;
    },
  ]) {
    const changed = structuredClone(version);
    mutate(changed);
    assert.throws(() => attestSandboxVersion(changed, originalVersion, value));
  }
});

test('candidate runtime preserves original migration, exports and named class handlers', () => {
  const value = settings();
  const baseline = attestSandboxVersion(info(value), originalVersion, value);
  for (const mutate of [
    (v) => {
      v.resources.script_runtime.migration_tag = 'new-migration';
    },
    (v) => {
      v.resources.script_runtime.exports.SandboxLicenseAuthority.storage = 'legacy-kv';
    },
    (v) => {
      v.resources.script_runtime.exports.SandboxLicenseAuthority.state = 'deleted';
    },
    (v) => {
      v.resources.script.named_handlers = [];
    },
  ]) {
    const version = info(value);
    mutate(version);
    const diagnostic = {};
    assert.throws(() =>
      attestSandboxVersion(version, originalVersion, value, diagnostic, baseline),
    );
    assert.equal(diagnostic.valuesEqual.originalVersionResources, false);
  }
});

test('malformed, duplicate, oversized and deeply nested resources refuse with redacted facts', () => {
  const value = settings();
  for (const mutate of [
    (v) => {
      v.id = token;
    },
    (v) => {
      v.resources.bindings = {};
    },
    (v) => {
      v.resources.bindings.push(v.resources.bindings[0]);
    },
    (v) => {
      v.resources.bindings = Array.from({ length: 129 }, (_, i) => ({
        name: String(i),
        type: 'plain_text',
      }));
    },
    (v) => {
      v.resources.bindings.push({ name: token, type: token, text: token });
    },
    (v) => {
      v.resources.script.named_handlers = [token.repeat(32768)];
    },
    (v) => {
      let nested = {};
      for (let i = 0; i < 40; i++) nested = { nested };
      v.resources.script_runtime.limits = nested;
    },
  ]) {
    const version = info(value),
      diagnostic = {};
    mutate(version);
    assert.throws(() => attestSandboxVersion(version, originalVersion, value, diagnostic));
    assert.ok(!JSON.stringify(diagnostic).includes(token));
    assert.ok(diagnostic.bindings.length <= 32);
    assert.ok(Object.values(diagnostic.valuesEqual).every((entry) => typeof entry === 'boolean'));
  }
});

test('documented placement analysis changes on either response preserve configuration and snapshots', () => {
  const value = settings();
  value.placement = { mode: 'smart', hint: token };
  const baseline = attestSandboxVersion(info(value), originalVersion, value);
  const fingerprint = sandboxSettingsFingerprint(value);
  for (const status of ['SUCCESS', 'UNSUPPORTED_APPLICATION', 'INSUFFICIENT_INVOCATIONS']) {
    const version = info(value);
    Object.assign(version.resources.script.placement, {
      status,
      last_analyzed_at: '2026-10-08T12:00:00Z',
    });
    Object.assign(value.placement, { status: 'SUCCESS', last_analyzed_at: token });
    const diagnostic = {};
    assert.deepEqual(
      attestSandboxVersion(version, originalVersion, value, diagnostic, baseline),
      baseline,
    );
    assert.equal(sandboxSettingsFingerprint(value), fingerprint);
    assert.equal(
      diagnostic.placement.script.fields.find(({ name }) => name === 'status').value,
      status,
    );
    assert.ok(Object.values(diagnostic.placement.fieldsEqual).every(Boolean));
    assert.ok(!JSON.stringify(diagnostic).includes(token));
    assert.ok(!JSON.stringify(diagnostic).includes('2026-10-08T12:00:00Z'));
  }
});

test('only documented off omission and legacy smart aliases become equivalent', () => {
  const value = settings();
  const fingerprint = sandboxSettingsFingerprint(value);
  for (const observed of [undefined, null, { mode: 'off' }]) {
    value.placement = observed;
    const version = info(value);
    delete version.resources.script.placement;
    version.resources.script.placement_mode = 'off';
    assert.doesNotThrow(() => attestSandboxVersion(version, originalVersion, value));
    assert.equal(sandboxSettingsFingerprint(value), fingerprint);
  }
  value.placement = { mode: 'smart' };
  const version = info(value);
  delete version.resources.script.placement;
  version.resources.script.placement_mode = 'smart';
  assert.doesNotThrow(() => attestSandboxVersion(version, originalVersion, value));
  version.resources.script.placement_mode = 'targeted';
  assert.throws(() => attestSandboxVersion(version, originalVersion, value));
});

test('modern configured placement keeps Wrangler precedence over the deprecated mode', () => {
  for (const [placement, legacyMode, expected] of [
    [{ mode: 'smart' }, 'targeted', { mode: 'smart' }],
    [{ mode: 'targeted', region: token }, 'smart', targeted('region', token)],
  ]) {
    const value = settings();
    value.placement = placement;
    const version = info(value);
    version.resources.script.placement_mode = legacyMode;
    assert.deepEqual(attestSandboxVersion(version, originalVersion, value).placement, expected);
  }
});

test('every configured mode, hint and target remains exact through fingerprints and candidate snapshots', () => {
  for (const [placement, changed, field] of [
    [{ mode: 'smart' }, { mode: 'off' }, 'mode'],
    [{ mode: 'smart', hint: token }, { mode: 'smart', hint: token + '-changed' }, 'hint'],
    [{ region: token }, { region: token + '-changed' }, 'region'],
    [{ mode: 'targeted', host: token }, { mode: 'targeted', host: token + '-changed' }, 'host'],
    [{ hostname: token }, { hostname: token + '-changed' }, 'hostname'],
    [
      { mode: 'targeted', target: [{ host: token }] },
      { mode: 'targeted', target: [{ host: token + '-changed' }] },
      'target',
    ],
  ]) {
    const value = settings();
    value.placement = structuredClone(placement);
    const directTarget = ['region', 'host', 'hostname'].includes(field);
    assert.deepEqual(
      sandboxConfiguredPlacement(value.placement),
      directTarget ? targeted(field, token) : placement,
    );
    const baseline = attestSandboxVersion(info(value), originalVersion, value);
    const fingerprint = sandboxSettingsFingerprint(value);
    const version = info(value),
      diagnostic = {};
    version.resources.script.placement = structuredClone(changed);
    assert.throws(() => attestSandboxVersion(version, originalVersion, value, diagnostic));
    assert.equal(diagnostic.valuesEqual.placement, false);
    assert.equal(diagnostic.placement.fieldsEqual[directTarget ? 'target' : field], false);
    if (directTarget) assert.equal(diagnostic.placement.fieldsEqual[field], false);
    value.placement = structuredClone(changed);
    assert.notEqual(sandboxSettingsFingerprint(value), fingerprint);
    assert.throws(() => attestSandboxVersion(version, originalVersion, value, {}, baseline));
    assert.ok(!JSON.stringify(diagnostic).includes(token));
  }
});

test('unknown and malformed placement configuration refuses even when both responses match', () => {
  for (const placement of [
    {},
    { status: 'SUCCESS' },
    { last_analyzed_at: token },
    { mode: token },
    { mode: 'smart', [token]: token },
    { mode: 'smart', hint: { [token]: token } },
    { mode: 'smart', region: token },
    { mode: 'off', hint: token },
    { mode: 'targeted' },
    { mode: 'targeted', region: token, host: token },
    { mode: 'targeted', target: [] },
    { mode: 'targeted', target: [{ region: token }], region: token },
    { mode: 'targeted', target: [{ region: token }, { region: token }] },
    { mode: 'targeted', target: [{ [token]: token }] },
    { mode: 'targeted', target: [{ region: token, host: token }] },
    { mode: 'targeted', hostname: '' },
    [token],
    token,
    false,
  ]) {
    const value = settings(),
      diagnostic = {};
    value.placement = placement;
    assert.throws(() => attestSandboxVersion(info(value), originalVersion, value, diagnostic));
    assert.equal(diagnostic.valuesEqual.placement, false);
    assert.equal(diagnostic.placement.settings.valid, false);
    assert.equal(diagnostic.placement.script.valid, false);
    assert.throws(() => sandboxSettingsFingerprint(value));
    assert.throws(() => sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag));
    assert.ok(!JSON.stringify(diagnostic).includes(token));
  }
});

test('upload metadata strips only analysis while preserving placement, bindings and settings privately', () => {
  const value = settings();
  value.placement = {
    mode: 'targeted',
    target: [{ hostname: token }],
    status: 'SUCCESS',
    last_analyzed_at: token,
  };
  const original = structuredClone(value);
  const metadata = sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag);
  assert.deepEqual(metadata.placement, { mode: 'targeted', hostname: token });
  assert.deepEqual(value, original);
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.migrations, undefined);
  for (const item of value.bindings.filter(({ name }) => name !== 'PAYMENTS_ENABLED'))
    assert.deepEqual(
      metadata.bindings.find(({ name }) => name === item.name),
      {
        name: item.name,
        type: 'inherit',
        version_id: originalVersion,
      },
    );
  assert.deepEqual(metadata.observability, value.observability);
  value.placement = { mode: 'off', status: 'SUCCESS' };
  assert.ok(
    !Object.hasOwn(
      sandboxUploadMetadata(value, originalVersion, 'worker.js', fixtureTag),
      'placement',
    ),
  );
});

test('restoration tolerates analysis churn through upload, staging and protected settings readback', async (t) => {
  attestFixture(t);
  const value = settings();
  value.placement = { mode: 'smart', hint: token, status: 'SUCCESS', last_analyzed_at: token };
  const adapter = harness({
    initialSettings: value,
    originalResourceChange: (version) => {
      version.resources.script.placement.status = 'UNSUPPORTED_APPLICATION';
    },
    stagedResourceChange: (version) => {
      version.resources.script.placement.status = 'INSUFFICIENT_INVOCATIONS';
    },
    postChange: (current) => {
      current.placement.last_analyzed_at = token + '-changed';
    },
  });
  const receipt = await run(adapter);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.stagedVersionVerified, true);
  assert.equal(receipt.protectedSettingsUnchanged, true);
  assert.equal(receipt.flag, 'false');
  assert.deepEqual(
    adapter.mutations.map(({ kind }) => kind),
    ['stage', 'activate'],
  );
  assert.deepEqual(adapter.mutations[0].payload.placement, { mode: 'smart', hint: token });
  assert.ok(!JSON.stringify(receipt).includes(token));
});

test('actual mismatch receipts expose safe placement shapes before any mutation', async (t) => {
  attestFixture(t);
  const value = settings();
  value.placement = { mode: 'targeted', target: [{ region: token }] };
  const adapter = harness({
    initialSettings: value,
    originalResourceChange: (version) => {
      version.resources.script.placement = {
        mode: token,
        target: [{ [token]: token }],
        status: token,
        last_analyzed_at: token,
      };
    },
  });
  await assert.rejects(run(adapter), (error) => {
    const receipt = error.receipt;
    assert.equal(receipt.failure.stage, 'sandbox-original-resource-verification');
    assert.equal(receipt.stagingAttempted, false);
    assert.equal(receipt.deploymentAttempted, false);
    const shape = receipt.versionResourceFailure.placement;
    assert.equal(shape.settings.valid, true);
    assert.equal(shape.script.valid, false);
    assert.equal(shape.script.targetCount, 1);
    assert.equal(shape.script.targets[0].unknownFields, true);
    assert.deepEqual(
      shape.script.fields.find(({ name }) => name === 'mode'),
      {
        name: 'mode',
        type: 'string',
        value: null,
      },
    );
    assert.deepEqual(
      shape.script.fields.find(({ name }) => name === 'status'),
      {
        name: 'status',
        type: 'string',
        value: null,
      },
    );
    assert.ok(!JSON.stringify(receipt).includes(token));
    return true;
  });
  assert.deepEqual(adapter.mutations, []);
});

test('placement diagnostics stop at the documented target depth and expose no unknown keys', () => {
  const value = settings(),
    diagnostic = {};
  let target = { [token]: token };
  for (let i = 0; i < 100; i++) target = { target: [target] };
  value.placement = { mode: 'targeted', target: [target] };
  assert.throws(() => attestSandboxVersion(info(value), originalVersion, value, diagnostic));
  assert.equal(diagnostic.placement.settings.targets[0].unknownFields, true);
  assert.equal(diagnostic.placement.settings.targets[0].targets, undefined);
  assert.ok(JSON.stringify(diagnostic.placement).length < 2500);
  assert.ok(!JSON.stringify(diagnostic).includes(token));
});
