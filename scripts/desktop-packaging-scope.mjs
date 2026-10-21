import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Decides whether a Desktop package check run builds the Linux AppImage and
// .deb and rehearses the commercial Linux build (ADR-647). Pushes to main,
// merge queue entries, manual runs and release-train calls always do. A pull
// request skips them only when every file it changes is renderer, test or
// documentation source those jobs do not exercise beyond what the packaged
// launch in "Package, check and launch the desktop app" already proves.
// Anything else, including any path this list does not know, selects them.

// Renderer areas the packaged and commercial launches reach directly: the
// Electron bridge, the boot shell and the licence window.
const PACKAGED_RENDERER = ['src/platform/', 'src/ui/app/', 'src/ui/licensing/'];

const INSTALLER_IRRELEVANT = [
  (path) => path.startsWith('src/') && !PACKAGED_RENDERER.some((area) => path.startsWith(area)),
  // Unit tests never ship, wherever they live.
  (path) => /\.test\.(?:ts|tsx|mjs)$/u.test(path),
  (path) => path.startsWith('e2e/'),
  (path) => path.startsWith('docs/'),
  (path) => path.startsWith('website/'),
  // Root documentation; the notices file ships inside every package.
  (path) => /^[^/]+\.md$/u.test(path) && path !== 'THIRD_PARTY_NOTICES.md',
  (path) =>
    [
      'playwright.config.ts',
      'playwright-production.config.ts',
      'vitest.config.ts',
      'eslint.config.mjs',
      'eslint.electron.config.mjs',
      '.github/workflows/e2e.yml',
      '.github/workflows/ci.yml',
    ].includes(path),
];

export function installersNeeded(changedPaths) {
  if (!Array.isArray(changedPaths)) throw new Error('Changed paths are required.');
  // No changed file means the diff could not be trusted: build everything.
  if (changedPaths.length === 0) return true;
  return changedPaths.some((path) => !INSTALLER_IRRELEVANT.some((irrelevant) => irrelevant(path)));
}

export function packagingScope(eventName, readChangedPaths) {
  if (eventName !== 'pull_request') return { installers: true, reason: `${eventName} run` };
  const changed = readChangedPaths();
  const installers = installersNeeded(changed);
  return {
    installers,
    reason: installers
      ? 'the pull request changes packaging, desktop or unknown files'
      : `all ${changed.length} changed files are renderer, test or documentation source`,
  };
}

// A pull request run checks out GitHub's merge commit, whose first parent is
// the base branch, so this lists exactly what merging the pull request changes.
function mergeCommitChanges() {
  const output = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], {
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line !== '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const eventName = process.env.EVENT_NAME;
    if (!eventName) throw new Error('EVENT_NAME is required.');
    const { installers, reason } = packagingScope(eventName, mergeCommitChanges);
    console.log(
      `Linux installers and commercial rehearsal: ${installers ? 'run' : 'skip'} (${reason}).`,
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `installers=${installers}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
