import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import {
  commitsSinceRelease,
  mergedPullRequestsSince,
  nextPatch,
  releaseBatchDecision,
  releaseNowRequested,
  successfulPush,
} from './unsigned-release-plan.mjs';
import { ReleaseRateLimitError } from './stable-release-store.mjs';

const sourceSha = 'a'.repeat(40);

test('release planning boots before dependencies are installed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-release-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'public']) {
    await mkdir(join(root, directory));
    const source = new URL(`../${directory}/`, import.meta.url);
    for (const name of await readdir(source))
      if (name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
        await copyFile(new URL(name, source), join(root, directory, name));
  }
  const loader = join(root, 'no-packages.mjs');
  await writeFile(
    loader,
    `export async function resolve(name, context, next) {
    if (!name.startsWith('node:') && !name.startsWith('.') && !name.startsWith('file:'))
      throw new Error('Bootstrap requires an installed package: ' + name);
    return next(name, context);
  }`,
  );
  const entry = pathToFileURL(join(root, 'scripts/unsigned-release-plan.mjs')).href;
  const result = execFileSync(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-loader',
      pathToFileURL(loader).href,
      '--input-type=module',
      '--eval',
      `globalThis.fetch = () => { throw new Error('Unexpected bootstrap network call'); };
     const planner = await import(${JSON.stringify(entry)});
     if (planner.RELEASE_PR_THRESHOLD !== 20) throw new Error('Missing release policy');
     console.log('BOOTSTRAP_OK');`,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 },
  );
  assert.equal(result.trim(), 'BOOTSTRAP_OK');
});

const run = {
  id: 1,
  head_sha: sourceSha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: 'cisgz3a-hub/KerfDesk' },
  head_repository: { full_name: 'cisgz3a-hub/KerfDesk' },
};

test('release qualification rejects PRs, forks, wrong workflows, branches and commits', () => {
  assert.equal(successfulPush([run], sourceSha, 'ci.yml'), true);
  for (const change of [
    { event: 'pull_request' },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'other' },
    { path: '.github/workflows/other.yml' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { head_repository: { full_name: 'someone/KerfDesk' } },
    { repository: { full_name: 'someone/KerfDesk' } },
  ])
    assert.equal(successfulPush([{ ...run, ...change }], sourceSha, 'ci.yml'), false);
});

test('a later failed or pending run cannot borrow an older successful result', () => {
  for (const change of [{ status: 'in_progress', conclusion: null }, { conclusion: 'failure' }]) {
    assert.equal(successfulPush([run, { ...run, id: 2, ...change }], sourceSha, 'ci.yml'), false);
    assert.equal(successfulPush([{ ...run, id: 2, ...change }, run], sourceSha, 'ci.yml'), false);
  }
});

test('automatic versions advance without accepting prereleases or Windows overflow', () => {
  assert.equal(nextPatch('1.0.0'), '1.0.1');
  assert.equal(nextPatch('1.99.9'), '1.99.10');
  for (const version of ['1.0.1-beta', '01.0.1', '1.0.65535', '999999999999999999.0.0'])
    assert.throws(() => nextPatch(version));
});

test('rate-limit retries honour seconds and HTTP dates without retrying the pointer write', () => {
  assert.equal(new ReleaseRateLimitError('255').retryAfterMs, 255_000);
  const now = Date.parse('2026-09-30T11:00:00Z');
  assert.equal(
    new ReleaseRateLimitError('Wed, 30 Sep 2026 11:05:00 GMT', now).retryAfterMs,
    300_000,
  );
  assert.equal(new ReleaseRateLimitError(null).retryAfterMs, 300_000);
  assert.equal(new ReleaseRateLimitError('0').retryAfterMs, 60_000);
  assert.equal(new ReleaseRateLimitError('900').retryAfterMs, 900_000);
});

const hash = (number) => number.toString(16).padStart(40, '0');
const pull = (number, changes = {}) => ({
  number,
  state: 'closed',
  merged_at: '2026-09-30T10:00:00Z',
  merge_commit_sha: hash(number),
  base: { ref: 'main', repo: { full_name: 'cisgz3a-hub/KerfDesk' } },
  ...changes,
});
const page = (body, options) => new Response(JSON.stringify(body), options);

