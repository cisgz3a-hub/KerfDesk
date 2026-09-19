import assert from 'node:assert/strict';
import test from 'node:test';
import { validContext } from './stable-release-test-support.mjs';
import { planStableReleaseRetry } from './stable-release-retry.mjs';

const originalArtifact = () => ({
  id: 321,
  name: 'kerfdesk-windows-1.2.3',
  expired: false,
  workflow_run: { id: 900, head_sha: 'a'.repeat(40) },
});
const artifactList = (...artifacts) => ({ total_count: artifacts.length, artifacts });
const previousJobs = (upload = 'skipped', publish = 'skipped') => ({
  total_count: 1,
  jobs: [
    {
      name: 'Build Windows installer',
      run_id: 900,
      head_sha: 'a'.repeat(40),
      status: 'completed',
      conclusion: 'failure',
      steps: [
        { name: 'Upload installer + update feed as workflow artifact', conclusion: upload },
        { name: 'Publish installer + update feed to Cloudflare R2', conclusion: publish },
      ],
    },
  ],
});

async function retryPlan(responses, overrides = {}) {
  const calls = [];
  const plan = await planStableReleaseRetry({
    version: '1.2.3',
    env: {
      ...validContext(),
      GITHUB_RUN_ID: '900',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_TOKEN: 'fixture',
      ...overrides,
    },
    fetchRequest: async (url, init) => {
      calls.push({ url, init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.notEqual(response, undefined, 'unexpected retry API request');
      return response instanceof Response ? response : Response.json(response);
    },
  });
  return { plan, calls };
}

test('first release attempt builds without a retry lookup', async () => {
  const { plan, calls } = await retryPlan([], { GITHUB_RUN_ATTEMPT: '1' });
  assert.deepEqual(plan, { reuseArtifact: false });
  assert.equal(calls.length, 0);
});

test('a same-run retry restores only the original nonexpired artifact for the approved source', async () => {
  const { plan, calls } = await retryPlan([artifactList(originalArtifact())]);
  assert.deepEqual(plan, { reuseArtifact: true, artifactId: 321 });
  assert.ok(calls[0].url.endsWith('/actions/runs/900/artifacts?per_page=100'));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer fixture');
  assert.equal(calls[0].init.redirect, 'error');
});

test('artifact expiry, wrong source/run, ambiguous identity and incomplete lookup fail closed', async () => {
  const original = originalArtifact();
  for (const listing of [
    artifactList({ ...original, expired: true }),
    artifactList({ ...original, workflow_run: { id: 901, head_sha: 'a'.repeat(40) } }),
    artifactList({ ...original, workflow_run: { id: 900, head_sha: 'b'.repeat(40) } }),
    artifactList(original, original),
    { total_count: 101, artifacts: [] },
  ])
    await assert.rejects(retryPlan([listing]));
});

test('a missing artifact after any previous successful upload never triggers a rebuild', async () => {
  for (const upload of ['success', 'skipped']) {
    await assert.rejects(
      retryPlan([artifactList(), previousJobs(upload, 'failure')], { GITHUB_RUN_ATTEMPT: '3' }),
      /Original stable artifact is missing/u,
    );
  }
  await assert.rejects(
    retryPlan([artifactList(), previousJobs('success')]),
    /Original stable artifact is missing/u,
  );
});

test('a failed build before upload can rebuild only after every prior attempt is checked', async () => {
  const { plan, calls } = await retryPlan(
    [artifactList(), previousJobs('skipped'), previousJobs('failure')],
    { GITHUB_RUN_ATTEMPT: '3' },
  );
  assert.deepEqual(plan, { reuseArtifact: false });
  assert.ok(calls[1].url.endsWith('/attempts/1/jobs?per_page=100'));
  assert.ok(calls[2].url.endsWith('/attempts/2/jobs?per_page=100'));
});

test('a build skipped by failed tag validation can start on the next attempt', async () => {
  for (const steps of [undefined, []]) {
    const previous = previousJobs();
    previous.jobs[0].conclusion = 'skipped';
    previous.jobs[0].steps = steps;
    previous.jobs.unshift({
      name: 'Validate stable release tag',
      run_id: 900,
      head_sha: 'a'.repeat(40),
      status: 'completed',
      conclusion: 'failure',
      steps: [],
    });
    previous.total_count = previous.jobs.length;
    const { plan } = await retryPlan([artifactList(), previous]);
    assert.deepEqual(plan, { reuseArtifact: false });
  }
});

test('skipped-job recovery cannot excuse executed uploads or a cancelled job with no steps', async () => {
  const uploaded = previousJobs('success');
  uploaded.jobs[0].conclusion = 'skipped';
  await assert.rejects(retryPlan([artifactList(), uploaded]), /Original stable artifact/u);
  const cancelled = previousJobs();
  cancelled.jobs[0].conclusion = 'cancelled';
  cancelled.jobs[0].steps = [];
  await assert.rejects(retryPlan([artifactList(), cancelled]), /Cannot prove/u);
});

test('retry lookup and job-history errors never become permission to rebuild', async () => {
  for (const status of [401, 404, 429, 500]) {
    await assert.rejects(retryPlan([new Response('failure', { status })]), /lookup failed/u);
    await assert.rejects(
      retryPlan([artifactList(), new Response('failure', { status })]),
      /lookup failed/u,
    );
  }
  await assert.rejects(retryPlan([new Error('network failure')]), /network failure/u);
  await assert.rejects(retryPlan([artifactList(), { total_count: 0, jobs: [] }]), /unconfirmed/u);
  const unknown = previousJobs();
  unknown.jobs[0].steps = [];
  await assert.rejects(retryPlan([artifactList(), unknown]), /Cannot prove/u);
});
