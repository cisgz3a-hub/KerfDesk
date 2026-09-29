import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CHANGES_END,
  CHANGES_START,
  changelogSection,
  newestReleasedVersion,
  refreshUnreleased,
  releaseBody,
  stampChangelog,
  unreleasedHighlights,
} from './desktop-changelog.mjs';
import { classifyChange, parseFirstParentLog, renderNotes } from './desktop-release-notes.mjs';

const record = (sha, subject, body = '') => `${sha}\x1f${subject}\x1f${body}\x1e`;

test('reads the pull request and title of each merge style on main', () => {
  const log = [
    record('a1', 'Merge pull request #996 from o/claude/batch-7', 'feat(laser): tabs by spacing\n'),
    record('b2', 'fix(cnc): Pause lifts the bit (ADR-411 Amendment 1) (#993)'),
    record(
      'c3',
      'Merge #963: land bidirectional scan timing (#960, with #959)',
      'feat(laser): land bidirectional scan timing\n\n* fix(laser): stabilise scans\n',
    ),
    record('d4', 'Merge pull request #699: complete 37-item audit remediation'),
    record('e5', "Merge remote-tracking branch 'origin/main' into feature"),
    record('f6', 'Library M3: fix insertion identity'),
  ].join('\n');
  assert.deepEqual(parseFirstParentLog(log), [
    { sha: 'a1', pr: 996, title: 'feat(laser): tabs by spacing' },
    { sha: 'b2', pr: 993, title: 'fix(cnc): Pause lifts the bit (ADR-411 Amendment 1)' },
    { sha: 'c3', pr: 963, title: 'feat(laser): land bidirectional scan timing' },
    { sha: 'd4', pr: 699, title: 'complete 37-item audit remediation' },
    { sha: 'f6', pr: null, title: 'Library M3: fix insertion identity' },
  ]);
});

test('sorts a title into what kind of change it is and where it lands', () => {
  assert.deepEqual(classifyChange('fix(cnc): pause lifts the bit (ADR-411 Amd 1, ADR-412)'), {
    kind: 'fixed',
    area: 'CNC',
    text: 'Pause lifts the bit',
  });
  assert.equal(classifyChange('feat(camera): a phone as the overhead camera').kind, 'new');
  assert.equal(classifyChange('perf(viewer3d): big files').area, '3D view and G-code Inspector');
  assert.equal(classifyChange('docs: ADR registry').kind, 'maintenance');
  assert.equal(classifyChange('fix(ci): pin the runner').kind, 'maintenance');
  const plain = classifyChange('LBG-C05: laser tabs by spacing, with a tab power (ADR-494)');
  assert.deepEqual(plain, {
    kind: 'changed',
    area: 'Laser',
    text: 'Laser tabs by spacing, with a tab power',
  });
  assert.equal(classifyChange('Fix Convert to Bitmap fidelity').kind, 'fixed');
  assert.equal(classifyChange('Speed up tracer previews').area, 'Design and import');
  assert.equal(classifyChange('Redesign startup with timber visuals').area, 'App');
});

test('renders notes grouped by kind and area with pull request links', () => {
  const notes = renderNotes([
    { pr: 1, title: 'fix(laser): fans stay on' },
    { pr: 2, title: 'feat(cnc): tapered ball-nose bits' },
    { pr: 3, title: 'feat(camera): phone camera' },
    { pr: 4, title: 'test(e2e): hold the read' },
    { pr: null, title: 'perf(ui): faster pan' },
  ]);
  assert.equal(
    notes,
    [
      '### New',
      '',
      '- **CNC:** Tapered ball-nose bits ([#2](https://github.com/cisgz3a-hub/KerfDesk/pull/2))',
      '- **Camera:** Phone camera ([#3](https://github.com/cisgz3a-hub/KerfDesk/pull/3))',
      '',
      '### Faster',
      '',
      '- **App:** Faster pan',
      '',
      '### Fixed',
      '',
      '- **Laser:** Fans stay on ([#1](https://github.com/cisgz3a-hub/KerfDesk/pull/1))',
      '',
      '_1 change to tests, documentation or build tooling is not listed._',
    ].join('\n'),
  );
  assert.equal(renderNotes([]), '_No changes._');
});

const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '### Highlights',
  '',
  '- CNC pauses lift the bit.',
  '',
  '### All changes',
  '',
  CHANGES_START,
  'old list',
  CHANGES_END,
  '',
  '## 0.2.0-preview.13 - 2026-07-23',
  '',
  'First public Previews.',
  '',
].join('\n');