test('automatic releases wait for 20 PRs, while only explicit manual release-now bypasses the batch', () => {
  const nineteen = Array.from({ length: 19 }, (_, n) => n + 1);
  assert.equal(releaseBatchDecision(true, nineteen, false).publish, false);
  assert.equal(releaseBatchDecision(true, [...nineteen, 20], false).publish, true);
  assert.equal(releaseBatchDecision(true, nineteen, true).publish, true);
  assert.equal(releaseBatchDecision(true, [], true).publish, true);
  assert.equal(releaseBatchDecision(false, [...nineteen, 20], false).publish, false);
  assert.equal(releaseBatchDecision(false, [], true).publish, true);
  const dispatch = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' };
  assert.equal(releaseNowRequested(dispatch), false);
  assert.equal(releaseNowRequested({ ...dispatch, KERFDESK_RELEASE_NOW: 'false' }), false);
  assert.equal(releaseNowRequested({ ...dispatch, KERFDESK_RELEASE_NOW: 'true' }), true);
  for (const env of [
    { ...dispatch, KERFDESK_RELEASE_NOW: 'yes' },
    { ...dispatch, GITHUB_EVENT_NAME: 'workflow_run', KERFDESK_RELEASE_NOW: 'true' },
    { ...dispatch, GITHUB_REF: 'refs/heads/feature', KERFDESK_RELEASE_NOW: 'true' },
  ])
    assert.throws(() => releaseNowRequested(env));
});

test('PR count excludes open, closed-unmerged, other-base and absent-source PRs without a date cutoff', async () => {
  const records = [
    pull(1, { state: 'open', merged_at: null }),
    pull(2, { merged_at: null }),
    pull(3, { base: { ref: 'feature', repo: { full_name: 'cisgz3a-hub/KerfDesk' } } }),
    pull(4),
    // Merged before publication, but not included in that published source.
    pull(5, { merged_at: '2020-01-01T00:00:00Z' }),
    pull(6),
  ];
  assert.deepEqual(
    await mergedPullRequestsSince(
      new Set([hash(1), hash(2), hash(3), hash(5), hash(6)]),
      'token',
      async () => page(records),
    ),
    [5, 6],
  );
});

test('batch count follows all pages and counts PRs, not their commit count', async () => {
  const calls = [];
  const result = await mergedPullRequestsSince(
    new Set([hash(101)]),
    'private-token',
    async (url, options) => {
      calls.push(url);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(url.searchParams.get('state'), 'all');
      assert.equal(url.searchParams.get('sort'), 'created');
      assert.equal(url.searchParams.get('direction'), 'asc');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-token');
      assert.ok(options.signal instanceof AbortSignal);
      return page(
        calls.length === 1 ? Array.from({ length: 100 }, (_, n) => pull(n + 1)) : [pull(101)],
      );
    },
  );
  assert.deepEqual(result, [101]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('page'), '2');
});

test('API errors, malformed records, interrupted pagination and duplicates never become a partial count', async () => {
  const commits = new Set([hash(1)]);
  for (const status of [403, 404, 429, 500])
    await assert.rejects(
      mergedPullRequestsSince(commits, 'token', async () => page({}, { status })),
    );
  for (const body of [
    null,
    {},
    [null],
    [pull(1), pull(1)],
    [pull(1, { merged_at: undefined })],
    [pull(1, { merge_commit_sha: null })],
    [pull(1, { state: 'open' })],
    [pull(1, { base: { ref: 'main', repo: { full_name: 'another/repository' } } })],
  ])
    await assert.rejects(mergedPullRequestsSince(commits, 'token', async () => page(body)));
  await assert.rejects(
    mergedPullRequestsSince(commits, '', async () => assert.fail('must not fetch')),
  );
  await assert.rejects(
    mergedPullRequestsSince(commits, 'token', async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    }),
  );
  await assert.rejects(
    mergedPullRequestsSince(commits, 'token', async () =>
      page([pull(1)], { headers: { link: '<https://example.invalid>; rel="next"' } }),
    ),
  );
  let requests = 0;
  await assert.rejects(
    mergedPullRequestsSince(commits, 'token', async () => {
      requests += 1;
      return requests === 1
        ? page(Array.from({ length: 100 }, (_, n) => pull(n + 1)))
        : page({ error: 'rate limit' }, { status: 429 });
    }),
  );
  assert.equal(requests, 2);
});

test('pagination limit refuses incomplete evidence even when the threshold was already reached', async () => {
  let requests = 0;
  await assert.rejects(
    mergedPullRequestsSince(new Set([hash(1)]), 'token', async () => {
      const offset = requests++ * 100;
      return page(Array.from({ length: 100 }, (_, n) => pull(offset + n + 1)));
    }),
    /exceeds 100 pages/u,
  );
  assert.equal(requests, 100);
});

