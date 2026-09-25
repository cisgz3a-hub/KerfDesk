import { describe, expect, it } from 'vitest';
import type { RecentFileRef } from '../../platform/types';
import {
  canPinAnother,
  clampRecentProjectLimit,
  clearUnpinnedRecentProjects,
  DEFAULT_RECENT_PROJECT_LIMIT,
  MAX_PINNED_RECENT_PROJECTS,
  MAX_RECENT_PROJECT_LIMIT,
  orderRecentProjects,
  preferredRecentRef,
  recentProjectFolder,
  recordRecentProjectUse,
  removeRecentProject,
  sameRecentProjectName,
  setRecentProjectPinned,
  trimRecentProjects,
  type RecentProjectEntry,
} from './recent-project-model';

function entry(id: string, lastUsedAt: number, extra: Partial<RecentProjectEntry> = {}) {
  return { id, name: `${id}.lf2`, ref: null, pinned: false, lastUsedAt, ...extra };
}

function handleRef(name: string): RecentFileRef {
  return { kind: 'handle', handle: { kind: 'file', name } as FileSystemFileHandle };
}

const PATH_REF: RecentFileRef = {
  kind: 'desktop-path',
  path: 'C:\\Jobs\\sign.lf2',
  token: 'a'.repeat(43),
};

const ids = (entries: ReadonlyArray<RecentProjectEntry>) => entries.map((item) => item.id);

describe('Recent Projects list rules', () => {
  it('keeps 10 by default and never more than LightBurn allows', () => {
    expect(DEFAULT_RECENT_PROJECT_LIMIT).toBe(10);
    expect(MAX_RECENT_PROJECT_LIMIT).toBe(24);
    expect(clampRecentProjectLimit(99)).toBe(24);
    expect(clampRecentProjectLimit(0)).toBe(1);
    expect(clampRecentProjectLimit(-3)).toBe(1);
    expect(clampRecentProjectLimit(3.6)).toBe(4);
    expect(clampRecentProjectLimit(Number.NaN)).toBe(10);
    expect(clampRecentProjectLimit('12')).toBe(10);
  });

  it('lists pinned projects first, then the most recently used', () => {
    const entries = [entry('a', 1), entry('b', 3), entry('c', 2, { pinned: true }), entry('d', 4)];
    expect(ids(orderRecentProjects(entries))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('drops the oldest unpinned project past the limit and keeps every pinned one', () => {
    const entries = [
      entry('old-pin', 1, { pinned: true }),
      entry('a', 2),
      entry('b', 3),
      entry('c', 4),
    ];
    expect(ids(trimRecentProjects(entries, 2))).toEqual(['old-pin', 'c', 'b']);
  });

  it('puts a newly opened project on top and caps the list', () => {
    let entries: ReadonlyArray<RecentProjectEntry> = [];
    for (let index = 1; index <= 12; index += 1) {
      entries = recordRecentProjectUse(
        entries,
        { name: `p${index}.lf2`, ref: null, usedAt: index },
        null,
        `p${index}`,
        DEFAULT_RECENT_PROJECT_LIMIT,
      );
    }
    expect(entries).toHaveLength(10);
    expect(entries[0]?.id).toBe('p12');
    expect(ids(entries)).not.toContain('p1');
    expect(ids(entries)).not.toContain('p2');
  });

  it('moves a reopened project to the top without duplicating it', () => {
    const entries = [entry('b', 7), entry('a', 5, { ref: handleRef('a.lf2') })];
    const reopened = handleRef('a.lf2');
    const next = recordRecentProjectUse(
      entries,
      { name: 'a.lf2', ref: reopened, usedAt: 9 },
      'a',
      'unused',
      10,
    );
    expect(ids(next)).toEqual(['a', 'b']);
    expect(next[0]).toEqual({
      id: 'a',
      name: 'a.lf2',
      ref: reopened,
      pinned: false,
      lastUsedAt: 9,
    });
  });

  it('keeps a reopened project pinned and follows a change in its name', () => {
    const entries = [entry('p', 1, { pinned: true }), entry('x', 5)];
    const next = recordRecentProjectUse(
      entries,
      { name: 'P.lf2', ref: null, usedAt: 9 },
      'p',
      'unused',
      10,
    );
    expect(ids(next)).toEqual(['p', 'x']);
    expect(next[0]).toMatchObject({ name: 'P.lf2', pinned: true, lastUsedAt: 9 });
  });

  it('keeps a desktop path over a picker handle for the same file', () => {
    expect(preferredRecentRef(PATH_REF, handleRef('sign.lf2'))).toBe(PATH_REF);
    const handle = handleRef('sign.lf2');
    expect(preferredRecentRef(handleRef('old.lf2'), handle)).toBe(handle);
    expect(preferredRecentRef(null, PATH_REF)).toBe(PATH_REF);
    expect(preferredRecentRef(PATH_REF, null)).toBe(PATH_REF);
  });

  it('pins, unpins, and refuses a pin beyond the pinned ceiling', () => {
    const pinned = setRecentProjectPinned([entry('a', 1), entry('b', 2)], 'a', true);
    expect(pinned.find((item) => item.id === 'a')?.pinned).toBe(true);
    expect(setRecentProjectPinned(pinned, 'a', false).every((item) => !item.pinned)).toBe(true);

    const full = Array.from({ length: MAX_PINNED_RECENT_PROJECTS }, (_, index) =>
      entry(`pin${index}`, index, { pinned: true }),
    );
    const withExtra = [...full, entry('extra', 100)];
    expect(canPinAnother(withExtra)).toBe(false);
    expect(setRecentProjectPinned(withExtra, 'extra', true)).toBe(withExtra);
    expect(canPinAnother(setRecentProjectPinned(withExtra, 'pin0', false))).toBe(true);
  });

  it('removes one entry, or every unpinned one', () => {
    const entries = [entry('a', 1), entry('b', 2, { pinned: true }), entry('c', 3)];
    expect(ids(removeRecentProject(entries, 'c'))).toEqual(['a', 'b']);
    expect(ids(clearUnpinnedRecentProjects(entries))).toEqual(['b']);
  });

  it('shows the folder only for a path the desktop app knows', () => {
    expect(recentProjectFolder(entry('a', 1, { ref: PATH_REF }))).toBe('C:\\Jobs');
    const rootRef = { ...PATH_REF, path: 'C:\\sign.lf2' };
    expect(recentProjectFolder(entry('a', 1, { ref: rootRef }))).toBe('C:\\');
    const shareRef = { ...PATH_REF, path: '\\\\shop\\jobs\\sign.lf2' };
    expect(recentProjectFolder(entry('a', 1, { ref: shareRef }))).toBe('\\\\shop\\jobs');
    const macRef = { ...PATH_REF, path: '/Users/ann/sign.lf2' };
    expect(recentProjectFolder(entry('a', 1, { ref: macRef }))).toBe('/Users/ann');
    expect(recentProjectFolder(entry('a', 1, { ref: { ...PATH_REF, path: '/a.lf2' } }))).toBe('/');
    expect(recentProjectFolder(entry('a', 1, { ref: handleRef('a.lf2') }))).toBeNull();
    expect(recentProjectFolder(entry('a', 1))).toBeNull();
  });

  it('compares project names the way Windows and macOS file systems do', () => {
    expect(sameRecentProjectName('Sign.LF2', 'sign.lf2')).toBe(true);
    expect(sameRecentProjectName('sign.lf2', 'sign2.lf2')).toBe(false);
  });
});
