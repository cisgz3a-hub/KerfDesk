import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

import { validateDesktopPackageGate } from './check-desktop-package-gate.mjs';

const mandatory = ['linux-package', 'linux-installers', 'commercial-linux'];
const native = ['commercial-macos', 'windows-package', 'macos-package'];
const successful = () =>
  Object.fromEntries([...mandatory, ...native].map((id) => [id, { result: 'success' }]));

test('all successful desktop jobs pass with either native requirement', () => {
  assert.equal(validateDesktopPackageGate(successful(), false).ok, true);
  assert.equal(validateDesktopPackageGate(successful(), true).ok, true);
});

for (const id of [...mandatory, ...native]) {
  for (const result of ['failure', 'cancelled', 'pending', 'unknown', undefined]) {
    test(`${id} rejects ${String(result)} even when native packaging is optional`, () => {
      const needs = successful();
      needs[id] = { result };
      assert.equal(validateDesktopPackageGate(needs, false).ok, false);
    });
  }
  test(`${id} rejects a missing job`, () => {
    const needs = Object.fromEntries(Object.entries(successful()).filter(([key]) => key !== id));
    assert.equal(validateDesktopPackageGate(needs, false).ok, false);
  });
  test(`${id} only permits a native-only condition skip`, () => {
    const needs = successful();
    needs[id] = { result: 'skipped' };
    assert.equal(validateDesktopPackageGate(needs, false).ok, native.includes(id));
    assert.equal(validateDesktopPackageGate(needs, true).ok, false);
  });
}

test('all native jobs can be conditionally skipped on a normal pull request', () => {
  const needs = successful();
  for (const id of native) needs[id] = { result: 'skipped' };
  assert.equal(validateDesktopPackageGate(needs, false).ok, true);
});

test('additional jobs are mandatory until an applicability rule is defined', () => {
  assert.equal(
    validateDesktopPackageGate({ ...successful(), future: { result: 'success' } }, false).ok,
    true,
  );
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.equal(
      validateDesktopPackageGate({ ...successful(), future: { result } }, false).ok,
      false,
    );
  }
});

test('invalid payloads and an ambiguous native requirement fail closed', () => {
  for (const needs of [null, undefined, [], 'success', {}]) {
    assert.equal(validateDesktopPackageGate(needs, false).ok, false);
  }
  for (const required of [undefined, null, 'false']) {
    assert.equal(validateDesktopPackageGate(successful(), required).ok, false);
  }
});

test('the required desktop gate waits for every packaging job and always checks their results', async () => {
  const workflow = load(await readFile('.github/workflows/desktop-package-check.yml', 'utf8'), {
    schema: JSON_SCHEMA,
  });
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
  const gates = Object.entries(workflow.jobs).filter(
    ([, job]) => job.name === 'Desktop packaging gate',
  );
  assert.equal(gates.length, 1);
  const [[id, gate]] = gates;
  assert.deepEqual(
    [...gate.needs].sort(),
    Object.keys(workflow.jobs)
      .filter((key) => key !== id)
      .sort(),
  );
  assert.equal(gate.if, 'always()');
  const verdict = gate.steps.find(
    (step) => step.run === 'node scripts/check-desktop-package-gate.mjs',
  );
  assert.ok(verdict);
  assert.equal(verdict.if, undefined);
  assert.equal(verdict.env.NEEDS, '${{ toJSON(needs) }}');
  assert.equal(verdict.env.NATIVE_REQUIRED, '${{ inputs.native == true }}');
  for (const jobId of mandatory) assert.equal(workflow.jobs[jobId].if, undefined);
  for (const jobId of native) assert.equal(workflow.jobs[jobId].if, '${{ inputs.native == true }}');
});

test('the actual CLI succeeds for passing results and exits nonzero for cancellation or malformed input', () => {
  const invoke = (needs, required = 'false') =>
    spawnSync(process.execPath, ['scripts/check-desktop-package-gate.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, NEEDS: needs, NATIVE_REQUIRED: required },
    });
  const passed = invoke(JSON.stringify(successful()));
  assert.equal(passed.status, 0, passed.stderr);
  const needs = successful();
  needs['linux-package'].result = 'cancelled';
  const cancelled = invoke(JSON.stringify(needs));
  assert.equal(cancelled.status, 1, cancelled.stderr);
  assert.match(cancelled.stderr, /linux-package: cancelled/u);
  assert.equal(invoke('{').status, 1);
  assert.equal(invoke(JSON.stringify(successful()), '').status, 1);
});
