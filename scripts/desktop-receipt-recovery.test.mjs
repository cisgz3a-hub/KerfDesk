import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { digest } from './commercial-release-manifest.mjs';
import {
  REPOSITORY,
  ORIGINAL_WORKFLOW,
  RECOVERY_WORKFLOW,
  RECEIPT_STEP,
  UPLOADS,
  UPGRADE_STEP,
  recoveryRequest,
  validateRecoveryMain,
  validateOriginalAttempt,
  selectRecoveryArtifacts,
  originalReceiptContext,
  verifyArtifactBytes,
} from './desktop-receipt-recovery.mjs';
import {
  recoveryGithubReader,
  requireOriginalSigningIdentity,
} from './recover-desktop-release-receipt.mjs';

const { load } = createRequire(import.meta.url)('js-yaml');
const workflow = load(
  readFileSync(
    new URL('../.github/workflows/release-desktop-unsigned.yml', import.meta.url),
    'utf8',
  ),
);
const source = 'a'.repeat(40);
const control = 'b'.repeat(40);
const request = { runId: '12345', runAttempt: '2', sourceSha: source, version: '1.2.3' };
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: REPOSITORY + '/' + RECOVERY_WORKFLOW + '@refs/heads/main',
  GITHUB_SHA: 'c'.repeat(40),
  GITHUB_RUN_ID: '98765',
  GITHUB_RUN_ATTEMPT: '1',
  KERFDESK_UNSIGNED_RELEASES: 'on',
};
const args = Object.values(request);
const start = '2026-10-18T01:00:00Z';
const finish = '2026-10-18T01:01:00Z';
const now = Date.parse('2026-10-18T02:00:00Z');
function fixture() {
  const run = {
    id: 12345,
    run_attempt: 2,
    repository: { full_name: REPOSITORY, id: 77 },
    head_repository: { full_name: REPOSITORY, id: 77 },
    path: ORIGINAL_WORKFLOW,
    event: 'workflow_run',
    head_branch: 'main',
    head_sha: control,
    status: 'completed',
    conclusion: 'failure',
  };
  const job = (name, conclusion) => ({
    name,
    conclusion,
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: control,
    status: 'completed',
  });
  const publish = job('publish', 'failure');
  publish.steps = workflow.jobs.publish.steps
    .filter((step) => step.name)
    .map((step, index) => ({
      name: step.name,
      number: index + 1,
      status: 'completed',
      conclusion: step.name === RECEIPT_STEP ? 'failure' : 'success',
      started_at: start,
      completed_at: finish,
    }));
  const jobs = { total_count: 2, jobs: [job('qualify', 'success'), publish] };
  const original = validateOriginalAttempt(request, run, jobs);
  const names = [
    'unsigned-installer-qualification-',
    'unsigned-release-delivery-',
    'unsigned-release-',
  ];
  const artifacts = {
    total_count: 3,
    artifacts: names.map((prefix, index) => ({
      id: index + 10,
      name: prefix + '1.2.3-2',
      expired: false,
      expires_at: '2026-11-01T01:00:00Z',
      created_at: '2026-10-18T01:00:30Z',
      size_in_bytes: 3,
      digest: 'sha256:' + digest(Buffer.from('zip')),
      workflow_run: {
        id: run.id,
        head_sha: control,
        head_branch: 'main',
        repository_id: 77,
        head_repository_id: 77,
      },
    })),
  };
  return { run, jobs, publish, original, artifacts };
}

test('manual recovery separates current control from original candidate and original receipt identity', () => {
  assert.deepEqual(recoveryRequest(env, args), request);
  const f = fixture();
  assert.equal(f.original.firstRelease, false);
  assert.notEqual(f.run.head_sha, request.sourceSha);
  assert.equal(
    Object.keys(selectRecoveryArtifacts(request, f.original, f.artifacts, now)).length,
    3,
  );
  assert.deepEqual(originalReceiptContext(request), {
    repository: REPOSITORY,
    workflow: REPOSITORY + '/' + ORIGINAL_WORKFLOW + '@refs/heads/main',
    sourceSha: source,
    runId: '12345',
    runAttempt: '2',
  });
});

