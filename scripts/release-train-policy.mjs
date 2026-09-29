// The weekly commercial release train's decisions (ADR-541). Pure functions:
// scripts/release-train.mjs gathers main's history, the green runs, the two
// catalogues and the clock, then acts on what these return.
import { classifyChange } from './desktop-release-notes.mjs';
import { newestGreenCommit } from './desktop-preview-cadence.mjs';
import { compareStableVersions, stableVersionParts } from './stable-release-artifacts.mjs';

/**
 * Days the newest beta must stay the newest beta before it reaches everyone.
 * Under the 7-day cut interval, so steady weekly changes cannot starve the
 * stable ring, and a Tuesday cut gets Saturday, Sunday and Monday to promote.
 */
export const QUIET_DAYS = 4;
const DAY_MS = 86_400_000;
// Windows keeps each part of a file version in 16 bits.
const WINDOWS_VERSION_PART_MAX = 65_535;

/** The ISO 8601 week-numbering year and week of an instant, in UTC. */
export function isoWeek(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new Error('A valid date is required.');
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // The Thursday of a week decides which year that week belongs to.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.floor((day.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/**
 * `<ISO year>.<ISO week>.<patch>`: a week's first release is patch 0 and a
 * same-week rebuild counts up. `taken` is every version the rings list, plus
 * any an interrupted publication reserved. The ISO year, not the calendar
 * year, keeps versions rising across New Year (1 January 2027 is in 2026's
 * week 53).
 */
export function nextTrainVersion(now, taken) {
  const { year, week } = isoWeek(now);
  let patch = 0;
  for (const version of taken) {
    const [major, minor, part] = stableVersionParts(version);
    const newerWeek = major > BigInt(year) || (major === BigInt(year) && minor > BigInt(week));
    if (newerWeek)
      throw new Error(`Release ${version} is newer than this week's train (${year}.${week}).`);
    if (major === BigInt(year) && minor === BigInt(week) && part >= BigInt(patch))
      patch = Number(part) + 1;
  }
  if (year > WINDOWS_VERSION_PART_MAX || patch > WINDOWS_VERSION_PART_MAX)
    throw new Error('The train version no longer fits a Windows file version.');
  return `${year}.${week}.${patch}`;
}

const userFacing = (entries) =>
  entries.filter((entry) => classifyChange(entry.title).kind !== 'maintenance');

/**
 * A beta is due when a main commit passed every check and at least one
 * user-facing change lies between the newest release's source and that
 * commit. `entries` are main's first-parent commits after that source, newest
 * first; before the first release they are all of main's history.
 */
export function cutDecision({ entries, greenSets, baseline }) {
  const since = baseline === null ? '' : ` since the newest release (${baseline.slice(0, 9)})`;
  const quiet = { due: false, commit: null, shipped: [], userFacingChanges: 0 };
  if (userFacing(entries).length === 0)
    return { ...quiet, reason: `Main has no user-facing change${since}.` };
  const commit = newestGreenCommit(
    entries.map((entry) => entry.sha),
    greenSets,
  );
  if (commit === null)
    return {
      ...quiet,
      reason: `No main commit${since} has passed CI, Browser smoke and the Desktop package check yet.`,
    };
  // Newest first, so the chosen commit and everything older than it.
  const shipped = entries.slice(entries.findIndex((entry) => entry.sha === commit));
  const userFacingChanges = userFacing(shipped).length;
  if (userFacingChanges === 0)
    return {
      ...quiet,
      commit,
      reason: `The newest commit every check passed on (${commit.slice(0, 9)}) has no user-facing change${since}; newer ones are still being checked.`,
    };
  return {
    due: true,
    commit,
    shipped,
    userFacingChanges,
    reason: `${userFacingChanges} user-facing ${userFacingChanges === 1 ? 'change' : 'changes'}${since}, up to ${commit.slice(0, 9)}.`,
  };
}

/** Why promotion is held, or null: the repository variable or open hold issues. */
export function holdReason({ variable, openIssues }) {
  if (variable === 'on') return 'the KERFDESK_RELEASE_HOLD variable is on';
  if (openIssues > 0)
    return openIssues === 1
      ? 'an open issue is labelled release-hold'
      : `${openIssues} open issues are labelled release-hold`;
  return null;
}

/**
 * The newest beta reaches everyone once it has been in beta for QUIET_DAYS
 * with no newer beta cut, is not on the stable ring yet and is not held. An
 * older beta that a newer one replaced is never promoted.
 */
export function promotionDecision({ beta, stable, now, held, quietDays = QUIET_DAYS }) {
  const newest = beta[0]?.payload;
  if (newest === undefined)
    return { due: false, version: null, reason: 'The beta ring has no release yet.' };
  const { version } = newest;
  if (stable.some((entry) => entry.payload.version === version))
    return { due: false, version, reason: `${version} is already on the stable ring.` };
  if (stable[0] !== undefined && compareStableVersions(stable[0].payload.version, version) > 0)
    throw new Error(`The stable ring is ahead of the newest beta (${version}).`);
  if (held) return { due: false, version, reason: `${version} is held: ${held}.` };
  const quietUntil = Date.parse(newest.publishedAt) + quietDays * DAY_MS;
  if (now.getTime() < quietUntil)
    return {
      due: false,
      version,
      reason: `${version} reaches everyone after ${quietDays} quiet days in beta, from ${new Date(quietUntil).toISOString()}.`,
    };
  return {
    due: true,
    version,
    reason: `${version} has had ${quietDays} quiet days in beta with no newer beta.`,
  };
}
