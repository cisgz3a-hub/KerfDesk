import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

import {
  CONTEXT,
  FIX_LABEL,
  WATCHED_WORKFLOWS,
  desiredStatus,
  githubClient,
  mainVerdict,
  needsWrite,
  pickVerdictRun,
  syncMainIsGreen,
} from './main-is-green.mjs';

// ADR-710: the required `main-is-green` status stops merges while main is red.
// These tests pin the workflow's shape (what triggers it, what it may touch,
// that it never runs a pull request's code) and the script's verdict.

const WORKFLOW = '.github/workflows/main-is-green.yml';
const SITE = { serverUrl: 'https://github.com', repository: 'owner/repo' };

async function readWorkflow(path) {
  return load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA });
}

function run(overrides = {}) {
  return {
    head_branch: 'main',
    head_sha: 'abcdef1234567890',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/owner/repo/actions/runs/1',
    ...overrides,
  };
}

test('the workflow re-syncs on every main completion of the watched workflows', async () => {
  const workflow = await readWorkflow(WORKFLOW);
  const names = [];
  for (const watched of WATCHED_WORKFLOWS) {
    // The trigger lists workflows by name; the script reads their runs by file.
    const { name } = await readWorkflow(`.github/workflows/${watched.file}`);
    assert.equal(name, watched.name, `${watched.file} is named ${watched.name}`);
    names.push(name);
  }
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: names,
    types: ['completed'],
    branches: ['main'],
  });
});

test('every pull request event that can change a head or its label gets a status', async () => {
  const workflow = await readWorkflow(WORKFLOW);
  assert.deepEqual(workflow.on.pull_request_target, {
    types: ['opened', 'reopened', 'synchronize', 'edited', 'labeled', 'unlabeled'],
    branches: ['main'],
  });
  // A pull_request run would execute the pull request's own copy of the gate,
  // which could be edited to pass itself, and fork runs cannot write statuses.
  assert.equal(Object.hasOwn(workflow.on, 'pull_request'), false);
});

test('the job never checks out or runs pull request code', async () => {
  const text = await readFile(WORKFLOW, 'utf8');
  const workflow = load(text, { schema: JSON_SCHEMA });
  const jobs = Object.values(workflow.jobs);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.if, "${{ github.ref == 'refs/heads/main' }}");

  const checkouts = job.steps.filter((step) => String(step.uses).startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 1);
  const [checkout] = checkouts;
  // Without ref or repository, both events check out main.
  assert.deepEqual(Object.keys(checkout.with).sort(), [
    'persist-credentials',
    'sparse-checkout',
    'sparse-checkout-cone-mode',
  ]);
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['sparse-checkout'], 'scripts/main-is-green.mjs');

  const runs = job.steps.filter((step) => step.run !== undefined).map((step) => step.run.trim());
  assert.deepEqual(runs, ['node scripts/main-is-green.mjs']);
  // No pull request data reaches a command line, and nothing is installed.
  assert.doesNotMatch(text, /github\.event\.pull_request|github\.head_ref|pnpm|npm /u);
});

test('the token can write statuses and read nothing it does not need', async () => {
  const workflow = await readWorkflow(WORKFLOW);
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.sync.permissions, {
    contents: 'read',
    actions: 'read',
    'pull-requests': 'read',
    statuses: 'write',
  });
  assert.doesNotMatch(await readFile(WORKFLOW, 'utf8'), /secrets\./u);
});

test('runs never overlap, so an older verdict cannot land after a newer one', async () => {
  const workflow = await readWorkflow(WORKFLOW);
  assert.deepEqual(workflow.concurrency, { group: 'main-is-green', 'cancel-in-progress': false });
});

test('the verdict run is the newest completed main run that has a verdict', () => {
  const runs = [
    run({ event: 'pull_request', conclusion: 'failure' }),
    run({ conclusion: 'cancelled' }),
    run({ conclusion: 'skipped' }),
    run({ head_branch: 'feature', conclusion: 'failure' }),
    run({ conclusion: 'failure', html_url: 'red' }),
    run({ conclusion: 'success' }),
  ];
  assert.equal(pickVerdictRun(runs).html_url, 'red');
  assert.equal(pickVerdictRun([run({ event: 'workflow_dispatch' })]).event, 'workflow_dispatch');
  assert.equal(pickVerdictRun([run({ conclusion: 'cancelled' })]), null);
});

test('main is green only when both workflows passed', () => {
  const [ci, smoke] = WATCHED_WORKFLOWS;
  const green = mainVerdict(
    [
      { workflow: ci, run: run() },
      { workflow: smoke, run: run() },
    ],
    SITE,
  );
  assert.equal(green.green, true);
  assert.equal(green.state, 'success');

  const red = mainVerdict(
    [
      { workflow: ci, run: run() },
      { workflow: smoke, run: run({ conclusion: 'timed_out', html_url: 'smoke-run' }) },
    ],
    SITE,
  );
  assert.equal(red.state, 'failure');
  assert.equal(red.targetUrl, 'smoke-run');
  assert.match(red.description, /Browser smoke failed on abcdef1/u);
  assert.ok(red.description.length <= 140);

  const bothRed = mainVerdict(
    [
      { workflow: ci, run: run({ conclusion: 'failure', html_url: 'ci-run' }) },
      { workflow: smoke, run: run({ conclusion: 'failure' }) },
    ],
    SITE,
  );
  assert.match(bothRed.description, /CI and Browser smoke failed/u);
  assert.equal(bothRed.targetUrl, 'ci-run');

  const unknown = mainVerdict(
    [
      { workflow: ci, run: null },
      { workflow: smoke, run: run() },
    ],
    SITE,
  );
  assert.equal(unknown.green, false);
  assert.equal(unknown.state, 'error');
});

