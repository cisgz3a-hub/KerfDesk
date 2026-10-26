import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

// ADR-645: main merges through GitHub's merge queue. The queue tests each
// entry on a gh-readonly-queue/main/... branch and merges it only when every
// check main's ruleset requires has passed there, so the workflows reporting
// those checks must run on merge_group and report them under the same names.
// Deploys and releases stay on pushes to main.

const REQUIRED_CHECKS = {
  '.github/workflows/ci.yml': ['Lint, typecheck, license, test, build'],
  '.github/workflows/e2e.yml': ['Chrome UX smoke'],
  '.github/workflows/desktop-package-check.yml': [
    'Package, check and launch the desktop app',
    'Package, install and launch the Linux AppImage and .deb',
    'Rehearse the commercial Linux build (x64)',
  ],
};

// Pull-request and push data that a merge_group event does not carry.
const EVENT_SPECIFIC = /github\.(event_name|head_ref|base_ref|event\.)/u;
// The one event test a condition may make: whether this is a pull request.
// Pull requests run the lighter checks (ADR-647); a merge queue entry, like a
// push to main, runs them all.
const PULL_REQUEST_TEST = /github\.event_name [!=]= 'pull_request'/gu;

async function readWorkflow(path) {
  return load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA });
}

// The check names a job reports: one per matrix combination of a name that
// uses ${{ matrix.<key> }}.
function checkNamesOf(job) {
  const keys = [...job.name.matchAll(/\$\{\{ matrix\.(\w+) \}\}/gu)].map((match) => match[1]);
  if (keys.length === 0) return [job.name];
  const matrix = job.strategy?.matrix ?? {};
  const combinations =
    matrix.include ??
    keys.reduce(
      (rows, key) => rows.flatMap((row) => matrix[key].map((value) => ({ ...row, [key]: value }))),
      [{}],
    );
  return combinations.map((row) =>
    job.name.replace(/\$\{\{ matrix\.(\w+) \}\}/gu, (_, key) => String(row[key])),
  );
}

for (const [path, checks] of Object.entries(REQUIRED_CHECKS)) {
  test(`${path} runs on the merge queue as on pull requests`, async () => {
    const workflow = await readWorkflow(path);

    assert.deepEqual(workflow.on.merge_group, { types: ['checks_requested'] });
    // No branch or path filter may leave a queue entry or a pull request
    // without the checks the ruleset waits for.
    assert.equal(workflow.on.pull_request, null);
    assert.deepEqual(workflow.on.push, { branches: ['main'] });
    // Each queue entry has its own ref, so its own concurrency group.
    assert.match(workflow.concurrency.group, /github\.ref \}\}$/u);
  });

  test(`${path} reports its required checks on every event`, async () => {
    const workflow = await readWorkflow(path);
    const jobs = Object.values(workflow.jobs);
    const reported = jobs.flatMap(checkNamesOf);

    for (const check of checks) {
      assert.equal(reported.filter((name) => name === check).length, 1, `${check} is reported`);
    }
    for (const job of jobs) {
      for (const condition of [job.if, ...(job.steps ?? []).map((step) => step.if)]) {
        assert.doesNotMatch(
          String(condition ?? '').replace(PULL_REQUEST_TEST, ''),
          EVENT_SPECIFIC,
          `${job.name}: ${condition}`,
        );
      }
    }
  });
}

test('deploys and releases follow pushes to main, never a merge queue run', async () => {
  const deploy = await readWorkflow('.github/workflows/deploy.yml');
  const unsigned = await readWorkflow('.github/workflows/release-desktop-unsigned.yml');

  for (const workflow of [deploy, unsigned]) {
    assert.deepEqual(workflow.on.workflow_run.branches, ['main']);
    assert.equal(workflow.on.merge_group, undefined);
  }
  assert.match(deploy.jobs.deploy.if, /github\.event\.workflow_run\.event == 'push'/u);
  assert.match(unsigned.jobs.qualify.if, /github\.event\.workflow_run\.event == 'push'/u);
  assert.match(unsigned.jobs.qualify.if, /github\.event\.workflow_run\.head_branch == 'main'/u);
});
