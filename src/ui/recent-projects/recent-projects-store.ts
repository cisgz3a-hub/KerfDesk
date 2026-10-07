// Recent Projects state (ADR-378): the workstation's list, what is known about
// each file right now, and the manager dialog. Every change goes through the
// storage's transaction and then replaces the in-memory list, one change at a
// time, so a slow identity check can never interleave two updates.

import { create } from 'zustand';
import type { RecentFileAdapter, RecentFileRef } from '../../platform/types';
import { useToastStore } from '../state/toast-store';
import { hasPendingComputerPreference } from '../state/preference-persistence';
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
  RECENT_PROJECT_LIMIT_KEY,
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

/** Shown once, when this computer's storage keeps refusing the list. */
export const RECENT_PROJECTS_UNSAVED_MESSAGE =
  'Recent Projects could not be saved for next session (browser storage is full or blocked). ' +
  'The list is kept until KerfDesk closes.';

let storage: RecentProjectStorage | null = null;
let pending: Promise<unknown> = Promise.resolve();
let committedLimit = loadRecentProjectLimit();

function currentStorage(): RecentProjectStorage {
  storage ??= defaultRecentProjectStorage({
    onUnavailable: () =>
      useToastStore.getState().pushToast(RECENT_PROJECTS_UNSAVED_MESSAGE, 'warning'),
  });
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
        const entries = await currentStorage().load();
        if (hasPendingComputerPreference(RECENT_PROJECT_LIMIT_KEY)) {
          set({ entries });
        } else {
          committedLimit = loadRecentProjectLimit();
          set({ entries, limit: committedLimit });
        }
      }),
    record: (files, use) =>
      serialize(async () => {
        const matchId = await sameFileEntry(files, await currentStorage().load(), use);
        const id = matchId ?? newRecentProjectId();
        const usedAt = Date.now();
        const entries = await currentStorage().update((current) =>
          recordRecentProjectUse(current, { ...use, usedAt }, matchId, id, committedLimit),
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
      set({ limit: next });
      let trimming = Promise.resolve();
      saveRecentProjectLimit(next, () => {
        committedLimit = next;
        trimming = apply((entries) => trimRecentProjects(entries, next));
        void trimming.catch(() =>
          useToastStore
            .getState()
            .pushToast(
              'The recent-project limit was saved, but the list could not be updated. Reopen Recent Projects to retry.',
              'warning',
            ),
        );
      });
      return trimming;
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
  committedLimit = loadRecentProjectLimit();
  useRecentProjectsStore.setState({
    entries: [],
    limit: loadRecentProjectLimit(),
    statuses: {},
    dialogOpen: false,
    notice: null,
  });
}
