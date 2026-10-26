import type { RecentFileRef } from '../../platform/types';
import type { RecentProjectEntry } from './recent-project-model';
import type { RecentProjectStorage } from './recent-project-storage';

type Entries = ReadonlyArray<RecentProjectEntry>;
export type RecentProjectConditionalUpdate = {
  readonly applied: boolean;
  readonly entries: Entries;
};

/** Identity checks can await a browser handle outside IndexedDB. Commit only
 * against the list they inspected; another window's insert requires a retry. */
export async function updateRecentProjectsIfUnchanged(
  storage: RecentProjectStorage,
  expected: Entries,
  change: (entries: Entries) => Entries,
): Promise<RecentProjectConditionalUpdate> {
  if (storage.updateIfUnchanged !== undefined) return storage.updateIfUnchanged(expected, change);
  let applied = false;
  const entries = await storage.update((current) => {
    applied = sameRecentProjectSnapshot(current, expected);
    return applied ? change(current) : current;
  });
  return { applied, entries };
}

export function sameRecentProjectSnapshot(left: Entries, right: Entries): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        entry.id === other.id &&
        entry.name === other.name &&
        entry.pinned === other.pinned &&
        entry.lastUsedAt === other.lastUsedAt &&
        sameRefSnapshot(entry.ref, other.ref)
      );
    })
  );
}

function sameRefSnapshot(left: RecentFileRef | null, right: RecentFileRef | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind === 'desktop-path' && right.kind === 'desktop-path') {
    return left.path === right.path && left.token === right.token;
  }
  // Handles are structured-cloned on every read. An entry's non-null file
  // identity never changes: a different file always receives a different id.
  return (
    left.kind === 'handle' && right.kind === 'handle' && left.handle.name === right.handle.name
  );
}
