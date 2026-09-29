import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUIET_DAYS,
  cutDecision,
  holdReason,
  isoWeek,
  nextTrainVersion,
  promotionDecision,
} from './release-train-policy.mjs';

const at = (iso) => new Date(iso);

test('train weeks follow ISO 8601, so versions keep rising across New Year', () => {
  assert.deepEqual(isoWeek(at('2026-09-29T07:17:00Z')), { year: 2026, week: 40 });
  // 1 January 2027 is a Friday: it still belongs to 2026's week 53.
  assert.deepEqual(isoWeek(at('2027-01-01T12:00:00Z')), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(at('2027-01-04T00:00:00Z')), { year: 2027, week: 1 });
  // 30 December 2024 is a Monday in 2025's week 1.
  assert.deepEqual(isoWeek(at('2024-12-30T00:00:00Z')), { year: 2025, week: 1 });
  // Weeks start at midnight UTC on Monday.
  assert.deepEqual(isoWeek(at('2026-10-04T23:59:59Z')), { year: 2026, week: 40 });
  assert.deepEqual(isoWeek(at('2026-10-05T00:00:00Z')), { year: 2026, week: 41 });
  assert.throws(() => isoWeek(new Date(Number.NaN)), /valid date/u);
  assert.throws(() => isoWeek('2026-09-29'), /valid date/u);
});

