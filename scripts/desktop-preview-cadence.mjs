// Keeps desktop Previews regular (ADR-522). Run daily by
// .github/workflows/desktop-preview-cadence.yml: when main has user-facing
// changes the newest Preview lacks and that Preview is at least a week old,
// it drafts one issue naming the next Preview tag, the newest main commit
// every check passed on, the commands to tag it and the release notes.
// Tagging stays with the maintainer (the v* tag ruleset, ADR-248); this never
// tags, pushes or publishes anything.
//
// usage: node scripts/desktop-preview-cadence.mjs --releases=<file>
//          --green=<file> [--green=<file>...]
//          --issue=<file> [--github-output=<file>] [--now=<ISO date>]
// Each --green file lists the main commits one workflow passed on, one per line.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPOSITORY_URL,
  classifyChange,
  parseFirstParentLog,
  renderNotes,
} from './desktop-release-notes.mjs';
import {
  compareTags,
  nextUnusedPreviewTag,
  publishedPreviews,
  versionParts,
} from './desktop-preview-releases.mjs';
export {
  nextPreviewTag,
  nextUnusedPreviewTag,
  publishedPreviews,
} from './desktop-preview-releases.mjs';

export const MIN_DAYS_BETWEEN_PREVIEWS = 7;
export const ISSUE_TITLE_PREFIX = 'Desktop Preview due';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The newest first-parent commit that every workflow passed on, or null. */
export function newestGreenCommit(firstParentShas, greenSets) {
  return firstParentShas.find((sha) => greenSets.every((green) => green.has(sha))) ?? null;
}

export function previewDue({ userFacingChanges, lastPreviewAt, now }) {
  const days = Math.floor((now.getTime() - lastPreviewAt.getTime()) / DAY_MS);
  return { due: userFacingChanges > 0 && days >= MIN_DAYS_BETWEEN_PREVIEWS, days };
}

export function cadenceIssue({
  lastTag,
  days,
  nextTag,
  commit,
  userFacingChanges,
  notes,
  unpublishedTags = [],
}) {
  const version = nextTag.slice(1);
  const [base, number] = version.split('-preview.');
  const commitLink = `[\`${commit.slice(0, 9)}\`](${REPOSITORY_URL}/commit/${commit})`;
  return [
    `**KerfDesk ${version} is ready to tag.** The newest desktop Preview, ${lastTag}, is ${days} days old, and main has ${userFacingChanges} user-facing changes it does not have.`,
    '',
    `CI, Browser smoke and the Desktop package check all passed on main at ${commitLink}, so that is the commit to tag.`,
    '',
    ...(unpublishedTags.length === 0
      ? []
      : [
          `These newer tags exist without a published immutable Preview: ${unpublishedTags.map((tag) => `\`${tag}\``).join(', ')}. They are reserved and do not reset the release date or remove changes from these notes.`,
          '',
          'Check their release workflow runs first. Wait for an active run, or investigate a failed run and decide whether to retry that release before creating another. The commands below use the next unused tag; never move or recreate an existing release tag.',
          '',
        ]),
    'To publish it:',
    '',
    `1. Optional: fetch release metadata with \`gh api --paginate --slurp repos/cisgz3a-hub/KerfDesk/releases > preview-releases.json\`, then stamp the changelog with \`node scripts/desktop-release-notes.mjs stamp ${version} --releases=preview-releases.json\` and merge it. Tag that merge commit once its checks pass. Without a stamp the Preview still gets these notes.`,
    '2. From a clone of main:',
    '',
    '```sh',
    'git fetch origin main --tags',
    `git tag -a ${nextTag} -m "KerfDesk v${base} Preview ${number}" ${commit}`,
    `git push origin ${nextTag}`,
    '```',
    '',
    '3. The Preview release lane builds, checks and publishes the Windows and macOS downloads with these notes. This issue closes itself only after a newer immutable Preview is published.',
    '',
    '<details><summary>Release notes draft</summary>',
    '',
    notes,
    '',
    '</details>',
    '',
    '_Refreshed daily by `.github/workflows/desktop-preview-cadence.yml` (ADR-522)._',
  ].join('\n');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function runCli(argv) {
  const values = (name) =>
    argv.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
  const [issuePath] = values('issue');
  const [githubOutput] = values('github-output');
  const [nowArg] = values('now');
  const [releasesPath] = values('releases');
  const greenFiles = values('green');
  if (issuePath === undefined || releasesPath === undefined || greenFiles.length === 0) {
    throw new Error(
      'usage: desktop-preview-cadence.mjs --releases=<file> --green=<file>... --issue=<file>',
    );
  }
  const outputs = {};
  const releases = publishedPreviews(JSON.parse(readFileSync(releasesPath, 'utf8')));
  const lastRelease = releases[0];
  if (lastRelease === undefined) {
    throw new Error(
      'no published immutable Preview release; a release baseline must be established',
    );
  }
  const lastTag = lastRelease.tagName;
  git('merge-base', '--is-ancestor', `${lastTag}^{commit}`, 'HEAD');
  const tags = git('tag', '--list', 'v*-preview.*').split(/\s+/).filter(Boolean);
  const publishedTags = new Set(releases.map((release) => release.tagName));
  const unpublishedTags = tags.filter(
    (tag) => versionParts(tag) !== null && compareTags(tag, lastTag) > 0 && !publishedTags.has(tag),
  );
  const entries = parseFirstParentLog(
    git('log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', `${lastTag}..HEAD`),
  );
  const userFacingChanges = entries.filter(
    (entry) => classifyChange(entry.title).kind !== 'maintenance',
  ).length;
  const lastPreviewAt = new Date(lastRelease.publishedAt);
  const now = nowArg === undefined ? new Date() : new Date(nowArg);
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date');
  const { due, days } = previewDue({ userFacingChanges, lastPreviewAt, now });
  const greenSets = greenFiles.map(
    (file) => new Set(readFileSync(file, 'utf8').split(/\s+/).filter(Boolean)),
  );
  const commit = newestGreenCommit(
    entries.map((entry) => entry.sha),
    greenSets,
  );
  const nextTag = nextUnusedPreviewTag(lastTag, tags);
  Object.assign(outputs, { last_tag: lastTag, next_tag: nextTag, commit: commit ?? '' });
  if (!due) {
    outputs.due = 'false';
    writeFileSync(
      issuePath,
      `${lastTag} is current: ${days} days old, ${userFacingChanges} user-facing changes since.`,
    );
  } else if (commit === null) {
    outputs.due = 'waiting';
    writeFileSync(issuePath, `No main commit since ${lastTag} has passed every check yet.`);
  } else {
    // Entries are newest first, so the tagged commit and everything older.
    const tagged = entries.slice(entries.findIndex((entry) => entry.sha === commit));
    const listed = tagged.filter((entry) => classifyChange(entry.title).kind !== 'maintenance');
    const notes = renderNotes(tagged);
    writeFileSync(
      issuePath,
      cadenceIssue({
        lastTag,
        days,
        nextTag,
        commit,
        userFacingChanges: listed.length,
        notes,
        unpublishedTags,
      }),
    );
    outputs.due = 'true';
    outputs.title = `${ISSUE_TITLE_PREFIX}: ${nextTag}`;
  }
  if (githubOutput !== undefined) {
    appendFileSync(
      githubOutput,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  return outputs.due === 'true' ? outputs.title : readFileSync(issuePath, 'utf8');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${runCli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`desktop preview cadence failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
