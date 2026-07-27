import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appVersion,
  buildTimeIso,
  gitShortSha,
  resolveBuildAppVersion,
  type GitExec,
} from './build-info';

// D-S02-001: prove build-time metadata is derived from commit data (git %cI),
// NOT wall-clock — so re-deploying the same commit yields a byte-identical
// bundle (ADR-060). We stub the injected git-exec and assert determinism plus
// that no wall-clock API is touched on the git-history path.

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT_ISO = '2026-07-03T12:34:56+02:00';
const COMMIT_ISO_UTC = new Date(COMMIT_ISO).toISOString();

function gitStub(map: Record<string, string>): GitExec {
  return (args) => {
    const key = args.join(' ');
    const value = map[key];
    if (value === undefined) throw new Error(`unexpected git args: ${key}`);
    return value;
  };
}

describe('buildTimeIso', () => {
  it('derives the timestamp from the commit date (%cI), normalized to UTC', () => {
    const gitExec = gitStub({ 'show -s --format=%cI HEAD': COMMIT_ISO });

    expect(buildTimeIso(gitExec)).toBe(COMMIT_ISO_UTC);
  });

  it('is deterministic — two invocations for the same commit are identical', () => {
    const gitExec = gitStub({ 'show -s --format=%cI HEAD': COMMIT_ISO });

    expect(buildTimeIso(gitExec)).toBe(buildTimeIso(gitExec));
  });

  it('never reads the wall clock when git history is present', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const gitExec = gitStub({ 'show -s --format=%cI HEAD': COMMIT_ISO });

    buildTimeIso(gitExec);

    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('falls back to wall-clock only when git history is absent', () => {
    const gitExec: GitExec = () => {
      throw new Error('not a git repository');
    };

    // The fallback path is the ONLY place a wall-clock value may appear; assert
    // it produces a valid ISO string rather than throwing.
    expect(() => new Date(buildTimeIso(gitExec)).toISOString()).not.toThrow();
  });
});

describe('gitShortSha', () => {
  it('returns the short SHA from git', () => {
    expect(gitShortSha(gitStub({ 'rev-parse --short HEAD': 'abc1234' }))).toBe('abc1234');
  });

  it('falls back to "dev" when git is unavailable', () => {
    const gitExec: GitExec = () => {
      throw new Error('no git');
    };

    expect(gitShortSha(gitExec)).toBe('dev');
  });
});

describe('appVersion', () => {
  const readPkg = () => JSON.stringify({ version: '2.5.9' });

  it('combines package MAJOR.MINOR with the git commit count as patch', () => {
    const gitExec = gitStub({ 'rev-list --count HEAD': '412' });

    expect(appVersion(gitExec, readPkg)).toBe('2.5.412');
  });

  it('is deterministic for the same commit', () => {
    const gitExec = gitStub({ 'rev-list --count HEAD': '412' });

    expect(appVersion(gitExec, readPkg)).toBe(appVersion(gitExec, readPkg));
  });

  it('falls back to the raw package version without git history', () => {
    const gitExec: GitExec = () => {
      throw new Error('no git');
    };

    expect(appVersion(gitExec, readPkg)).toBe('2.5.9');
  });
});

describe('resolveBuildAppVersion', () => {
  it('uses the exact desktop release version instead of the web commit-count version', () => {
    expect(resolveBuildAppVersion('0.1.822', '1.2.3')).toBe('1.2.3');
    expect(resolveBuildAppVersion('0.1.822', '0.2.0-preview.14')).toBe('0.2.0-preview.14');
    expect(resolveBuildAppVersion('0.1.822', '0.0.0-dispatch.302')).toBe('0.0.0-dispatch.302');
  });

  it('preserves the deterministic web version when no desktop release version is supplied', () => {
    expect(resolveBuildAppVersion('0.1.822', undefined)).toBe('0.1.822');
  });

  it('rejects malformed desktop release versions instead of shipping ambiguous identity', () => {
    expect(() => resolveBuildAppVersion('0.1.822', 'v0.2.0-preview.14')).toThrow(
      /desktop release version/,
    );
    expect(() => resolveBuildAppVersion('0.1.822', '0.2.0-preview.01')).toThrow(
      /desktop release version/,
    );
  });
});