test('finds a version section and the newest released version', () => {
  assert.equal(changelogSection(CHANGELOG, '0.2.0-preview.13'), 'First public Previews.');
  assert.match(changelogSection(CHANGELOG, 'Unreleased') ?? '', /^### Highlights/);
  assert.equal(changelogSection(CHANGELOG, '0.2.0-preview.14'), null);
  assert.equal(newestReleasedVersion(CHANGELOG), '0.2.0-preview.13');
});

test('refreshes only the generated list of the Unreleased section', () => {
  const refreshed = refreshUnreleased(CHANGELOG, 'new list');
  assert.match(refreshed, /<!-- changes:start -->\nnew list\n<!-- changes:end -->/);
  assert.match(refreshed, /CNC pauses lift the bit/);
  assert.throws(() => refreshUnreleased('# Changelog\n', 'x'), /needs an Unreleased section/);
});

test('stamps Unreleased as the next Preview and opens a fresh Unreleased', () => {
  const stamped = stampChangelog(CHANGELOG, {
    version: '0.2.0-preview.14',
    date: '2026-10-01',
    generated: 'fresh list',
  });
  assert.equal(changelogSection(stamped, 'Unreleased')?.includes('- Nothing yet.'), true);
  const released = changelogSection(stamped, '0.2.0-preview.14') ?? '';
  assert.match(released, /CNC pauses lift the bit/);
  assert.match(released, /fresh list/);
  assert.equal(newestReleasedVersion(stamped), '0.2.0-preview.14');
  assert.equal(changelogSection(stamped, '0.2.0-preview.13'), 'First public Previews.');
  // Only Unreleased keeps the generated-list markers, so a later refresh finds them.
  assert.equal(stamped.split(CHANGES_START).length, 2);
  assert.ok(stamped.indexOf(CHANGES_START) < stamped.indexOf('## 0.2.0-preview.14'));
  assert.equal(unreleasedHighlights(stamped), '');
});

test('release notes use the stamped section, else the highlights and every change', () => {
  assert.equal(releaseBody(CHANGELOG, '0.2.0-preview.13', 'ignored'), 'First public Previews.');
  assert.equal(
    releaseBody(CHANGELOG, '0.2.0-preview.14', 'fresh list'),
    '### Highlights\n\n- CNC pauses lift the bit.\n\n### All changes\n\nfresh list',
  );
  const empty = stampChangelog(CHANGELOG, {
    version: '0.2.0-preview.14',
    date: 'd',
    generated: 'x',
  });
  assert.equal(releaseBody(empty, '0.2.0-preview.15', 'later'), '### All changes\n\nlater');
});

test('gives a Preview tagged without a stamp its own generated section', () => {
  const stamped = stampChangelog(CHANGELOG, {
    version: '0.2.0-preview.15',
    date: '2026-10-08',
    generated: 'since 14',
    missed: [{ version: '0.2.0-preview.14', date: '2026-10-01', generated: '13 to 14' }],
  });
  const order = ['## 0.2.0-preview.15', '## 0.2.0-preview.14', '## 0.2.0-preview.13'].map(
    (heading) => stamped.indexOf(heading),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  assert.equal(changelogSection(stamped, '0.2.0-preview.14'), '13 to 14');
});

test('release publication regenerates a stamped list while retaining its curated highlights', () => {
  const stamped = stampChangelog(CHANGELOG, {
    version: '0.2.0-preview.15',
    date: '2026-09-28',
    generated: 'incomplete list made after a failed tag',
  });
  const body = releaseBody(stamped, '0.2.0-preview.15', 'all unshipped changes', {
    regenerateChanges: true,
  });
  assert.match(body, /CNC pauses lift the bit/);
  assert.match(body, /all unshipped changes/);
  assert.doesNotMatch(body, /incomplete list/);
});

test('the release-body and stamp CLIs retain failed-tag changes without inventing a published release', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'kerfdesk-release-notes-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release notes test');
  git('config', 'user.email', 'notes@example.invalid');
  let count = 0;
  const commit = (title) => {
    writeFileSync(join(root, 'fixture.txt'), String(count++));
    git('add', 'fixture.txt');
    git('commit', '-m', title);
  };
  commit('feat: previously published (#1)');
  git('tag', '-a', 'v0.2.0-preview.13', '-m', 'Published 13');
  commit('fix: unshipped failed-tag change (#2)');
  git('tag', '-a', 'v0.2.0-preview.14', '-m', 'Failed 14');
  commit('feat: newest change (#3)');
  git('tag', '-a', 'v0.2.0-preview.15', '-m', 'Current release');
  const release = {
    tag_name: 'v0.2.0-preview.13',
    published_at: '2026-07-23T09:37:17Z',
    draft: false,
    prerelease: true,
    immutable: true,
  };
  const metadata = join(root, 'releases.json');
  // A published current version on a retry must not become its own baseline.
  writeFileSync(
    metadata,
    JSON.stringify([[release], [{ ...release, tag_name: 'v0.2.0-preview.15' }]]),
  );
  const changelog = join(root, 'CHANGELOG.md');
  writeFileSync(changelog, CHANGELOG);
  const script = fileURLToPath(new URL('./desktop-release-notes.mjs', import.meta.url));
  const run = (command) =>
    spawnSync(process.execPath, [script, command, '0.2.0-preview.15', `--releases=${metadata}`], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
  const body = run('release-body');
  assert.ifError(body.error);
  assert.equal(body.status, 0, body.stderr);
  assert.match(body.stdout, /Unshipped failed-tag change/);
  assert.match(body.stdout, /Newest change/);
  assert.doesNotMatch(body.stdout, /Previously published/);
  const stamped = run('stamp');
  assert.equal(stamped.status, 0, stamped.stderr);
  const text = readFileSync(changelog, 'utf8');
  assert.match(changelogSection(text, '0.2.0-preview.15'), /Unshipped failed-tag change/);
  assert.equal(changelogSection(text, '0.2.0-preview.14'), null);
  writeFileSync(metadata, '[]');
  const noBaseline = run('release-body');
  assert.equal(noBaseline.status, 1);
  assert.match(noBaseline.stderr, /no preceding published immutable Preview release/);
});
