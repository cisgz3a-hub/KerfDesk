import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSON_SCHEMA, load } from 'js-yaml';
import {
  INSTALLER_PACKAGING_JOBS,
  NATIVE_PACKAGING_JOBS,
  ORDINARY_PACKAGING_JOBS,
  SCOPE_JOB,
  verifyPackagingResults,
} from './desktop-packaging-gate.mjs';

const results = (nativeSelected = false, installersSelected = true) =>
  Object.fromEntries([
    [SCOPE_JOB, { result: 'success' }],
    ...ORDINARY_PACKAGING_JOBS.map((job) => [
      job,
      {
        result:
          installersSelected || !INSTALLER_PACKAGING_JOBS.includes(job) ? 'success' : 'skipped',
      },
    ]),
    ...NATIVE_PACKAGING_JOBS.map((job) => [
      job,
      { result: nativeSelected ? 'success' : 'skipped' },
    ]),
  ]);

test('ordinary PR packaging succeeds while explicitly unselected native jobs are skipped', () => {
  assert.deepEqual(verifyPackagingResults(results(), false, true), {
    status: 'passed',
    nativeSelected: false,
    installersSelected: true,
  });
});

test('a renderer-only pull request may skip exactly the installer and commercial Linux jobs (ADR-647)', () => {
  assert.deepEqual(verifyPackagingResults(results(false, false), false, false), {
    status: 'passed',
    nativeSelected: false,
    installersSelected: false,
  });
  // Selected installers must pass; unselected ones must not have run.
  assert.throws(
    () => verifyPackagingResults(results(false, false), false, true),
    /linux-installers/,
  );
  assert.throws(
    () => verifyPackagingResults(results(false, true), false, false),
    /linux-installers/,
  );
  // The stable packaged launch never skips, and neither does the scope decision.
  for (const job of ['linux-package', SCOPE_JOB]) {
    for (const outcome of ['skipped', 'failure', 'cancelled']) {
      const needs = results(false, false);
      needs[job].result = outcome;
      assert.throws(() => verifyPackagingResults(needs, false, false), new RegExp(job));
    }
  }
});

test('a manual or reusable native run requires every native platform and matrix to succeed', () => {
  assert.deepEqual(verifyPackagingResults(results(true), true, true), {
    status: 'passed',
    nativeSelected: true,
    installersSelected: true,
  });
  for (const job of NATIVE_PACKAGING_JOBS) {
    for (const outcome of ['skipped', 'failure', 'cancelled', 'unknown', undefined]) {
      const needs = results(true);
      needs[job].result = outcome;
      assert.throws(() => verifyPackagingResults(needs, true, true), new RegExp(job));
    }
  }
});

test('failed, cancelled or skipped ordinary packaging cannot produce a green aggregate', () => {
  for (const job of ORDINARY_PACKAGING_JOBS) {
    for (const outcome of ['skipped', 'failure', 'cancelled', 'unknown', undefined]) {
      const needs = results();
      needs[job].result = outcome;
      assert.throws(() => verifyPackagingResults(needs, false, true), new RegExp(job));
    }
  }
});

test('missing and unexpected job results or missing native selection fail closed', () => {
  for (const job of [SCOPE_JOB, ...ORDINARY_PACKAGING_JOBS, ...NATIVE_PACKAGING_JOBS]) {
    const needs = Object.fromEntries(Object.entries(results()).filter(([key]) => key !== job));
    assert.throws(() => verifyPackagingResults(needs, false, true), /complete/);
  }
  assert.throws(
    () => verifyPackagingResults({ ...results(), newJob: { result: 'success' } }, false, true),
    /complete/,
  );
  assert.throws(() => verifyPackagingResults(results(), undefined, true), /selection/);
  assert.throws(() => verifyPackagingResults(results(), false, undefined), /selection/);
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
    [SCOPE_JOB, ...ORDINARY_PACKAGING_JOBS, ...NATIVE_PACKAGING_JOBS].sort(),
  );
  const installerCondition =
    "${{ !cancelled() && needs.packaging-scope.outputs.installers != 'false' }}";
  for (const job of ORDINARY_PACKAGING_JOBS) {
    const installer = INSTALLER_PACKAGING_JOBS.includes(job);
    assert.equal(workflow.jobs[job].if, installer ? installerCondition : undefined);
    assert.equal(workflow.jobs[job].needs, installer ? SCOPE_JOB : undefined);
  }
  for (const job of NATIVE_PACKAGING_JOBS)
    assert.equal(workflow.jobs[job].if, '${{ inputs.native == true }}');
  // The jobs a pull request may skip report the literal names the ruleset
  // requires. No matrix: a skipped matrix job reports its name unexpanded, and
  // a running one would append (x64) a second time.
  assert.equal(workflow.jobs['commercial-linux'].name, 'Rehearse the commercial Linux build (x64)');
  assert.equal(workflow.jobs['commercial-linux'].strategy, undefined);
  assert.equal(workflow.jobs['commercial-linux'].env.REHEARSAL_ARCH, 'x64');
  assert.equal(workflow.jobs['commercial-macos'].env.REHEARSAL_ARCH, '${{ matrix.arch }}');
  const scope = workflow.jobs[SCOPE_JOB];
  assert.equal(scope.if, undefined);
  assert.equal(scope.outputs.installers, '${{ steps.scope.outputs.installers }}');
  const decision = scope.steps.find((step) => step.id === 'scope');
  assert.equal(decision.run, 'node scripts/desktop-packaging-scope.mjs');
  assert.equal(decision.env.EVENT_NAME, '${{ github.event_name }}');
  const scopeCheckout = scope.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(scopeCheckout.with['fetch-depth'], 2);
  // Like the gate, the scope script runs from this workflow's revision: a
  // release-train call may select an older commit without the script.
  assert.equal(scopeCheckout.with.ref, undefined);
  const verdict = gate.steps.find((step) => step.run === 'node scripts/desktop-packaging-gate.mjs');
  assert.equal(verdict.env.NEEDS, '${{ toJSON(needs) }}');
  assert.equal(verdict.env.NATIVE_PACKAGING, '${{ inputs.native == true }}');
  assert.equal(
    verdict.env.INSTALLER_PACKAGING,
    "${{ needs.packaging-scope.outputs.installers != 'false' }}",
  );
  // The verdict runs from the workflow's own revision: a release-train call may
  // select an older commit that predates this script (ADR-621).
  assert.equal(
    gate.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref,
    undefined,
  );
});

test('the actual CLI refuses a cancelled job and an absent selection, and accepts ordinary success', () => {
  const script = fileURLToPath(new URL('./desktop-packaging-gate.mjs', import.meta.url));
  const execute = (needs, selected, installers = 'true') =>
    spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        NEEDS: JSON.stringify(needs),
        NATIVE_PACKAGING: selected,
        INSTALLER_PACKAGING: installers,
      },
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
  assert.equal(execute(results(), 'false').status, 0);
  const needs = results();
  needs['linux-package'].result = 'cancelled';
  assert.equal(execute(needs, 'false').status, 1);
  assert.equal(execute(results(), '').status, 1);
  assert.equal(execute(results(false, false), 'false', 'false').status, 0);
  assert.equal(execute(results(), 'false', '').status, 1);
});