test('the next train version is this week, after every version this week already used', () => {
  const now = at('2026-09-29T07:17:00Z');
  assert.equal(nextTrainVersion(now, []), '2026.40.0');
  // Older weeks and maintainer versions from another scheme do not matter.
  assert.equal(nextTrainVersion(now, ['2026.39.4', '1.2.3']), '2026.40.0');
  assert.equal(nextTrainVersion(now, ['2026.40.0']), '2026.40.1');
  assert.equal(nextTrainVersion(now, ['2026.40.3', '2026.40.0']), '2026.40.4');
  assert.equal(nextTrainVersion(at('2027-01-01T00:00:00Z'), ['2026.52.0']), '2026.53.0');
  assert.throws(() => nextTrainVersion(now, ['2026.41.0']), /newer than this week's train/u);
  assert.throws(() => nextTrainVersion(now, ['2027.1.0']), /newer than this week's train/u);
  // Windows file versions keep each part in 16 bits.
  assert.throws(() => nextTrainVersion(now, ['2026.40.65535']), /Windows file version/u);
  assert.throws(() => nextTrainVersion(now, ['not-a-version']), /strict stable version/u);
});

const entry = (sha, title) => ({ sha: sha.repeat(40), pr: null, title });
// Newest first, as `git log --first-parent` lists them.
const HISTORY = [
  entry('d', 'docs: explain the new tool'),
  entry('c', 'feat(cnc): add a chamfer tool'),
  entry('b', 'ci: cache the browsers'),
  entry('a', 'fix: keep the laser off while framing'),
];
const green = (...shas) => new Set(shas.map((sha) => sha.repeat(40)));

test('a beta is due from the newest fully checked commit with a user-facing change', () => {
  const all = [green('d', 'c', 'b', 'a'), green('d', 'c', 'b', 'a'), green('c', 'b', 'a')];
  const cut = cutDecision({ entries: HISTORY, greenSets: all, baseline: null });
  assert.equal(cut.due, true);
  assert.equal(cut.commit, 'c'.repeat(40));
  assert.equal(cut.userFacingChanges, 2);
  assert.deepEqual(
    cut.shipped.map((item) => item.sha[0]),
    ['c', 'b', 'a'],
  );
  assert.equal(cut.reason, `2 user-facing changes, up to ${'c'.repeat(9)}.`);
  const since = cutDecision({
    entries: HISTORY.slice(0, 2),
    greenSets: [green('c')],
    baseline: 'e'.repeat(40),
  });
  assert.equal(
    since.reason,
    `1 user-facing change since the newest release (${'e'.repeat(9)}), up to ${'c'.repeat(9)}.`,
  );
});

test('no beta is cut without a user-facing change that passed every check', () => {
  const quiet = cutDecision({
    entries: [HISTORY[0], HISTORY[2]],
    greenSets: [green('d', 'b')],
    baseline: 'e'.repeat(40),
  });
  assert.deepEqual(
    [quiet.due, quiet.commit, quiet.reason],
    [false, null, `Main has no user-facing change since the newest release (${'e'.repeat(9)}).`],
  );
  const unchecked = cutDecision({
    entries: HISTORY,
    greenSets: [green(), green('d')],
    baseline: null,
  });
  assert.equal(unchecked.due, false);
  assert.match(unchecked.reason, /^No main commit has passed CI, Browser smoke and the Desktop/u);
  // Only the maintenance commit below the feature has passed so far.
  const partial = cutDecision({
    entries: HISTORY.slice(0, 3),
    greenSets: [green('d', 'b'), green('b')],
    baseline: 'a'.repeat(40),
  });
  assert.equal(partial.due, false);
  assert.equal(partial.commit, 'b'.repeat(40));
  assert.match(partial.reason, /no user-facing change .*newer ones are still being checked\.$/u);
  assert.deepEqual(
    cutDecision({ entries: [], greenSets: [green()], baseline: 'a'.repeat(40) }).due,
    false,
  );
});

test('a hold comes from the repository variable or any open release-hold issue', () => {
  assert.equal(holdReason({ variable: undefined, openIssues: 0 }), null);
  assert.equal(holdReason({ variable: 'off', openIssues: 0 }), null);
  assert.match(holdReason({ variable: 'on', openIssues: 0 }), /KERFDESK_RELEASE_HOLD/u);
  assert.equal(
    holdReason({ variable: '', openIssues: 1 }),
    'an open issue is labelled release-hold',
  );
  assert.equal(
    holdReason({ variable: '', openIssues: 3 }),
    '3 open issues are labelled release-hold',
  );
});

const release = (version, publishedAt) => ({ payload: { version, publishedAt } });

test('the newest beta reaches everyone after its quiet days, unless held or already there', () => {
  assert.equal(QUIET_DAYS, 4);
  const beta = [
    release('2026.40.0', '2026-09-29T07:30:00.000Z'),
    release('2026.39.0', '2026-09-22T07:30:00.000Z'),
  ];
  const stable = [beta[1]];
  const decide = (now, extra = {}) =>
    promotionDecision({ beta, stable, now: at(now), held: null, ...extra });
  assert.deepEqual(decide('2026-10-03T07:29:59Z'), {
    due: false,
    version: '2026.40.0',
    reason: '2026.40.0 reaches everyone after 4 quiet days in beta, from 2026-10-03T07:30:00.000Z.',
  });
  assert.deepEqual(decide('2026-10-03T09:43:00Z'), {
    due: true,
    version: '2026.40.0',
    reason: '2026.40.0 has had 4 quiet days in beta with no newer beta.',
  });
  assert.equal(decide('2026-10-03T09:43:00Z', { quietDays: 7 }).due, false);
  assert.deepEqual(
    decide('2026-10-10T00:00:00Z', { held: 'an open issue is labelled release-hold' }),
    {
      due: false,
      version: '2026.40.0',
      reason: '2026.40.0 is held: an open issue is labelled release-hold.',
    },
  );
  assert.equal(
    promotionDecision({ beta, stable: beta, now: at('2026-10-10T00:00:00Z'), held: null }).reason,
    '2026.40.0 is already on the stable ring.',
  );
  assert.equal(
    promotionDecision({ beta: [], stable: [], now: at('2026-10-10T00:00:00Z'), held: null }).reason,
    'The beta ring has no release yet.',
  );
  assert.throws(
    () =>
      promotionDecision({
        beta: [beta[1]],
        stable: [beta[0]],
        now: at('2026-10-10T00:00:00Z'),
        held: null,
      }),
    /stable ring is ahead/u,
  );
});
