import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVERT_TRAILER = /This reverts commit ([0-9a-f]{40})/giu;
const FIELD = '\u0000';
const RECORD = '\u001e';

/**
 * Lists the commits main has reverted since `candidate` that `candidate`
 * contains (ADR-360). A revert adds a commit rather than removing one, so a
 * reverted tree is still an ancestor of main; the deploy lane withholds it and
 * lets the revert's own run publish the corrected tree.
 *
 * Only commits whose subject starts with `Revert "` count - what `git revert`
 * and GitHub revert PRs write. A squash body can quote the trailers of reverts
 * that landed long ago (29c0ebfc2 quotes three), and those are not new reverts.
 */
export function listRevertedInCandidate({ git, candidate, main }) {
  // git expands %x00/%x1e itself; an argv string cannot carry a NUL byte.
  const log = git(['log', '--format=%H%x00%s%x00%B%x1e', `${candidate}..${main}`]);
  const reverted = new Set();
  for (const record of log.split(RECORD)) {
    const [, subject = '', body = ''] = record.replace(/^\s+/u, '').split(FIELD);
    if (!subject.startsWith('Revert "')) continue;
    for (const match of body.matchAll(REVERT_TRAILER)) {
      const sha = match[1].toLowerCase();
      if (isAncestorOrSelf(git, sha, candidate)) reverted.add(sha);
    }
  }
  return [...reverted];
}

// A reverted SHA that is not in this clone's history (another repository, a
// rewritten branch) is not something the candidate contains.
function isAncestorOrSelf(git, sha, candidate) {
  try {
    git(['merge-base', '--is-ancestor', sha, candidate]);
    return true;
  } catch {
    return false;
  }
}

function systemGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function runCli() {
  const candidate = argument('candidate');
  const main = argument('main');
  const output = argument('output');
  if (!candidate || !main || !output) {
    throw new Error('usage: --candidate=<sha> --main=<ref> --output=<file>');
  }
  const reverted = listRevertedInCandidate({ git: systemGit, candidate, main });
  writeFileSync(resolve(output), reverted.map((sha) => `${sha}\n`).join(''));
  process.stdout.write(`${JSON.stringify({ reverted })}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`reverted-commit lookup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
