import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { listRevertedInCandidate } from './list-reverted-in-candidate.mjs';

const cli = fileURLToPath(new URL('./list-reverted-in-candidate.mjs', import.meta.url));
const identity = {
  GIT_AUTHOR_NAME: 'deploy-test',
  GIT_AUTHOR_EMAIL: 'deploy-test@example.invalid',
  GIT_COMMITTER_NAME: 'deploy-test',
  GIT_COMMITTER_EMAIL: 'deploy-test@example.invalid',
};

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'reverted-in-candidate-'));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...identity },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git(['init', '--quiet', '--initial-branch=main']);
  const commit = (file, message) => {
    writeFileSync(join(dir, file), `${message}\n`);
    git(['add', file]);
    git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  return { dir, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('lists a commit main reverted after the candidate that the candidate contains', () => {
  const repo = repository();
  try {
    const base = repo.commit('base.txt', 'base');
    const feature = repo.commit('feature.txt', 'feature');
    const candidate = repo.commit('other.txt', 'other');
    repo.git(['revert', '--no-edit', feature]);
    const main = repo.git(['rev-parse', 'HEAD']).trim();

    assert.deepEqual(listRevertedInCandidate({ git: repo.git, candidate, main }), [feature]);
    // A candidate from before the reverted commit does not contain it.
    assert.deepEqual(listRevertedInCandidate({ git: repo.git, candidate: base, main }), []);
    // The reverted commit itself is withheld too.
    assert.deepEqual(listRevertedInCandidate({ git: repo.git, candidate: feature, main }), [
      feature,
    ]);
  } finally {
    repo.cleanup();
  }
});

// A squash body lists the messages of every commit on the PR branch, so it can
// quote the trailers of reverts that landed on main long ago (29c0ebfc2 quotes
// three). Those are not new reverts and must not withhold anything.
test('ignores revert trailers quoted in a commit that is not a revert', () => {
  const repo = repository();
  try {
    const base = repo.commit('base.txt', 'base');
    const candidate = repo.commit('other.txt', 'other');
    repo.commit(
      'squash.txt',
      `fix(cnc): disclose secondary cutter shared settings (#590)\n\n* Revert "x"\n\nThis reverts commit ${base}.`,
    );
    const main = repo.git(['rev-parse', 'HEAD']).trim();

    assert.deepEqual(listRevertedInCandidate({ git: repo.git, candidate, main }), []);
  } finally {
    repo.cleanup();
  }
});

test('ignores a revert of a commit this history does not contain', () => {
  const repo = repository();
  try {
    const candidate = repo.commit('base.txt', 'base');
    repo.commit('revert.txt', `Revert "elsewhere"\n\nThis reverts commit ${'a'.repeat(40)}.`);
    const main = repo.git(['rev-parse', 'HEAD']).trim();

    assert.deepEqual(listRevertedInCandidate({ git: repo.git, candidate, main }), []);
  } finally {
    repo.cleanup();
  }
});

test('the CLI writes one reverted SHA per line for the resolver', () => {
  const repo = repository();
  try {
    repo.commit('base.txt', 'base');
    const feature = repo.commit('feature.txt', 'feature');
    repo.git(['revert', '--no-edit', feature]);
    const output = join(repo.dir, 'reverted.txt');
    execFileSync(
      process.execPath,
      [cli, `--candidate=${feature}`, '--main=HEAD', `--output=${output}`],
      { cwd: repo.dir, encoding: 'utf8' },
    );

    assert.equal(readFileSync(output, 'utf8'), `${feature}\n`);
    assert.throws(
      () => execFileSync(process.execPath, [cli, '--candidate=HEAD'], { stdio: 'pipe' }),
      /usage: --candidate/u,
    );
  } finally {
    repo.cleanup();
  }
});