test('real merge, squash and rebase histories each count once beyond the authenticated baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-release-batch-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  let revision = 0;
  const commit = async () => {
    await writeFile(join(root, `file-${revision++}.txt`), 'fixture');
    git('add', '.');
    git('commit', '-m', 'Fixture commit');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Release batch fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    const baseline = await commit();
    git('checkout', '-b', 'merge-feature');
    await commit();
    await commit();
    git('checkout', 'main');
    git('merge', '--no-ff', '-m', 'Merge fixture', 'merge-feature');
    const merge = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'squash-feature');
    await commit();
    await commit();
    git('checkout', 'main');
    git('merge', '--squash', 'squash-feature');
    git('commit', '-m', 'Squash fixture');
    const squash = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'rebase-feature');
    await commit();
    await commit();
    git('checkout', 'main');
    await commit();
    git('checkout', 'rebase-feature');
    git('rebase', 'main');
    git('checkout', 'main');
    git('merge', '--ff-only', 'rebase-feature');
    const rebase = git('rev-parse', 'HEAD');
    const direct = await commit();
    git('checkout', '-b', 'unmerged-feature');
    const absent = await commit();
    git('checkout', 'main');
    const commits = commitsSinceRelease(baseline, direct, git);
    assert.ok(commits.size > 3);
    assert.equal(commits.has(baseline), false);
    assert.equal(commits.has(absent), false);
    const records = [baseline, merge, squash, rebase, absent].map((sha, n) =>
      pull(n + 1, { merge_commit_sha: sha }),
    );
    assert.deepEqual(
      await mergedPullRequestsSince(commits, 'token', async () => page(records)),
      [2, 3, 4],
    );
    assert.throws(() => commitsSinceRelease(absent, direct, git));
    assert.throws(() => commitsSinceRelease('not-a-sha', direct, git));
    assert.deepEqual([...commitsSinceRelease(direct, direct, git)], []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workflow applies the same batch policy before Windows and rechecks before building', async () => {
  const workflow = load(
    await readFile(
      new URL('../.github/workflows/release-desktop-unsigned.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.release_now, {
    description: 'Release now before 20 merged PRs (all checks and trust guards still apply)',
    type: 'boolean',
    default: false,
  });
  assert.equal(workflow.permissions['pull-requests'], 'read');
  assert.equal(workflow.jobs.qualify['runs-on'], 'ubuntu-latest');
  assert.equal(workflow.jobs.publish.if, "needs.qualify.outputs.eligible == 'true'");
  for (const [job, id] of [
    ['qualify', 'gate'],
    ['publish', 'plan'],
  ]) {
    const step = workflow.jobs[job].steps.find((step) => step.id === id);
    assert.equal(step.env.GITHUB_TOKEN, '${{ github.token }}');
    assert.equal(
      step.env.KERFDESK_RELEASE_NOW,
      "${{ github.event_name == 'workflow_dispatch' && inputs.release_now }}",
    );
    assert.ok(step.run.includes(`node scripts/unsigned-release-plan.mjs ${id}`));
  }
  const gateSource = await readFile(
    new URL('./unsigned-release-plan.mjs', import.meta.url),
    'utf8',
  );
  for (const name of ['ci.yml', 'e2e.yml', 'desktop-package-check.yml'])
    assert.ok(gateSource.includes(name));
  assert.ok(gateSource.includes("verifyManualDownload(bytes.toString('utf8'), keys)"));
  const steps = workflow.jobs.publish.steps;
  const securityIndex = steps.findIndex((step) =>
    step.run?.includes('verify-asar-integrity-enforced.mjs'),
  );
  assert.ok(
    securityIndex > steps.findIndex((step) => step.run?.includes('qualify-windows-installer.ps1')),
  );
  assert.ok(
    securityIndex <
      steps.findIndex((step) => step.run?.includes('publish-manual-commercial-release.mjs')),
  );
  assert.ok(
    steps[securityIndex].run.includes(
      'verify-packaged-desktop.mjs $executable $archive electron-builder.yml',
    ),
  );
  assert.ok(steps[securityIndex].run.includes('if ($before -ne $after)'));
  assert.ok(steps[securityIndex].run.includes('if ($integrityExit -ne 0)'));
});
