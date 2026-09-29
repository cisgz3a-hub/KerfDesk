import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

// ADR-557: CI and Browser smoke run as parallel jobs. Each workflow's last job
// keeps the check name a ruleset requires, and deploy.yml publishes after a
// successful CI run without running the release gate again. Both mean the whole
// gate passed only while that job waits for every other job and fails unless
// all of them passed, and while every release:check command runs in one of them.

async function readWorkflow(path) {
  return load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA });
}

function commandsOf(job) {
  return (job.steps ?? [])
    .flatMap((step) => (typeof step.run === 'string' ? step.run.split('\n') : []))
    .flatMap((line) => line.split('&&'))
    .map((command) => command.trim())
    .filter((command) => command !== '');
}

function gateOf(workflow, name) {
  const named = Object.entries(workflow.jobs).filter(([, job]) => job.name === name);
  assert.equal(named.length, 1, `exactly one job is named ${name}`);
  const [[gateId, gate]] = named;
  const others = Object.keys(workflow.jobs).filter((id) => id !== gateId);

  assert.ok(others.length > 1);
  assert.deepEqual([...gate.needs].sort(), others.sort(), `${name} waits for every other job`);
  // GitHub counts a skipped required check as passed, so the gate runs even
  // when a job it needs failed or was cancelled, and then fails.
  assert.equal(gate.if, 'always()');
  const verdict = gate.steps.find((step) => step.env?.NEEDS === '${{ toJSON(needs) }}');
  assert.ok(verdict, `${name} reads every needed job's result`);
  assert.match(verdict.run, /select\(\.value\.result != "success"\)/u);
  assert.match(verdict.run, /exit 1/u);
  return gate;
}

function shardJobOf(workflow, command) {
  const sharded = Object.values(workflow.jobs).filter((job) =>
    commandsOf(job).some((run) => run.startsWith(`${command} --shard=`)),
  );
  assert.equal(sharded.length, 1, `exactly one job runs ${command} in shards`);
  const [job] = sharded;
  const shards = job.strategy.matrix.shard;

  assert.ok(shards.length > 1);
  assert.deepEqual(
    shards,
    shards.map((_, index) => index + 1),
    'shards are numbered 1..N',
  );
  assert.equal(job.strategy['fail-fast'], false, 'one failed shard does not cancel the others');
  assert.ok(
    commandsOf(job).includes(`${command} --shard=\${{ matrix.shard }}/\${{ strategy.job-total }}`),
  );
  assert.ok(job.name.endsWith('(${{ matrix.shard }}/${{ strategy.job-total }})'));
  return job;
}

test('CI runs every release:check command in a job its gate waits for', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const releaseCheck = packageJson.scripts['release:check'].split('&&').map((c) => c.trim());
  const ci = await readWorkflow('.github/workflows/ci.yml');
  gateOf(ci, 'Lint, typecheck, license, test, build');
  const commands = Object.values(ci.jobs).flatMap(commandsOf);

  assert.ok(releaseCheck.length > 10);
  for (const command of releaseCheck) {
    assert.ok(
      commands.some((run) => run === command || run.startsWith(`${command} --shard=`)),
      `ci.yml does not run ${command}`,
    );
  }
  assert.ok(!commands.includes('pnpm release:check'));
});

test('CI splits the unit tests into shards', async () => {
  const ci = await readWorkflow('.github/workflows/ci.yml');

  shardJobOf(ci, 'pnpm test');
});

test('Browser smoke shards the suite and runs its other checks once', async () => {
  const e2e = await readWorkflow('.github/workflows/e2e.yml');
  gateOf(e2e, 'Chrome UX smoke');
  const suite = shardJobOf(e2e, 'pnpm test:e2e');
  const commands = Object.values(e2e.jobs).flatMap(commandsOf);

  // Each shard starts from the warm dependency cache the cold start check
  // leaves, as the whole suite did when one job ran both.
  const suiteCommands = commandsOf(suite);
  assert.ok(suiteCommands.indexOf('pnpm test:e2e:cold') >= 0);
  assert.ok(
    suiteCommands.indexOf('pnpm test:e2e:cold') <
      suiteCommands.findIndex((run) => run.startsWith('pnpm test:e2e --shard=')),
  );
  for (const command of [
    'pnpm typecheck:e2e',
    'pnpm check:e2e-discovery',
    'pnpm test:e2e e2e/connected-script-gcode-viewer.e2e.ts',
    'pnpm test:e2e:production-bundle',
  ]) {
    assert.ok(commands.includes(command), `e2e.yml does not run ${command}`);
  }
});

test('failure artifacts from parallel browser jobs do not collide', async () => {
  const e2e = await readWorkflow('.github/workflows/e2e.yml');
  const names = Object.values(e2e.jobs).flatMap((job) =>
    (job.steps ?? [])
      .filter((step) => String(step.uses).startsWith('actions/upload-artifact@'))
      .map((step) => step.with.name),
  );

  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('playwright-report-${{ matrix.shard }}'));
});
