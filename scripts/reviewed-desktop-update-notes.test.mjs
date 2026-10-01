import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  readReviewedDesktopUpdateNotes,
  REVIEWED_NOTES_PATH,
} from './reviewed-desktop-update-notes.mjs';
import { requireNotesBaseline, validateReviewedNotes } from './manual-commercial-notes.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-notes-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) =>
    (
      await promisify(execFile)(
        'git',
        [
          '-c',
          'user.name=Notes fixture',
          '-c',
          'user.email=notes@fixture.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          `core.hooksPath=${join(root, 'no-hooks')}`,
          ...args,
        ],
        { cwd: root, windowsHide: true, encoding: 'utf8' },
      )
    ).stdout.trim();
  await git('init', '--quiet');
  await git('commit', '--allow-empty', '--quiet', '-m', 'Fixture baseline');
  const baseline = await git('rev-parse', 'HEAD');
  await mkdir(join(root, 'docs/releases'), { recursive: true });
  const commitNotes = async (sinceSourceSha, highlights) => {
    await writeFile(
      join(root, REVIEWED_NOTES_PATH),
      JSON.stringify({ schemaVersion: 1, sinceSourceSha, highlights }),
    );
    await git('add', '--', REVIEWED_NOTES_PATH);
    await git('commit', '--quiet', '-m', 'Reviewed fixture notes');
    return git('rev-parse', 'HEAD');
  };
  return { root, git, baseline, commitNotes };
}

test('notes are tied to the committed source, not working edits, and must change meaningfully', async (t) => {
  const { root, baseline, commitNotes } = await repository(t);
  await assert.rejects(readReviewedDesktopUpdateNotes(baseline, root), /Commit reviewed/u);
  const first = await commitNotes(baseline, ['First customer improvement.']);
  await writeFile(join(root, REVIEWED_NOTES_PATH), 'Uncommitted changes must not be signed.');
  const approved = await readReviewedDesktopUpdateNotes(first, root);
  assert.deepEqual(approved.highlights, ['First customer improvement.']);
  requireNotesBaseline(approved, { sourceSha: baseline });
  assert.throws(() => requireNotesBaseline(approved, { sourceSha: 'e'.repeat(40) }), /previous/u);
  const stale = await commitNotes(first, approved.highlights);
  await assert.rejects(readReviewedDesktopUpdateNotes(stale, root), /must change/u);
  const fresh = await commitNotes(first, ['A new customer improvement.']);
  assert.deepEqual((await readReviewedDesktopUpdateNotes(fresh, root)).highlights, [
    'A new customer improvement.',
  ]);
  assert.deepEqual(await readReviewedDesktopUpdateNotes(first, root), approved);
});

test('a real merge candidate accepts reviewed branch notes without predicting the merge SHA', async (t) => {
  const { root, git, baseline, commitNotes } = await repository(t);
  await git('checkout', '--quiet', '-b', 'notes-branch');
  await commitNotes(baseline, ['Reviewed on a branch, shipped from main.']);
  await git('checkout', '--quiet', '--detach', baseline);
  await git('merge', '--no-ff', '--quiet', '-m', 'Fixture merge', 'notes-branch');
  const merged = await git('rev-parse', 'HEAD');
  const notes = await readReviewedDesktopUpdateNotes(merged, root);
  assert.equal(notes.sinceSourceSha, baseline);
  assert.deepEqual(notes.highlights, ['Reviewed on a branch, shipped from main.']);
});

test('missing history and invalid reviewed records cannot silently approve a release', async (t) => {
  const { root, commitNotes } = await repository(t);
  const source = await commitNotes('f'.repeat(40), ['Unverifiable history.']);
  await assert.rejects(readReviewedDesktopUpdateNotes(source, root), /ancestry/u);
  for (const value of [
    undefined,
    {},
    { schemaVersion: 1, sinceSourceSha: ['a'.repeat(40)], highlights: ['Wrong shape.'] },
  ])
    assert.throws(() => validateReviewedNotes(value));
  const first = { schemaVersion: 1, sinceSourceSha: null, highlights: ['First release.'] };
  assert.doesNotThrow(() => requireNotesBaseline(first, null));
  assert.throws(() => requireNotesBaseline(first, { sourceSha: 'a'.repeat(40) }));
});
