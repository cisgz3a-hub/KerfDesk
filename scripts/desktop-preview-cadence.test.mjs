import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  completedPreviewReleases,
  fetchCompletedPreviewReleases,
} from './filter-completed-previews.mjs';
import {
  cadenceIssue,
  newestGreenCommit,
  nextPreviewTag,
  nextUnusedPreviewTag,
  previewDue,
  publishedPreviews,
} from './desktop-preview-cadence.mjs';

test('names the next Preview tag after the newest one', () => {
  assert.equal(nextPreviewTag('v0.2.0-preview.13'), 'v0.2.0-preview.14');
  assert.equal(nextPreviewTag('v1.0.0-preview.9'), 'v1.0.0-preview.10');
  assert.throws(() => nextPreviewTag('v0.1.1'), /not a Preview tag/);
  assert.equal(
    nextPreviewTag('v1.0.0-preview.9007199254740992'),
    'v1.0.0-preview.9007199254740993',
  );
});

test('reserves failed or pending tags when proposing the next unused Preview', () => {
  assert.equal(
    nextUnusedPreviewTag('v0.2.0-preview.13', ['v0.2.0-preview.14', 'v0.2.0-preview.16']),
    'v0.2.0-preview.17',
  );
  assert.equal(
    nextUnusedPreviewTag('v0.2.0-preview.13', ['v0.3.0-preview.1', 'not-a-tag']),
    'v0.3.0-preview.2',
  );
});

const RELEASE_13 = {
  tagName: 'v0.2.0-preview.13',
  publishedAt: '2026-07-23T09:37:17Z',
  isDraft: false,
  isPrerelease: true,
  immutable: true,
};

test('failed public distribution cannot turn an immutable source archive into a shipped baseline', () => {
  const release14 = { ...RELEASE_13, tagName: 'v0.2.0-preview.14' };
  const green = {
    head_branch: RELEASE_13.tagName,
    head_sha: 'a'.repeat(40),
    path: '.github/workflows/release-desktop-preview.yml',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-07-23T10:00:00Z',
  };
  assert.deepEqual(
    completedPreviewReleases(
      [RELEASE_13, release14],
      [
        {
          workflow_runs: [
            green,
            { ...green, head_branch: release14.tagName, conclusion: 'failure' },
          ],
        },
      ],
    ),
    [RELEASE_13],
  );
  for (const bad of [
    { ...green, status: 'in_progress' },
    { ...green, event: 'workflow_dispatch' },
    { ...green, path: '.github/workflows/another.yml' },
    { ...green, updated_at: '2026-07-23T09:00:00Z' },
    { ...green, head_sha: 'bad' },
  ])
    assert.deepEqual(completedPreviewReleases([RELEASE_13], [{ workflow_runs: [bad] }]), []);
  assert.throws(() => completedPreviewReleases([RELEASE_13], [{}]), /workflow metadata/u);
});

test('completed-history fetch uses supported paginated gh commands and surfaces authentication failure', () => {
  const calls = [];
  const run = (executable, args) => {
    calls.push([executable, args]);
    return JSON.stringify(
      args.at(-1).includes('/actions/') ? [{ workflow_runs: [] }] : [[RELEASE_13]],
    );
  };
  assert.deepEqual(fetchCompletedPreviewReleases(run), []);
  assert.equal(calls.length, 2);
  for (const [command, args] of calls) {
    assert.equal(command, 'gh');
    assert.deepEqual(args.slice(0, 3), ['api', '--paginate', '--slurp']);
    assert.equal(args.includes('--jq'), false);
  }
  assert.throws(
    () =>
      fetchCompletedPreviewReleases(() => {
        throw new Error('401');
      }),
    /401/u,
  );
});

test('only published immutable Preview releases can anchor the reminder', () => {
  assert.deepEqual(
    publishedPreviews([
      RELEASE_13,
      { ...RELEASE_13, tagName: 'v0.2.0-preview.14', isDraft: true },
      { ...RELEASE_13, tagName: 'v0.2.0-preview.15', immutable: false },
      { ...RELEASE_13, tagName: 'v0.2.0-preview.16', publishedAt: null },
      { ...RELEASE_13, tagName: 'v0.2.0', isPrerelease: false },
    ]),
    [RELEASE_13],
  );
});

test('picks the newest main commit every workflow passed on', () => {
  const main = ['e', 'd', 'c', 'b', 'a'];
  assert.equal(newestGreenCommit(main, [new Set(['d', 'c', 'a']), new Set(['c', 'b', 'a'])]), 'c');
  assert.equal(newestGreenCommit(main, [new Set(['e']), new Set(['d'])]), null);
});

test('consumes raw paginated gh --slurp output, including empty and draft-only pages', () => {
  assert.deepEqual(
    publishedPreviews([
      [
        {
          tag_name: RELEASE_13.tagName,
          published_at: RELEASE_13.publishedAt,
          draft: false,
          prerelease: true,
          immutable: true,
        },
      ],
      [{ ...RELEASE_13, tagName: 'v0.2.0-preview.14', isDraft: true }],
      [],
    ]),
    [RELEASE_13],
  );
});