for (const [key, value] of Object.entries({
  GITHUB_ACTIONS: 'false',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_REPOSITORY: 'fork/KerfDesk',
  GITHUB_REF: 'refs/heads/feature',
  GITHUB_WORKFLOW_REF: 'other',
  KERFDESK_UNSIGNED_RELEASES: 'off',
  GITHUB_SHA: 'main',
  GITHUB_RUN_ID: request.runId,
  GITHUB_RUN_ATTEMPT: '0',
}))
  test('refuses untrusted recovery context ' + key, () =>
    assert.throws(() => recoveryRequest({ ...env, [key]: value }, args)),
  );
for (const invalid of [
  [],
  [...args, 'extra'],
  ['1e3', '2', source, '1.2.3'],
  ['12345', '0', source, '1.2.3'],
  ['12345', '2', 'main', '1.2.3'],
  ['12345', '2', source, '1.2.3-beta'],
])
  test('refuses malformed reviewed inputs ' + JSON.stringify(invalid), () =>
    assert.throws(() => recoveryRequest(env, invalid)),
  );

const runMutations = [
  ['other run', (f) => f.run.id++],
  ['other attempt', (f) => f.run.run_attempt++],
  ['fork', (f) => (f.run.head_repository.full_name = 'fork/KerfDesk')],
  ['repository mismatch', (f) => f.run.head_repository.id++],
  ['other workflow', (f) => (f.run.path = RECOVERY_WORKFLOW)],
  ['other event', (f) => (f.run.event = 'pull_request')],
  ['branch', (f) => (f.run.head_branch = 'feature')],
  ['cancelled run', (f) => (f.run.conclusion = 'cancelled')],
  ['jobs pagination', (f) => f.jobs.total_count++],
  ['wrong job attempt', (f) => f.publish.run_attempt++],
  ['source job failed', (f) => (f.jobs.jobs[0].conclusion = 'failure')],
  [
    'missing receipt',
    (f) => (f.publish.steps = f.publish.steps.filter((step) => step.name !== RECEIPT_STEP)),
  ],
  [
    'receipt passed',
    (f) => (f.publish.steps.find((step) => step.name === RECEIPT_STEP).conclusion = 'success'),
  ],
  ['duplicate steps', (f) => f.publish.steps.push(f.publish.steps[0])],
];
for (const [label, mutate] of runMutations)
  test('refuses original provenance: ' + label, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateOriginalAttempt(request, f.run, f.jobs));
  });
for (const name of [
  ...Object.values(UPLOADS),
  UPGRADE_STEP,
  'Require current packaged-runtime advisory evidence',
  'Install, launch and uninstall the production Windows candidate',
  'Verify packaged security and refuse a modified application archive',
  'Publish immutable installer, verified history and notification manifest',
  'Verify customer delivery through the public CDN and download page',
])
  test('refuses failed original required evidence: ' + name, () => {
    const f = fixture();
    f.publish.steps.find((step) => step.name === name).conclusion = 'failure';
    assert.throws(() => validateOriginalAttempt(request, f.run, f.jobs));
  });

test('first-release mode comes only from the original skipped upgrade step', () => {
  const f = fixture();
  f.publish.steps.find((step) => step.name === UPGRADE_STEP).conclusion = 'skipped';
  assert.equal(validateOriginalAttempt(request, f.run, f.jobs).firstRelease, true);
});
const artifactMutations = [
  ['wrong attempt name', (a) => (a.name = a.name.slice(0, -1) + '1')],
  ['expired', (a) => (a.expired = true)],
  ['past expiry', (a) => (a.expires_at = start)],
  ['missing digest', (a) => delete a.digest],
  ['wrong run', (a) => a.workflow_run.id++],
  ['other control SHA', (a) => (a.workflow_run.head_sha = source)],
  ['other repository', (a) => a.workflow_run.repository_id++],
  ['other head repository', (a) => a.workflow_run.head_repository_id++],
  ['outside original upload', (a) => (a.created_at = '2026-10-18T01:02:00Z')],
  ['bad size', (a) => (a.size_in_bytes = 600_000_001)],
];
for (const [label, mutate] of artifactMutations)
  test('refuses artifact provenance: ' + label, () => {
    const f = fixture();
    mutate(f.artifacts.artifacts[0]);
    assert.throws(() => selectRecoveryArtifacts(request, f.original, f.artifacts, now));
  });
