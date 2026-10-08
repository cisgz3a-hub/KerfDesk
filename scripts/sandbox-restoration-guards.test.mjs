import test from 'node:test';
import assert from 'node:assert/strict';
import { attestSandboxVersion } from './sandbox-restoration-guards.mjs';
import {
  originalVersion,
  settings,
  versionResources,
  token,
} from './refresh-sandbox-test-fixtures.mjs';
const info = (value) => ({
  id: originalVersion,
  resources: versionResources(value),
  ...(value.cache_options === undefined ? {} : { cache_options: value.cache_options }),
});

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
