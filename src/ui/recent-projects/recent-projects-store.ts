// Recent Projects state (ADR-378): the workstation's list, what is known about
// each file right now, and the manager dialog. Every change goes through the
// storage's transaction and then replaces the in-memory list, one change at a
// time, so a slow identity check can never interleave two updates.

import { create } from 'zustand';
import type { RecentFileAdapter, RecentFileRef } from '../../platform/types';
import {
  clampRecentProjectLimit,
  clearUnpinnedRecentProjects,
  recordRecentProjectUse,
  removeRecentProject,
  sameRecentProjectName,
  setRecentProjectPinned,
  trimRecentProjects,
  type RecentProjectEntry,
} from './recent-project-model';
import {
  defaultRecentProjectStorage,
  loadRecentProjectLimit,
  saveRecentProjectLimit,
  type RecentProjectStorage,
} from './recent-project-storage';

export type RecentProjectStatus = 'present' | 'missing';

export type RecentProjectsNotice = {
  readonly message: string;
  /** The file must be chosen again: offer File > Open next to the message. */
  readonly offerPicker: boolean;
};

export type RecentProjectFileUse = {
  readonly name: string;
  readonly ref: RecentFileRef | null;
};

type Entries = ReadonlyArray<RecentProjectEntry>;

type RecentProjectsState = {
  readonly entries: Entries;
  readonly limit: number;
  /** Missing or present when last checked; absent while unknown. */
  readonly statuses: Readonly<Record<string, RecentProjectStatus>>;
  readonly dialogOpen: boolean;
  readonly notice: RecentProjectsNotice | null;
  readonly refresh: () => Promise<void>;
  readonly record: (files: RecentFileAdapter, use: RecentProjectFileUse) => Promise<void>;
  readonly probe: (files: RecentFileAdapter) => Promise<void>;
  readonly setPinned: (id: string, pinned: boolean) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly clearUnpinned: () => Promise<void>;
  readonly clearAll: () => Promise<void>;
  readonly setLimit: (limit: number) => Promise<void>;
  readonly setStatus: (id: string, status: RecentProjectStatus) => void;
  readonly openDialog: (notice?: RecentProjectsNotice) => void;
  readonly closeDialog: () => void;
};

let storage: RecentProjectStorage | null = null;
let pending: Promise<unknown> = Promise.resolve();

function currentStorage(): RecentProjectStorage {
  storage ??= defaultRecentProjectStorage();
  return storage;
}

/** One change at a time; a failed change never blocks the next. */
function serialize(change: () => Promise<void>): Promise<void> {
  const next = pending.then(change);
  pending = next.catch(() => undefined);
  return next;
}

export const useRecentProjectsStore = create<RecentProjectsState>((set, get) => {
  const apply = (change: (entries: Entries) => Entries): Promise<void> =>
    serialize(async () => {
      set({ entries: await currentStorage().update(change) });
    });
  return {
    entries: [],
    limit: loadRecentProjectLimit(),
    statuses: {},
    dialogOpen: false,
    notice: null,
    refresh: () =>
      serialize(async () => {
        set({ entries: await currentStorage().load(), limit: loadRecentProjectLimit() });
      }),
    record: (files, use) =>
      serialize(async () => {
        const matchId = await sameFileEntry(files, await currentStorage().load(), use);
        const id = matchId ?? newRecentProjectId();
        const usedAt = Date.now();
        const entries = await currentStorage().update((current) =>
          recordRecentProjectUse(current, { ...use, usedAt }, matchId, id, get().limit),
        );
        set({ entries, statuses: { ...get().statuses, [id]: 'present' } });
      }),
    probe: async (files) => {
      const checks = get().entries.map(async (entry) => {
        if (entry.ref === null) return;
        const found = await files.probe(entry.ref).catch(() => ({ kind: 'unknown' as const }));
        if (found.kind !== 'unknown') get().setStatus(entry.id, found.kind);
      });
      await Promise.all(checks);
    },
    setPinned: (id, pinned) => apply((entries) => setRecentProjectPinned(entries, id, pinned)),
    remove: (id) => apply((entries) => removeRecentProject(entries, id)),
    clearUnpinned: () => apply(clearUnpinnedRecentProjects),
    clearAll: () => apply(() => []),
    setLimit: (limit) => {
      const next = clampRecentProjectLimit(limit);
      saveRecentProjectLimit(next);
      set({ limit: next });
      return apply((entries) => trimRecentProjects(entries, next));
    },
    setStatus: (id, status) => set({ statuses: { ...get().statuses, [id]: status } }),
    openDialog: (notice) => set({ dialogOpen: true, notice: notice ?? null }),
    closeDialog: () => set({ dialogOpen: false, notice: null }),
  };
});

/** Reload the list, which another window may have changed, then check which
 * files are still there. Never asks the operator for permission. */
export async function reloadRecentProjects(files: RecentFileAdapter | undefined): Promise<void> {
  const store = useRecentProjectsStore.getState();
  await store.refresh();
  if (files !== undefined) await store.probe(files);
}

/** The entry that is this same file, if any. Only same-named entries can be,
 * so the platform's identity check runs for those alone. */
async function sameFileEntry(
  files: RecentFileAdapter,
  entries: Entries,
  use: RecentProjectFileUse,
): Promise<string | null> {
  for (const entry of entries) {
    if (!sameRecentProjectName(entry.name, use.name)) continue;
    // A name-only entry has nothing else to compare.
    if (entry.ref === null || use.ref === null) return entry.id;
    if (await files.isSameFile(entry.ref, use.ref).catch(() => false)) return entry.id;
  }
  return null;
}

function newRecentProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `recent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Swap the storage (tests use memory) and forget all state. */
export function configureRecentProjectsForTests(next: RecentProjectStorage | null): void {
  storage = next;
  pending = Promise.resolve();
  useRecentProjectsStore.setState({
    entries: [],
    limit: loadRecentProjectLimit(),
    statuses: {},
    dialogOpen: false,
    notice: null,
  });
}
