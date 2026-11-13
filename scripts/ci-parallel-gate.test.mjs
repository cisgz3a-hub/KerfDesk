import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
  // Browser smoke also lets the suite job its event does not use be skipped
  // (ADR-647); run-pr-browser-smoke.test.mjs pins that exception.
  assert.match(verdict.run, /select\(\.value\.result != "success"[) ]/u);
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

test('Windows upgrade menu regression runs automatically and belongs to release integrity', async () => {
  const regression = 'scripts/installed-upgrade-menu.test.mjs';
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(packageJson.scripts['test:release-integrity'].split(/\s+/u).includes(regression));

  const ci = await readWorkflow('.github/workflows/ci.yml');
  assert.ok(Object.hasOwn(ci.on, 'pull_request'));
  assert.ok(ci.on.push.branches.includes('main'));
  const windowsJobs = Object.values(ci.jobs).filter((job) =>
    commandsOf(job).includes(`node --test ${regression}`),
  );
  assert.equal(windowsJobs.length, 1);
  const [job] = windowsJobs;
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(job.if, undefined);
  const invocation = job.steps.find((step) => step.run === `node --test ${regression}`);
  assert.equal(invocation.if, undefined);
  gateOf(ci, 'Lint, typecheck, license, test, build');
});

test('CI splits the unit tests into shards', async () => {
  const ci = await readWorkflow('.github/workflows/ci.yml');

  shardJobOf(ci, 'pnpm test');
});

test('every full release gate prepares the isolated service runtime and browser', async () => {
  const workflowFiles = (await readdir('.github/workflows')).filter((name) =>
    /\.ya?ml$/u.test(name),
  );
  let callers = 0;
  for (const file of workflowFiles) {
    const workflow = await readWorkflow(`.github/workflows/${file}`);
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const steps = job.steps ?? [];
      const preparation = steps.findIndex(
        (step) => step.uses === './.github/actions/setup-remote-control',
      );
      for (const [index, step] of steps.entries()) {
        if (!commandsOf({ steps: [step] }).some((command) => command === 'pnpm release:check'))
          continue;
        callers += 1;
        assert.ok(
          preparation >= 0 && preparation < index,
          `${file}/${jobName} must prepare its service checks first`,
        );
        assert.ok(steps[preparation].if === undefined || steps[preparation].if === step.if);
      }
    }
  }
  assert.ok(callers >= 7);
  const action = await readWorkflow('.github/actions/setup-remote-control/action.yml');
  const nodeSetup = action.runs.steps.find((step) =>
    String(step.uses).startsWith('actions/setup-node@'),
  );
  assert.equal(nodeSetup.with['node-version'], 24);
  assert.ok(
    commandsOf({ steps: action.runs.steps }).includes(
      'pnpm --dir services/remote-control install --frozen-lockfile --ignore-scripts',
    ),
  );
  assert.ok(
    commandsOf({ steps: action.runs.steps }).includes(
      'pnpm --dir services/remote-control exec playwright install --with-deps chromium',
    ),
  );
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

// Code-quality audit C2 D7-P3-1: with no limit GitHub lets a hung job hold a
// runner for 6 hours. Each limit is about twice the job's 90th-percentile run
// time, so a slower runner still finishes and a hang ends within the hour.
test('every CI and Browser smoke job, and the web deploy, has a time limit', async () => {
  const limits = {
    '.github/workflows/ci.yml': {
      'static-checks': 30,
      'policy-and-build': 20,
      'windows-native-tests': 20,
      'unit-tests': 45,
      'remote-control': 20,
      ci: 10,
    },
    '.github/workflows/e2e.yml': {
      plan: 10,
      checks: 30,
      suite: 75,
      'pull-request-suite': 60,
      chrome: 10,
    },
  };
  for (const [path, jobs] of Object.entries(limits)) {
    const workflow = await readWorkflow(path);
    assert.deepEqual(Object.keys(workflow.jobs).sort(), Object.keys(jobs).sort(), path);
    for (const [id, minutes] of Object.entries(jobs)) {
      assert.equal(workflow.jobs[id]['timeout-minutes'], minutes, `${path} ${id}`);
    }
  }
  // Each Playwright run on CI ends before its job's limit, so it still reports
  // (C2 D7). The development config runs the shards and the PR suite.
  const e2e = await readWorkflow('.github/workflows/e2e.yml');
  for (const [config, jobs] of [
    ['playwright.config.ts', ['suite', 'pull-request-suite']],
    ['playwright-production.config.ts', ['checks']],
  ]) {
    const match = /globalTimeout: process\.env(?:\.CI|\['CI'\]) \? (\d+) \* 60_000 : 0,/u.exec(
      await readFile(config, 'utf8'),
    );
    assert.ok(match, `${config} sets a CI-only globalTimeout`);
    for (const job of jobs) {
      assert.ok(Number(match[1]) < e2e.jobs[job]['timeout-minutes'], `${config} inside ${job}`);
    }
  }
  // A manual deploy runs the whole release gate in one job; a CI-verified
  // one only builds and publishes.
  const deploy = await readWorkflow('.github/workflows/deploy.yml');
  assert.equal(
    deploy.jobs.deploy['timeout-minutes'],
    "${{ github.event_name == 'workflow_dispatch' && 180 || 30 }}",
  );
});
