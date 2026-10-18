import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSON_SCHEMA, load } from 'js-yaml';
import {
  NATIVE_PACKAGING_JOBS,
  ORDINARY_PACKAGING_JOBS,
  verifyPackagingResults,
} from './desktop-packaging-gate.mjs';

const results = (nativeSelected = false) =>
  Object.fromEntries([
    ...ORDINARY_PACKAGING_JOBS.map((job) => [job, { result: 'success' }]),
    ...NATIVE_PACKAGING_JOBS.map((job) => [
      job,
      { result: nativeSelected ? 'success' : 'skipped' },
    ]),
  ]);

test('ordinary PR packaging succeeds while explicitly unselected native jobs are skipped', () => {
  assert.deepEqual(verifyPackagingResults(results(), false), {
    status: 'passed',
    nativeSelected: false,
  });
});

test('a manual or reusable native run requires every native platform and matrix to succeed', () => {
  assert.deepEqual(verifyPackagingResults(results(true), true), {
    status: 'passed',
    nativeSelected: true,
  });
  for (const job of NATIVE_PACKAGING_JOBS) {
    for (const outcome of ['skipped', 'failure', 'cancelled', 'unknown', undefined]) {
      const needs = results(true);
      needs[job].result = outcome;
      assert.throws(() => verifyPackagingResults(needs, true), new RegExp(job));
    }
  }
});

test('failed, cancelled or skipped ordinary packaging cannot produce a green aggregate', () => {
  for (const job of ORDINARY_PACKAGING_JOBS) {
    for (const outcome of ['skipped', 'failure', 'cancelled', 'unknown', undefined]) {
      const needs = results();
      needs[job].result = outcome;
      assert.throws(() => verifyPackagingResults(needs, false), new RegExp(job));
    }
  }
});

test('missing and unexpected job results or missing native selection fail closed', () => {
  for (const job of [...ORDINARY_PACKAGING_JOBS, ...NATIVE_PACKAGING_JOBS]) {
    const needs = Object.fromEntries(Object.entries(results()).filter(([key]) => key !== job));
    assert.throws(() => verifyPackagingResults(needs, false), /complete/);
  }
  assert.throws(
    () => verifyPackagingResults({ ...results(), newJob: { result: 'success' } }, false),
    /complete/,
  );
  assert.throws(() => verifyPackagingResults(results(), undefined), /selection/);
});

test('the required aggregate always observes every packaging job and uses the actual native input', async () => {
  const workflow = load(
    await readFile(
      new URL('../.github/workflows/desktop-package-check.yml', import.meta.url),
      'utf8',
    ),
    { schema: JSON_SCHEMA },
  );
  const gates = Object.entries(workflow.jobs).filter(
    ([, job]) => job.name === 'Desktop packaging gate',
  );
  assert.equal(gates.length, 1);
  const [[gateId, gate]] = gates;
  assert.equal(gate.if, 'always()');
  assert.deepEqual(
    [...gate.needs].sort(),
    Object.keys(workflow.jobs)
      .filter((id) => id !== gateId)
      .sort(),
  );
  assert.deepEqual(
    [...gate.needs].sort(),
    [...ORDINARY_PACKAGING_JOBS, ...NATIVE_PACKAGING_JOBS].sort(),
  );
  for (const job of ORDINARY_PACKAGING_JOBS) assert.equal(workflow.jobs[job].if, undefined);
  for (const job of NATIVE_PACKAGING_JOBS)
    assert.equal(workflow.jobs[job].if, '${{ inputs.native == true }}');
  const verdict = gate.steps.find((step) => step.run === 'node scripts/desktop-packaging-gate.mjs');
  assert.equal(verdict.env.NEEDS, '${{ toJSON(needs) }}');
  assert.equal(verdict.env.NATIVE_PACKAGING, '${{ inputs.native == true }}');
  assert.equal(
    gate.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref,
    undefined,
  );
});

test('the actual CLI refuses a cancelled job and an absent selection, and accepts ordinary success', () => {
  const script = fileURLToPath(new URL('./desktop-packaging-gate.mjs', import.meta.url));
  const execute = (needs, selected) =>
    spawnSync(process.execPath, [script], {
      env: { ...process.env, NEEDS: JSON.stringify(needs), NATIVE_PACKAGING: selected },
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
  assert.equal(execute(results(), 'false').status, 0);
  const needs = results();
  needs['linux-package'].result = 'cancelled';
  assert.equal(execute(needs, 'false').status, 1);
  assert.equal(execute(results(), '').status, 1);
});
