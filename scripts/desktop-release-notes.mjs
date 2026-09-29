// Release notes and CHANGELOG.md for desktop Previews (ADR-522). Every merge
// on main's first-parent history names its pull request; this groups them
// into what is new, fixed and faster, by area, in the user's words.
//
//   node scripts/desktop-release-notes.mjs draft --releases=<json> [--to=<ref>]
//     Prints changes since the latest published immutable Preview.
//   node scripts/desktop-release-notes.mjs refresh --releases=<json> [--to=<ref>]
//     Rewrites the generated part of CHANGELOG.md's Unreleased section.
//   node scripts/desktop-release-notes.mjs stamp <version> --releases=<json>
//     Before tagging: Unreleased becomes <version>'s section.
//   node scripts/desktop-release-notes.mjs release-body <version> --releases=<json>
//     What the Preview release lane publishes as the release's notes.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newestReleasedVersion,
  refreshUnreleased,
  releaseBody,
  stampChangelog,
} from './desktop-changelog.mjs';
import { compareTags, publishedPreviews, versionParts } from './desktop-preview-releases.mjs';

export const REPOSITORY_URL = 'https://github.com/cisgz3a-hub/KerfDesk';
const PREVIEW_TAG = 'v*-preview.*';

const KINDS = [
  ['new', 'New'],
  ['faster', 'Faster'],
  ['fixed', 'Fixed'],
  ['changed', 'Other changes'],
];
const TYPE_KIND = { feat: 'new', fix: 'fixed', perf: 'faster', revert: 'fixed' };
// Titles without a conventional prefix say what they did in their first word.
const VERB_KIND = [
  [/^(fix|correct|repair|restore|revert)\b/i, 'fixed'],
  [/^(add|support|show|expose|edit|allow|auto-fit)\b/i, 'new'],
  [/^speed up\b/i, 'faster'],
];
const MAINTENANCE = new Set(['docs', 'test', 'ci', 'chore', 'refactor', 'build', 'style']);
const MAINTENANCE_SCOPES = /^(ci|deploy|release|scripts|qualification|lint|deps|e2e|adr|workflow)$/;
// Scope first, then words in the title; first match wins.
const AREAS = [
  ['Desktop app', /^(desktop|electron|release|installer|updater)/, /\b(desktop|electron)\b/i],
  [
    'CNC',
    /^(cnc|vcarve|v-carve|relief|toolpath|spindle|router|surfacing)/,
    /\bcnc\b|v-carve|spindle|relief|surfacing/i,
  ],
  ['Camera', /^camera/, /\bcamera\b/i],
  [
    '3D view and G-code Inspector',
    /^(viewer3d|viewer|preview|sim|gcode-inspector|gcode-view|inspector)/,
    /\b(3d view|inspector)\b/i,
  ],
  [
    'Design and import',
    /^(design-studio|import|export|svg|dxf|pdf|text|trace|canvas|library|scene|node|boolean|font|layers|arrange|transform|placement|nesting|variables|artwork|print-cut|file|project|io|image-editor)/,
    /\b(svg|dxf|import|trac(e|er|ing)|design studio|artwork|variable|text|font|library|weld|join|curve|centerline|bitmap|array)\b/i,
  ],
  [
    'Machine and connection',
    /^(serial|controller|devices|fluidnc|grbl|machine|console|jog|macro|connection|marlin|smoothie|settings)/,
    /\b(grbl|serial|controller|jog|console|machine|home|coordinates|origin)\b/i,
  ],
  [
    'Running jobs',
    /^(start|review|preflight|frame|job|run|execution-plan|stream)/,
    /\b(job review|frame|start|countdown|duration|timing)\b/i,
  ],
  ['Recovery', /^(recovery|resume|checkpoint|save|autosave)/, /\b(recovery|resume|autosave)\b/i],
  [
    'Laser',
    /^(laser|raster|image|scan|fill|dither|photo|kerf|box|rotary|material|gcode|registration)/,
    /\b(laser|engrav\w*|raster|fill|kerf|photo|registration jig\w*|rotary|scan\w*)\b/i,
  ],
];
const TRACKING = /\s*\((?:ADR|LBG|CNG|CW|MC|DEP|RF)-?[^)]*\)/g;

/** One entry per first-parent commit of `git log --format=%H%x1f%s%x1f%b%x1e`. */
export function parseFirstParentLog(text) {
  return text
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim() !== '')
    .flatMap((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f');
      const merged = /^Merge pull request #(\d+) from \S+/.exec(subject);
      if (merged !== null) {
        const title = body.split('\n').find((line) => line.trim() !== '');
        return [{ sha, pr: Number(merged[1]), title: (title ?? subject).trim() }];
      }
      if (/^Merge (?:branch|remote-tracking branch) /.test(subject)) return [];
      const squashed = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject);
      if (squashed !== null) return [{ sha, pr: Number(squashed[2]), title: squashed[1] }];
      const bundle = /^Merge (?:pull request )?#(\d+):\s*(.+)$/.exec(subject);
      if (bundle !== null) {
        const title = body.split('\n').find((line) => /^[a-z]+(\([^)]*\))?!?: /.test(line));
        return [{ sha, pr: Number(bundle[1]), title: (title ?? bundle[2]).trim() }];
      }
      return [{ sha, pr: null, title: subject.trim() }];
    });
}

