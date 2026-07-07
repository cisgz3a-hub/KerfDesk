import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build-time identifiers surfaced in the Toolbar so the user can verify after a
// deploy that the new version actually loaded. None of these values affect the
// bundle's behaviour; they are cosmetic readouts. Extracted from vite.config.ts
// (D-S02-001) so the git-derived, deterministic metadata is unit-testable.

const DEV_SHA_FALLBACK = 'dev';
const DEFAULT_PKG_VERSION = '0.0.0';

/**
 * Runs a git command and returns trimmed stdout. Injected into the derivation
 * helpers so tests can stub git without a real repo and assert determinism.
 */
export type GitExec = (args: readonly string[]) => string;

export const runGit: GitExec = (args) =>
  execFileSync('git', [...args], { encoding: 'utf8' }).trim();

/** Short SHA of HEAD; `"dev"` when git history is unavailable. */
export function gitShortSha(gitExec: GitExec = runGit): string {
  try {
    return gitExec(['rev-parse', '--short', 'HEAD']);
  } catch {
    return DEV_SHA_FALLBACK;
  }
}

function gitCommitCount(gitExec: GitExec): string | null {
  try {
    return gitExec(['rev-list', '--count', 'HEAD']);
  } catch {
    return null;
  }
}

/**
 * ISO-8601 UTC timestamp of HEAD's commit — NOT wall-clock. Derived from git
 * `%cI` (committer date) so rebuilding or re-deploying the SAME commit yields a
 * byte-identical bundle; a wall-clock `new Date()` would mint a fresh service
 * worker on every no-op redeploy and nag users with a phantom "update
 * available" (ADR-060). Re-normalized to UTC via Date to keep the historical
 * `…Z` shape while staying deterministic given the commit.
 *
 * Falls back to wall-clock ONLY when git history is absent (local dev — such
 * builds are never deployed, so the non-determinism there is harmless).
 */
export function buildTimeIso(gitExec: GitExec = runGit): string {
  try {
    const commitIso = gitExec(['show', '-s', '--format=%cI', 'HEAD']);
    if (commitIso !== '') return new Date(commitIso).toISOString();
  } catch {
    // fall through to the dev fallback below
  }
  return new Date().toISOString();
}

function pkgVersion(readPkg: () => string): string {
  const pkg = JSON.parse(readPkg()) as { version?: string };
  return pkg.version ?? DEFAULT_PKG_VERSION;
}

/**
 * Auto build version: package.json's MAJOR.MINOR (the release line) plus the git
 * commit count as an always-incrementing patch, so the badge changes on every
 * commit/deploy without a manual bump. Falls back to the raw package.json
 * version when git history isn't available.
 */
export function appVersion(gitExec: GitExec = runGit, readPkg: () => string = readRootPkg): string {
  const base = pkgVersion(readPkg);
  const count = gitCommitCount(gitExec);
  if (count === null || count === '') return base;
  const [major = '0', minor = '0'] = base.split('.');
  return `${major}.${minor}.${count}`;
}

function readRootPkg(): string {
  const pkgUrl = new URL('../../../package.json', import.meta.url);
  return readFileSync(pkgUrl, 'utf8');
}