test(`a pull request labelled ${FIX_LABEL} may merge while main is red`, () => {
  const red = { green: false, state: 'failure', description: 'main is red', targetUrl: 'red-run' };
  const green = { green: true, state: 'success', description: 'main is green', targetUrl: 'x' };
  assert.equal(desiredStatus(red, { labels: ['bug'] }).state, 'failure');
  const fix = desiredStatus(red, { labels: ['bug', FIX_LABEL] });
  assert.equal(fix.state, 'success');
  assert.equal(fix.targetUrl, 'red-run');
  assert.match(fix.description, /labelled fixes-main/u);
  assert.deepEqual(desiredStatus(green, { labels: [FIX_LABEL] }), {
    state: 'success',
    description: 'main is green',
    targetUrl: 'x',
  });
});

test('a status is rewritten only when it would change', () => {
  const desired = { state: 'failure', description: 'red', targetUrl: 'u' };
  assert.equal(needsWrite(null, desired), true);
  assert.equal(
    needsWrite({ state: 'FAILURE', description: 'red', targetUrl: 'u' }, desired),
    false,
  );
  assert.equal(needsWrite({ state: 'SUCCESS', description: 'red', targetUrl: 'u' }, desired), true);
  assert.equal(needsWrite({ state: 'FAILURE', description: 'red', targetUrl: 'v' }, desired), true);
});

function fakeClient({ ci, smoke, pages }) {
  const writes = [];
  const queries = [];
  return {
    writes,
    queries,
    async rest(path, options) {
      if (options?.method === 'POST') {
        writes.push({ path, body: options.body });
        return {};
      }
      if (path.includes('/workflows/ci.yml/')) return { workflow_runs: ci };
      if (path.includes('/workflows/e2e.yml/')) return { workflow_runs: smoke };
      throw new Error(`unexpected ${path}`);
    },
    async graphql(_query, variables) {
      queries.push(variables);
      const index = variables.after === null ? 0 : Number(variables.after);
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: index + 1 < pages.length, endCursor: String(index + 1) },
            nodes: pages[index],
          },
        },
      };
    },
  };
}

function pullRequest(number, sha, { labels = [], status = null, commitSha = sha } = {}) {
  return {
    number,
    headRefOid: sha,
    labels: { nodes: labels.map((name) => ({ name })) },
    commits: { nodes: [{ commit: { oid: commitSha, status: { context: status } } }] },
  };
}

test('a red main fails every open head except the fix, across pages', async () => {
  const redStatus = mainVerdict(
    [
      { workflow: WATCHED_WORKFLOWS[0], run: run() },
      { workflow: WATCHED_WORKFLOWS[1], run: run({ conclusion: 'failure', html_url: 'smoke' }) },
    ],
    SITE,
  );
  const client = fakeClient({
    ci: [run({ conclusion: 'cancelled' }), run()],
    smoke: [run({ conclusion: 'failure', html_url: 'smoke' })],
    pages: [
      [
        pullRequest(1, 'sha-one'),
        // Already failing with the same words: no write.
        pullRequest(2, 'sha-two', {
          status: {
            state: 'FAILURE',
            description: redStatus.description,
            targetUrl: redStatus.targetUrl,
          },
        }),
      ],
      [
        pullRequest(3, 'sha-three', { labels: [FIX_LABEL] }),
        // The status read belongs to an older commit, so the head has none.
        pullRequest(4, 'sha-four', {
          commitSha: 'older',
          status: { state: 'FAILURE', description: redStatus.description, targetUrl: 'smoke' },
        }),
      ],
    ],
  });
  const waits = [];
  const logged = [];
  const result = await syncMainIsGreen({
    client,
    ...SITE,
    log: (line) => logged.push(line),
    wait: async (ms) => waits.push(ms),
  });

  assert.equal(result.verdict.state, 'failure');
  assert.deepEqual(result.written, [1, 3, 4]);
  assert.equal(client.queries.length, 2);
  assert.deepEqual(
    client.writes.map(({ path, body }) => [path, body.state, body.context]),
    [
      ['/repos/owner/repo/statuses/sha-one', 'failure', CONTEXT],
      ['/repos/owner/repo/statuses/sha-three', 'success', CONTEXT],
      ['/repos/owner/repo/statuses/sha-four', 'failure', CONTEXT],
    ],
  );
  assert.equal(client.writes[0].body.target_url, 'smoke');
  // Writes after the first are spaced to stay under GitHub's write limit.
  assert.equal(waits.length, 2);
  assert.equal(logged.at(-1), 'Wrote 3 status(es).');
});

test('the client sends the token and refuses a failed or erroring response', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/broken')) return new Response('nope', { status: 403 });
    if (url.endsWith('/graphql')) return Response.json({ errors: [{ message: 'bad' }] });
    return Response.json({ ok: true });
  };
  const client = githubClient({ token: 't0k', apiUrl: 'https://api.example', fetchImpl });
  assert.deepEqual(await client.rest('/fine'), { ok: true });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t0k');
  await assert.rejects(client.rest('/broken'), /HTTP 403/u);
  await assert.rejects(client.graphql('query {}', {}), /GraphQL/u);
});
