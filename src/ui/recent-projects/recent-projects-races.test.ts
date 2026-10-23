import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RecentFileAdapter, RecentFileProbe } from '../../platform/types';
import {
  createIndexedDbRecentProjectStorage,
  createFallbackRecentProjectStorage,
  createMemoryRecentProjectStorage,
  RECENT_PROJECT_LIMIT_KEY,
} from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';

const files: RecentFileAdapter = {
  open: async () => ({ kind: 'missing' }),
  probe: async () => ({ kind: 'unknown' }),
  isSameFile: async (a, b) =>
    a.kind === 'desktop-path' && b.kind === 'desktop-path' && a.path === b.path,
};
const use = (name: string, folder = 'one') => ({
  name: `${name}.lf2`,
  ref: { kind: 'desktop-path' as const, path: `C:/${folder}/${name}.lf2`, token: 'a'.repeat(43) },
});
const store = () => useRecentProjectsStore.getState();
const extraStores: Array<{
  readonly configureRecentProjectsForTests: typeof configureRecentProjectsForTests;
}> = [];

beforeEach(() => {
  localStorage.removeItem(RECENT_PROJECT_LIMIT_KEY);
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
});
afterEach(() => {
  for (const module of extraStores) module.configureRecentProjectsForTests(null);
  extraStores.length = 0;
  configureRecentProjectsForTests(null);
  localStorage.removeItem(RECENT_PROJECT_LIMIT_KEY);
  vi.restoreAllMocks();
});

it('keeps an unidentified drop separate from a known same-named file', async () => {
  await store().record(files, use('part'));
  await store().record(files, { name: 'part.lf2', ref: null });
  expect(store().entries).toHaveLength(2);
  expect(store().entries[0]?.ref).toBeNull();
  expect(store().entries[1]?.ref).toEqual(use('part').ref);
});

it('does not publish an old probe after a successful read or a newer probe', async () => {
  await store().record(files, use('part'));
  const id = store().entries[0]!.id;
  let release!: (probe: RecentFileProbe) => void;
  const probe = vi.fn(
    () =>
      new Promise<RecentFileProbe>((resolve) => {
        release = resolve;
      }),
  );
  const older = store().probe({ ...files, probe });
  store().setStatus(id, 'present');
  release({ kind: 'missing' });
  await older;
  expect(store().statuses[id]).toBe('present');
  const oldest = store().probe({ ...files, probe });
  await store().probe({
    ...files,
    probe: async () => ({ kind: 'present', size: 1, modifiedMs: 1 }),
  });
  release({ kind: 'missing' });
  await oldest;
  expect(store().statuses[id]).toBe('present');
});

it('trims an unpinned entry immediately using the persisted cap', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  await store().setLimit(1);
  await store().record(files, use('older'));
  const id = store().entries[0]!.id;
  await store().setPinned(id, true);
  now.mockReturnValue(2_000);
  await store().record(files, use('newer'));
  await store().setPinned(id, false);
  await store().refresh();
  expect(store().entries.map((entry) => entry.name)).toEqual(['newer.lf2']);
});

it.each([false, true])(
  'rechecks same-file identity after a concurrent insert (same: %s)',
  async (same) => {
    const factory = new IDBFactory();
    const persisted = createIndexedDbRecentProjectStorage(factory);
    let ready = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = () => {
      const adapter = createIndexedDbRecentProjectStorage(factory);
      return {
        ...adapter,
        load: async () => {
          const entries = await adapter.load();
          ready += 1;
          if (ready === 2) release();
          await gate;
          return entries;
        },
      };
    };
    vi.resetModules();
    const left = await import('./recent-projects-store');
    extraStores.push(left);
    left.configureRecentProjectsForTests(storage());
    vi.resetModules();
    const right = await import('./recent-projects-store');
    extraStores.push(right);
    right.configureRecentProjectsForTests(storage());
    await Promise.all([
      left.useRecentProjectsStore.getState().record(files, use('part')),
      right.useRecentProjectsStore.getState().record(files, use('part', same ? 'one' : 'two')),
    ]);
    const entries = await persisted.load();
    expect(entries).toHaveLength(same ? 1 : 2);
  },
);

it.each([
  [1, 3, 2],
  [24, 1, 1],
])('uses a cap changed by another window: %i -> %i', async (before, after, expected) => {
  localStorage.setItem(RECENT_PROJECT_LIMIT_KEY, String(before));
  const persisted = createIndexedDbRecentProjectStorage(new IDBFactory());
  configureRecentProjectsForTests(persisted);
  await store().record(files, use('a'));
  // A different window persists its choice while this store remains mounted.
  localStorage.setItem(RECENT_PROJECT_LIMIT_KEY, String(after));
  await store().record(files, use('b'));
  expect(await persisted.load()).toHaveLength(expected);
  expect(store().limit).toBe(after);
});

it("replays a refused conditional record alongside another window's new entry", async () => {
  const persisted = createIndexedDbRecentProjectStorage(new IDBFactory());
  let refusing = false;
  const fallback = createFallbackRecentProjectStorage({
    load: async () => {
      if (refusing) throw new Error('temporarily unavailable');
      return persisted.load();
    },
    update: async (change) => {
      if (refusing) throw new Error('temporarily unavailable');
      return persisted.update(change);
    },
  });
  configureRecentProjectsForTests(fallback);
  await store().refresh();
  refusing = true;
  await store().record(files, use('local'));
  expect(store().entries.map((entry) => entry.name)).toEqual(['local.lf2']);
  await persisted.update(() => [
    {
      id: 'other-window',
      ...use('remote'),
      lastUsedAt: 1,
      pinned: false,
    },
  ]);
  refusing = false;
  await store().refresh();
  expect((await persisted.load()).map((entry) => entry.name)).toEqual(['local.lf2', 'remote.lf2']);
});