/** Kind, area and plain text of one change title. */
export function classifyChange(title) {
  const conventional = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(title);
  const type = conventional?.[1] ?? '';
  const scope = (conventional?.[2] ?? '').split(/[,/ ]/)[0].toLowerCase();
  const text = describe(conventional?.[3] ?? title.replace(/^[A-Z]{2,4}-[A-Z]?\d+:\s*/, ''));
  const verbKind = VERB_KIND.find(([pattern]) => pattern.test(text))?.[1];
  const kind =
    MAINTENANCE.has(type) || MAINTENANCE_SCOPES.test(scope)
      ? 'maintenance'
      : (TYPE_KIND[type] ?? (conventional === null ? verbKind : undefined) ?? 'changed');
  const byScope = scope === '' ? undefined : AREAS.find(([, pattern]) => pattern.test(scope));
  const byWords = AREAS.find(([, , words]) => words.test(text));
  return { kind, area: (byScope ?? byWords)?.[0] ?? 'App', text };
}

function describe(text) {
  const plain = text.replace(TRACKING, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** Markdown notes, heading level `level` for each kind. */
export function renderNotes(entries, { level = 3 } = {}) {
  const changes = entries.map((entry) => ({ ...entry, ...classifyChange(entry.title) }));
  const areaOrder = [...AREAS.map(([name]) => name), 'App'];
  const hashes = '#'.repeat(level);
  const sections = KINDS.flatMap(([kind, heading]) => {
    const listed = changes
      .filter((change) => change.kind === kind)
      .sort((a, b) => areaOrder.indexOf(a.area) - areaOrder.indexOf(b.area));
    if (listed.length === 0) return [];
    const lines = listed.map((change) => {
      const link =
        change.pr === null ? '' : ` ([#${change.pr}](${REPOSITORY_URL}/pull/${change.pr}))`;
      return `- **${change.area}:** ${change.text}${link}`;
    });
    return [`${hashes} ${heading}\n\n${lines.join('\n')}`];
  });
  const maintenance = changes.filter((change) => change.kind === 'maintenance').length;
  if (maintenance > 0) {
    sections.push(
      maintenance === 1
        ? '_1 change to tests, documentation or build tooling is not listed._'
        : `_${maintenance} changes to tests, documentation and build tooling are not listed._`,
    );
  }
  return sections.length === 0 ? '_No changes._' : sections.join('\n\n');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function previewTagBefore(ref) {
  try {
    return git('describe', '--tags', '--abbrev=0', `--match=${PREVIEW_TAG}`, ref);
  } catch {
    return null;
  }
}

export function notesBetween(from, to) {
  const range = from === null ? to : `${from}..${to}`;
  return renderNotes(
    parseFirstParentLog(git('log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', range)),
  );
}

function runCli(argv) {
  const [command, version] = argv;
  const option = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const changelogPath = resolve('CHANGELOG.md');
  const releasesPath = option('releases');
  const releases = () => {
    if (releasesPath === undefined) throw new Error('--releases=<metadata.json> is required');
    const published = publishedPreviews(JSON.parse(readFileSync(releasesPath, 'utf8')));
    if (version !== undefined && !version.startsWith('--')) {
      if (versionParts(`v${version}`) === null) throw new Error('expected a Preview version');
      return published.filter((release) => compareTags(release.tagName, `v${version}`) < 0);
    }
    return published;
  };
  const previousTag = (published, to) => {
    const tag = published[0]?.tagName;
    if (tag === undefined) throw new Error('no preceding published immutable Preview release');
    git('merge-base', '--is-ancestor', `${tag}^{commit}`, to);
    return tag;
  };
  if (command === 'draft') {
    const to = option('to') ?? 'HEAD';
    return notesBetween(option('from') ?? previousTag(releases(), to), to);
  }
  if (command === 'refresh') {
    const changelog = readFileSync(changelogPath, 'utf8');
    const to = option('to') ?? 'HEAD';
    writeFileSync(
      changelogPath,
      refreshUnreleased(changelog, notesBetween(previousTag(releases(), to), to)),
    );
    return `CHANGELOG.md Unreleased refreshed up to ${to}`;
  }
  if (command === 'stamp' && version !== undefined) {
    const changelog = readFileSync(changelogPath, 'utf8');
    const published = releases();
    const latest = previousTag(published, 'HEAD');
    const missed = [];
    // Only actually published Previews receive a missing historical section.
    for (let index = 0; index < published.length; index += 1) {
      const release = published[index];
      const tag = release.tagName;
      if (tag.slice(1) === newestReleasedVersion(changelog)) break;
      const previous = published[index + 1]?.tagName ?? null;
      missed.push({
        version: tag.slice(1),
        date: release.publishedAt.slice(0, 10),
        generated: notesBetween(previous, tag),
      });
    }
    const date = new Date().toISOString().slice(0, 10);
    const generated = notesBetween(latest, 'HEAD');
    writeFileSync(changelogPath, stampChangelog(changelog, { version, date, generated, missed }));
    return `CHANGELOG.md stamped for ${version}`;
  }
  if (command === 'release-body' && version !== undefined) {
    const changelog = readFileSync(changelogPath, 'utf8');
    const previous = previousTag(releases(), 'HEAD');
    return releaseBody(changelog, version, notesBetween(previous, 'HEAD'), {
      regenerateChanges: true,
    });
  }
  throw new Error(
    'usage: desktop-release-notes.mjs draft|refresh|stamp <version>|release-body <version>',
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${runCli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`desktop release notes failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