test('refuses incomplete or ambiguous artifact listing', () => {
  const f = fixture();
  f.artifacts.total_count++;
  assert.throws(() => selectRecoveryArtifacts(request, f.original, f.artifacts, now));
  f.artifacts.artifacts.push(f.artifacts.artifacts[0]);
  assert.throws(() => selectRecoveryArtifacts(request, f.original, f.artifacts, now));
});
test('archive authentication rejects changed bytes and wrong sizes before parsing', () => {
  const a = fixture().artifacts.artifacts[0];
  assert.equal(verifyArtifactBytes(a, Buffer.from('zip')).toString(), 'zip');
  for (const bytes of [Buffer.from('bad'), Buffer.from('zip!')])
    assert.throws(() => verifyArtifactBytes(a, bytes));
});
test('GitHub artifact download never forwards the API token to storage', async () => {
  const calls = [];
  const reader = recoveryGithubReader('private-token', async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              'https://productionresultssa1.blob.core.windows.net/evidence?temporary=private',
          },
        })
      : new Response('zip');
  });
  await reader.archive(fixture().artifacts.artifacts[0]);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer private-token');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[1].init.headers, undefined);
  assert.equal(calls[1].init.redirect, 'error');
});
for (const location of [
  'http://productionresultssa1.blob.core.windows.net/a',
  'https://evil.example/a',
  'https://user:password@productionresultssa1.blob.core.windows.net/a',
])
  test('refuses unsafe archive redirect ' + location, async () => {
    const reader = recoveryGithubReader(
      'private-token',
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    await assert.rejects(reader.archive(fixture().artifacts.artifacts[0]));
  });
test('API failures, incomplete JSON and archive corruption fail closed', async () => {
  for (const response of [new Response('no', { status: 403 }), new Response('{')]) {
    const reader = recoveryGithubReader('private-token', async () => response);
    await assert.rejects(reader.json('/actions/runs/12345'));
  }
  const reader = recoveryGithubReader('private-token', async () => new Response('zip'));
  await assert.rejects(reader.archive(fixture().artifacts.artifacts[0]));
});

test('requires the original signing key identity even when another key is configured', () => {
  requireOriginalSigningIdentity(
    {
      DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: 'private-key',
      DESKTOP_STABLE_MANIFEST_KEY_ID: 'original',
    },
    { keyId: 'original' },
  );
  assert.throws(() =>
    requireOriginalSigningIdentity(
      {
        DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: 'private-key',
        DESKTOP_STABLE_MANIFEST_KEY_ID: 'rotated-key',
      },
      { keyId: 'original' },
    ),
  );
  assert.throws(() =>
    requireOriginalSigningIdentity(
      { DESKTOP_STABLE_MANIFEST_KEY_ID: 'original' },
      { keyId: 'original' },
    ),
  );
});

test('private-repository main freshness is authenticated without persisted Git credentials', async () => {
  const reader = recoveryGithubReader('private-token', async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/repos/' + REPOSITORY + '/git/ref/heads/main');
    assert.equal(init.headers.Authorization, 'Bearer private-token');
    return new Response(
      JSON.stringify({ ref: 'refs/heads/main', object: { type: 'commit', sha: env.GITHUB_SHA } }),
    );
  });
  validateRecoveryMain(env.GITHUB_SHA, await reader.json('/git/ref/heads/main'));
  for (const ref of [
    null,
    { ref: 'refs/heads/feature', object: { type: 'commit', sha: env.GITHUB_SHA } },
    { ref: 'refs/heads/main', object: { type: 'tag', sha: env.GITHUB_SHA } },
    { ref: 'refs/heads/main', object: { type: 'commit', sha: control } },
  ])
    assert.throws(() => validateRecoveryMain(env.GITHUB_SHA, ref));
});
