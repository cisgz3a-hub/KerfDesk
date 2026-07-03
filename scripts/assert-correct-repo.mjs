import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const expectedRepoName = 'LaserForge-2.0';
const expectedRemote = 'https://github.com/cisgz3a-hub/LaserForge-2.0';

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
if (basename(identityRoot) !== expectedRepoName) {
  fail(
    `expected the checkout (or the worktree's main repository) to live in a folder named ` +
      `"${expectedRepoName}", got "${identityRoot}"`,
  );
}

const origin = git(['remote', 'get-url', 'origin']);
if (normalizeGitRemoteUrl(origin) !== expectedRemote) {
  fail(`expected origin ${expectedRemote}(.git), got ${origin}`);
}

const indexHtml = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
if (!indexHtml.includes('<title>KerfDesk</title>') || !indexHtml.includes('id="app-root"')) {
  fail('index.html does not look like the KerfDesk app shell');
}

console.log(`Repository guard passed: ${repoRoot}`);
