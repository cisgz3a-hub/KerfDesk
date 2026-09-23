import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CI_WORKFLOW_FILE,
  DEPLOY_WORKFLOW_FILE,
  gatherLaneEvidence,
  gitIsAncestor,
  githubFetchJson,
  PUBLISH_STEP_NAME,
  READINESS_ARTIFACT_PREFIX,
  RUN_WINDOW,
} from './web-deploy-lane-evidence.mjs';

const sha = (digit) => digit.repeat(40);
// Main, oldest first. `fork` branches off c2 and never reaches main.
const main = ['a', 'b', 'c', 'd', 'e'].map(sha);
const [c0, c1, c2, c3, tip] = main;
const fork = sha('f');

function isAncestor(ancestor, descendant) {
  const known = (commit) => main.includes(commit) || commit === fork;
  if (!known(ancestor) || !known(descendant)) return null;
  if (ancestor === descendant) return true;
  if (descendant === fork) return main.indexOf(ancestor) <= main.indexOf(c2);
  if (ancestor === fork) return false;
  return main.indexOf(ancestor) <= main.indexOf(descendant);
}

const published = [{ steps: [{ name: PUBLISH_STEP_NAME, conclusion: 'success' }] }];
const notPublished = [{ steps: [{ name: PUBLISH_STEP_NAME, conclusion: 'skipped' }] }];

function fakeApi({ ciRuns = [], deployRuns = [], jobs = {}, artifacts = {} } = {}) {
  const calls = [];
  const fetchJson = async (path) => {
    calls.push(path);
    if (path.startsWith(`actions/workflows/${CI_WORKFLOW_FILE}/runs?`)) {
      return { workflow_runs: ciRuns.map((head_sha) => ({ head_sha })) };
    }
    if (path.startsWith(`actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs?`)) {
      return { workflow_runs: deployRuns };
    }
    const [, runId, kind] = /^actions\/runs\/(\d+)\/(jobs|artifacts)\?/u.exec(path) ?? [];
    if (kind === 'jobs') return { jobs: jobs[runId] ?? [] };
    if (kind === 'artifacts') {
      return { artifacts: (artifacts[runId] ?? []).map((name) => ({ name })) };
    }
    throw new Error(`unexpected path ${path}`);
  };
  return { calls, fetchJson };
}

const readiness = (commit) => `${READINESS_ARTIFACT_PREFIX}${commit}`;

function gather(api, overrides = {}) {
  return gatherLaneEvidence({
    candidateSha: c1,
    currentMainSha: tip,
    currentRunId: '99',
    fetchJson: api.fetchJson,
    isAncestor,
    ...overrides,
  });
}

test('finds a newer commit on main that already passed CI, and what production serves', async () => {
  const api = fakeApi({
    ciRuns: [c3, c1, c0],
    deployRuns: [{ id: 2, conclusion: 'success' }],
    jobs: { 2: published },
    artifacts: { 2: [readiness(c0)] },
  });
  assert.deepEqual(await gather(api), {
    unavailable: null,
    candidateOnMain: true,
    newerValidatedSha: c3,
    productionSha: c0,
    productionRelation: 'older',
    productionEvidence: 'deploy run 2 published it',
  });
  assert.match(api.calls[0], /branch=main&status=success&per_page=30$/u);
});

test('its own CI, older commits, malformed SHAs and other branches never supersede it', async () => {
  const api = fakeApi({ ciRuns: [fork, c1, c1, c0, 'not-a-sha'] });
  const evidence = await gather(api);
  assert.equal(evidence.unavailable, null);
  assert.equal(evidence.newerValidatedSha, null);
});

test('reads production from the newest run whose publish step succeeded', async () => {
  const api = fakeApi({
    deployRuns: [
      { id: 99, conclusion: 'success' }, // this run
      { id: 8, conclusion: 'skipped' }, // its CI was cancelled; the job never ran
      { id: 7, conclusion: 'success' }, // an obsolete no-op
      { id: 6, conclusion: 'failure' }, // published, then its readiness upload failed
      { id: 5, conclusion: 'success' }, // an older publication
    ],
    jobs: { 7: notPublished, 6: published, 5: published },
    artifacts: { 6: [readiness(c0), readiness(c0)], 5: [readiness(sha('9'))] },
  });
  const evidence = await gather(api);
  assert.equal(evidence.productionSha, c0);
  assert.equal(evidence.productionEvidence, 'deploy run 6 published it');
  for (const runId of [99, 8, 5]) {
    assert.equal(
      api.calls.some((path) => path.startsWith(`actions/runs/${runId}/`)),
      false,
      `run ${runId} must not be consulted`,
    );
  }
});

test('a publication it cannot tie to one commit leaves production unknown', async () => {
  for (const [names, count] of [
    [[], 0],
    [[readiness(c0), readiness(c2)], 2],
  ]) {
    const api = fakeApi({
      deployRuns: [
        { id: 4, conclusion: 'success' },
        { id: 3, conclusion: 'success' },
      ],
      jobs: { 4: published, 3: published },
      artifacts: { 4: names, 3: [readiness(c0)] },
    });
    const evidence = await gather(api);
    assert.equal(evidence.productionSha, null);
    assert.equal(evidence.productionRelation, null);
    assert.equal(
      evidence.productionEvidence,
      `deploy run 4 published, but its readiness artifact names ${count} commits`,
    );
    assert.equal(api.calls.includes('actions/runs/3/jobs?filter=latest&per_page=100'), false);
  }
});

