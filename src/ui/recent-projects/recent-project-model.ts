// Recent Projects list rules (ADR-378). Pure functions over the stored list;
// the store and storage modules decide when to run them.
//
// LightBurn keeps a fixed-length most-recent list. KerfDesk adds pinning:
// pinned projects stay at the top and never fall off, and the length setting
// counts only unpinned entries, so a new open always has a place.

import type { RecentFileRef } from '../../platform/types';

export const DEFAULT_RECENT_PROJECT_LIMIT = 10;
/** LightBurn's ceiling: "a running list of up to 24 projects recently opened"
 * (https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/). */
export const MAX_RECENT_PROJECT_LIMIT = 24;
export const MAX_PINNED_RECENT_PROJECTS = MAX_RECENT_PROJECT_LIMIT;

export type RecentProjectEntry = {
  readonly id: string;
  readonly name: string;
  /** null: only the name is known, so reopening needs the file picker. */
  readonly ref: RecentFileRef | null;
  readonly pinned: boolean;
  /** Last opened or saved, in epoch milliseconds. */
  readonly lastUsedAt: number;
};

export type RecentProjectUse = {
  readonly name: string;
  readonly ref: RecentFileRef | null;
  readonly usedAt: number;
};

export function clampRecentProjectLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECENT_PROJECT_LIMIT;
  return Math.min(MAX_RECENT_PROJECT_LIMIT, Math.max(1, Math.round(value)));
}

/** Pinned first, then everything else; newest first within each group. */
export function orderRecentProjects(
  entries: ReadonlyArray<RecentProjectEntry>,
): ReadonlyArray<RecentProjectEntry> {
  return [...entries].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) || right.lastUsedAt - left.lastUsedAt,
  );
}

/** Keep every pinned entry and the newest `limit` unpinned ones. */
export function trimRecentProjects(
  entries: ReadonlyArray<RecentProjectEntry>,
  limit: number,
): ReadonlyArray<RecentProjectEntry> {
  let unpinned = 0;
  return orderRecentProjects(entries).filter((entry) => {
    if (entry.pinned) return true;
    unpinned += 1;
    return unpinned <= limit;
  });
}

/** Move an opened or saved file to the top. `matchId` is the entry already
 * known to be the same file, found by the platform's identity check. */
export function recordRecentProjectUse(
  entries: ReadonlyArray<RecentProjectEntry>,
  use: RecentProjectUse,
  matchId: string | null,
  newId: string,
  limit: number,
): ReadonlyArray<RecentProjectEntry> {
  const existing = entries.find((entry) => entry.id === matchId);
  const updated: RecentProjectEntry =
    existing === undefined
      ? { id: newId, name: use.name, ref: use.ref, pinned: false, lastUsedAt: use.usedAt }
      : {
          ...existing,
          name: use.name,
          ref: preferredRecentRef(existing.ref, use.ref),
          lastUsedAt: use.usedAt,
        };
  const others = entries.filter((entry) => entry.id !== updated.id);
  return trimRecentProjects([updated, ...others], limit);
}

/** A desktop path survives restarts without a permission prompt and shows the
 * folder, so a handle for the same file never replaces it. */
export function preferredRecentRef(
  existing: RecentFileRef | null,
  incoming: RecentFileRef | null,
): RecentFileRef | null {
  if (incoming === null) return existing;
  if (existing?.kind === 'desktop-path' && incoming.kind === 'handle') return existing;
  return incoming;
}

export function setRecentProjectPinned(
  entries: ReadonlyArray<RecentProjectEntry>,
  id: string,
  pinned: boolean,
): ReadonlyArray<RecentProjectEntry> {
  if (pinned && !canPinAnother(entries)) return entries;
  return entries.map((entry) => (entry.id === id ? { ...entry, pinned } : entry));
}

export function canPinAnother(entries: ReadonlyArray<RecentProjectEntry>): boolean {
  return entries.filter((entry) => entry.pinned).length < MAX_PINNED_RECENT_PROJECTS;
}

export function removeRecentProject(
  entries: ReadonlyArray<RecentProjectEntry>,
  id: string,
): ReadonlyArray<RecentProjectEntry> {
  return entries.filter((entry) => entry.id !== id);
}

/** Pinned entries stay until they are unpinned or removed one by one. */
export function clearUnpinnedRecentProjects(
  entries: ReadonlyArray<RecentProjectEntry>,
): ReadonlyArray<RecentProjectEntry> {
  return entries.filter((entry) => entry.pinned);
}

/** The folder is known only for files the desktop operating system opened;
 * a browser never reveals where a picked file lives. */
export function recentProjectFolder(entry: RecentProjectEntry): string | null {
  if (entry.ref?.kind !== 'desktop-path') return null;
  const path = entry.ref.path;
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  if (cut < 0) return null;
  // Keep the root separator: "C:\" and "/" are folders too.
  return cut === 0 || path[cut - 1] === ':' ? path.slice(0, cut + 1) : path.slice(0, cut);
}

export function sameRecentProjectName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
