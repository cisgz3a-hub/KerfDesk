import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cadenceIssue,
  newestGreenCommit,
  nextPreviewTag,
  previewDue,
} from './desktop-preview-cadence.mjs';

test('names the next Preview tag after the newest one', () => {
  assert.equal(nextPreviewTag('v0.2.0-preview.13'), 'v0.2.0-preview.14');
  assert.equal(nextPreviewTag('v1.0.0-preview.9'), 'v1.0.0-preview.10');
  assert.throws(() => nextPreviewTag('v0.1.1'), /not a Preview tag/);
});

test('picks the newest main commit every workflow passed on', () => {
  const main = ['e', 'd', 'c', 'b', 'a'];
  assert.equal(newestGreenCommit(main, [new Set(['d', 'c', 'a']), new Set(['c', 'b', 'a'])]), 'c');
  assert.equal(newestGreenCommit(main, [new Set(['e']), new Set(['d'])]), null);
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
  assert.ok(body.includes(`git tag -a v0.2.0-preview.14 -m "KerfDesk 0.2.0 Preview 14" ${commit}`));
  assert.ok(body.includes('git push origin v0.2.0-preview.14'));
  assert.ok(body.includes('stamp 0.2.0-preview.14'));
  assert.ok(body.includes('- **Laser:** Fans stay on'));
});