test('no publication among the recent runs leaves production unknown', async () => {
  const api = fakeApi({
    deployRuns: [{ id: 3, conclusion: 'success' }],
    jobs: { 3: notPublished },
  });
  const evidence = await gather(api);
  assert.equal(evidence.productionSha, null);
  assert.equal(
    evidence.productionEvidence,
    `none of the last ${RUN_WINDOW} completed deploy runs published`,
  );
});

test('relates production to the candidate', async () => {
  for (const [production, relation] of [
    [c0, 'older'],
    [c1, 'same'],
    [c3, 'other'],
    [fork, 'other'],
  ]) {
    const api = fakeApi({
      deployRuns: [{ id: 2, conclusion: 'success' }],
      jobs: { 2: published },
      artifacts: { 2: [readiness(production)] },
    });
    assert.equal((await gather(api)).productionRelation, relation, `production ${production[0]}`);
  }
});

test('records API failures and malformed answers as unavailable, on one line', async () => {
  const failing = {
    fetchJson: async (path) => {
      throw new Error(`GitHub API answered 403 for ${path}\nrate limited`);
    },
  };
  assert.deepEqual(await gather(failing), {
    unavailable: `GitHub API answered 403 for actions/workflows/${CI_WORKFLOW_FILE}/runs?branch=main&status=success&per_page=${RUN_WINDOW} rate limited`,
  });
  const malformed = { fetchJson: async () => ({ message: 'Not Found' }) };
  assert.deepEqual(await gather(malformed), {
    unavailable: 'GitHub API response has no workflow_runs list',
  });
});

test('reports a candidate that has left main, and one git cannot place', async () => {
  assert.equal((await gather(fakeApi(), { candidateSha: fork })).candidateOnMain, false);
  assert.match(
    (await gather(fakeApi(), { candidateSha: sha('9') })).unavailable,
    /git cannot place/u,
  );
});

// The lookup reads names this workflow writes; renaming either one would
// silently return the lane to tip-only publishing.
test('the workflows still name what the lookup reads', () => {
  const workflow = (file) =>
    readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const deploy = workflow(DEPLOY_WORKFLOW_FILE);
  assert.match(deploy, /^name: Deploy to Cloudflare Pages$/mu);
  assert.ok(deploy.includes(`      - name: ${PUBLISH_STEP_NAME}\n`));
  assert.ok(
    deploy.includes(
      `name: ${READINESS_ARTIFACT_PREFIX}\${{ steps.deployment_identity.outputs.sha }}`,
    ),
  );
  assert.ok(deploy.includes('workflows: [CI]'));
  assert.match(workflow(CI_WORKFLOW_FILE), /^name: CI$/mu);
});

test('githubFetchJson authenticates only with a token and fails on an error status', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ ok: 1 }) };
  };
  const options = { apiUrl: 'https://api.example', repository: 'owner/repo', fetchImpl };
  assert.deepEqual(await githubFetchJson({ ...options, token: 'token' })('actions/runs/1/jobs'), {
    ok: 1,
  });
  assert.equal(requests[0].url, 'https://api.example/repos/owner/repo/actions/runs/1/jobs');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer token');
  await githubFetchJson({ ...options, token: '' })('actions/runs/1/jobs');
  assert.equal('Authorization' in requests[1].init.headers, false);
  const refused = githubFetchJson({
    ...options,
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(refused('actions/runs/1/jobs'), /GitHub API answered 403 for actions/u);
});

function tempRepository() {
  const repo = mkdtempSync(join(tmpdir(), 'kerfdesk-deploy-lane-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Deploy lane test',
        '-c',
        'user.email=deploy-lane@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf8' },
    ).trim();
  git('init', '--quiet');
  git('commit', '--allow-empty', '--quiet', '-m', 'first');
  const first = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '--quiet', '-m', 'second');
  return { repo, first, second: git('rev-parse', 'HEAD') };
}

test('gitIsAncestor answers yes, no, or cannot say', () => {
  const { repo, first, second } = tempRepository();
  try {
    assert.equal(gitIsAncestor(first, second, { cwd: repo }), true);
    assert.equal(gitIsAncestor(second, first, { cwd: repo }), false);
    assert.equal(gitIsAncestor(sha('9'), second, { cwd: repo }), null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Exactly as deploy.yml runs it. A failed lookup must be recorded and warned
// about, never fail the step: main's tip still has to publish.
test('the CLI records a failing API as unavailable and still writes its evidence', async () => {
  const { repo, first, second } = tempRepository();
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(503).end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const output = join(repo, 'lane-evidence.json');
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('./web-deploy-lane-evidence.mjs', import.meta.url)),
        `--candidate-sha=${first}`,
        `--current-main-sha=${second}`,
        `--output=${output}`,
      ],
      {
        cwd: repo,
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_TOKEN: '',
          GITHUB_RUN_ID: '1',
        },
      },
    );
    const evidence = JSON.parse(readFileSync(output, 'utf8'));
    assert.match(
      evidence.unavailable,
      /^GitHub API answered 503 for actions\/workflows\/ci\.yml\/runs/u,
    );
    assert.match(
      stdout,
      /::warning title=Deploy lane evidence unavailable::GitHub API answered 503/u,
    );
    assert.equal(
      requests[0].url.startsWith('/repos/owner/repo/actions/workflows/ci.yml/runs?'),
      true,
    );
    assert.equal(requests[0].authorization, undefined);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the CLI refuses a missing output path', () => {
  const script = fileURLToPath(new URL('./web-deploy-lane-evidence.mjs', import.meta.url));
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, `--candidate-sha=${c1}`, `--current-main-sha=${tip}`],
        {
          env: { ...process.env, GITHUB_REPOSITORY: 'owner/repo' },
          stdio: 'pipe',
        },
      ),
    (error) => error.status === 1 && /--output is required/u.test(String(error.stderr)),
  );
});
