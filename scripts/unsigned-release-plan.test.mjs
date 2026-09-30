import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPatch, successfulPush } from './unsigned-release-plan.mjs';
import { ReleaseRateLimitError } from './stable-release-store.mjs';

const sourceSha = 'a'.repeat(40);
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