test('a Preview is due a week after the last one when main has user-facing changes', () => {
  const lastPreviewAt = new Date('2026-09-20T10:00:00Z');
  assert.deepEqual(
    previewDue({ userFacingChanges: 3, lastPreviewAt, now: new Date('2026-09-27T10:00:00Z') }),
    { due: true, days: 7 },
  );
  assert.equal(
    previewDue({ userFacingChanges: 3, lastPreviewAt, now: new Date('2026-09-26T10:00:00Z') }).due,
    false,
  );
  assert.equal(
    previewDue({ userFacingChanges: 0, lastPreviewAt, now: new Date('2026-12-01T00:00:00Z') }).due,
    false,
  );
});

test('the issue gives the exact annotated tag for the green commit and the notes', () => {
  const commit = 'a'.repeat(40);
  const body = cadenceIssue({
    lastTag: 'v0.2.0-preview.13',
    days: 66,
    nextTag: 'v0.2.0-preview.14',
    commit,
    userFacingChanges: 492,
    notes: '### Fixed\n\n- **Laser:** Fans stay on',
  });
  assert.match(body, /v0\.2\.0-preview\.13, is 66 days old/);
  assert.match(body, /492 user-facing changes/);
  assert.ok(
    body.includes(`git tag -a v0.2.0-preview.14 -m "KerfDesk v0.2.0 Preview 14" ${commit}`),
  );
  assert.ok(body.includes('git push origin v0.2.0-preview.14'));
  assert.ok(body.includes('stamp 0.2.0-preview.14'));
  assert.ok(body.includes('- **Laser:** Fans stay on'));
  assert.ok(
    body.includes('node scripts/filter-completed-previews.mjs --fetch preview-releases.json'),
  );
});

const SCRIPT = fileURLToPath(new URL('./desktop-preview-cadence.mjs', import.meta.url));

function repositoryFixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'kerfdesk-cadence-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-07-23T08:00:00Z',
        GIT_COMMITTER_DATE: '2026-07-23T08:00:00Z',
      },
    }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Cadence test');
  git('config', 'user.email', 'cadence@example.invalid');
  let count = 0;
  const commit = (title) => {
    writeFileSync(join(root, 'fixture.txt'), String(count++));
    git('add', 'fixture.txt');
    git('commit', '-m', title);
    return git('rev-parse', 'HEAD');
  };
  commit('feat: published Preview feature (#1)');
  git('tag', '-a', RELEASE_13.tagName, '-m', 'Preview 13');
  commit('fix: retained change from failed preview (#2)');
  git('tag', '-a', 'v0.2.0-preview.14', '-m', 'Unpublished Preview 14');
  const head = commit('feat: newest candidate change (#3)');
  const green = join(root, 'green.txt');
  writeFileSync(green, `${head}\n`);
  return {
    run(releases) {
      const metadata = join(root, 'releases.json');
      const issue = join(root, 'issue.md');
      const output = join(root, 'output.txt');
      writeFileSync(metadata, JSON.stringify(releases));
      const result = spawnSync(
        process.execPath,
        [
          SCRIPT,
          `--releases=${metadata}`,
          `--green=${green}`,
          `--issue=${issue}`,
          `--github-output=${output}`,
          '--now=2026-09-28T10:00:00Z',
        ],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      assert.ifError(result.error);
      return {
        ...result,
        issue: () => readFileSync(issue, 'utf8'),
        output: () => readFileSync(output, 'utf8'),
      };
    },
  };
}

test('an unpublished tag cannot close the reminder or hide its unshipped changes', (context) => {
  const fixture = repositoryFixture(context);
  const result = fixture.run([
    [RELEASE_13, { ...RELEASE_13, tagName: 'v0.2.0-preview.14', isDraft: true }],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output(), /last_tag=v0\.2\.0-preview\.13/);
  assert.match(result.output(), /next_tag=v0\.2\.0-preview\.15/);
  assert.match(result.output(), /due=true/);
  assert.match(result.issue(), /Retained change from failed preview/);
  assert.match(result.issue(), /Newest candidate change/);
  assert.match(
    result.issue(),
    /without a completed public Preview release: `v0\.2\.0-preview\.14`/,
  );
  assert.match(result.issue(), /Wait for an active run, or investigate a failed run/);
  assert.match(result.issue(), /git tag -a v0\.2\.0-preview\.15/);
});

test('a recent publication resets cadence even when its source commit has a different date', (context) => {
  const result = repositoryFixture(context).run([
    { ...RELEASE_13, publishedAt: '2026-09-27T10:00:00Z' },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output(), /due=false/);
  assert.match(result.issue(), /1 days old/);
});

test('no published release fails clearly instead of treating a bare tag as shipped', (context) => {
  const result = repositoryFixture(context).run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no published immutable Preview release/);
});
