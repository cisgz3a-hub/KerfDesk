import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// The repo was renamed cisgz3a-hub/LaserForge-2.0 -> cisgz3a-hub/KerfDesk on
// 2026-07-03. Both identities are accepted during and after the transition:
// GitHub redirects the old URL, GitHub Actions checks the new name out under
// work/KerfDesk, and existing local clones/worktrees carry either folder name
// (this machine's is plain "LaserForge"). The remote-URL allowlist is the
// strong identity check; the folder-name allowlist is defense-in-depth against
// deploying a look-alike repo.
const expectedRepoNames = ['KerfDesk', 'LaserForge-2.0', 'LaserForge'];
const expectedRemotes = [
  'https://github.com/cisgz3a-hub/KerfDesk',
  'https://github.com/cisgz3a-hub/LaserForge-2.0',
];

function fail(message) {
  console.error(`Repository guard failed: ${message}`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    fail(`unable to run git ${args.join(' ')}: ${error.message}`);
  }
}

function normalizeGitRemoteUrl(remote) {
  return remote.trim().replace(/\.git$/i, '');
}

const repoRoot = resolve(git(['rev-parse', '--show-toplevel']));
// Release runs are allowed from linked git worktrees (.claude/worktrees/<name>)
// of the canonical checkout. The repository's identity lives with the main
// .git directory, so validate the folder that owns the common dir — a linked
// worktree's own folder name is arbitrary, while a clone under a wrong folder
// name still fails because its common dir lives inside that wrong folder.
const commonDir = resolve(repoRoot, git(['rev-parse', '--git-common-dir']));
const identityRoot = dirname(commonDir);
if (!expectedRepoNames.includes(basename(identityRoot))) {
  fail(
    `expected the checkout (or the worktree's main repository) to live in a folder named ` +
      `one of ${expectedRepoNames.join(', ')}, got "${identityRoot}"`,
  );
}

const origin = git(['remote', 'get-url', 'origin']);
if (!expectedRemotes.includes(normalizeGitRemoteUrl(origin))) {
  fail(`expected origin to be one of ${expectedRemotes.join(', ')}(.git), got ${origin}`);
}

const indexHtml = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
if (!indexHtml.includes('<title>KerfDesk</title>') || !indexHtml.includes('id="app-root"')) {
  fail('index.html does not look like the KerfDesk app shell');
}

console.log(`Repository guard passed: ${repoRoot}`);
