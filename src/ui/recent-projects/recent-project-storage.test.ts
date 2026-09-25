import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecentFileRef } from '../../platform/types';
import type { RecentProjectEntry } from './recent-project-model';
import {
  createIndexedDbRecentProjectStorage,
  createMemoryRecentProjectStorage,
  defaultRecentProjectStorage,
  loadRecentProjectLimit,
  saveRecentProjectLimit,
} from './recent-project-storage';

const LIMIT_KEY = 'kerfdesk.recent-projects.limit.v1';

const PATH_REF: RecentFileRef = {
  kind: 'desktop-path',
  path: 'C:\\Jobs\\sign.lf2',
  token: 'b'.repeat(43),
};

function entry(id: string, extra: Partial<RecentProjectEntry> = {}): RecentProjectEntry {
  return { id, name: `${id}.lf2`, ref: null, pinned: false, lastUsedAt: 1, ...extra };
}

function rawPut(factory: IDBFactory, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open('kerfdesk-recent-projects', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lists');
    request.onsuccess = () => {
      const transaction = request.result.transaction('lists', 'readwrite');
      transaction.objectStore('lists').put(value, 'recent-projects');
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('write failed'));
    };
    request.onerror = () => reject(request.error ?? new Error('open failed'));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(LIMIT_KEY);
});

describe('Recent Projects storage', () => {
  it('keeps the list in IndexedDB across page loads', async () => {
    const factory = new FakeIDBFactory();
    const first = createIndexedDbRecentProjectStorage(factory);
    await first.update(() => [entry('a', { ref: PATH_REF, pinned: true }), entry('b')]);

    const reloaded = createIndexedDbRecentProjectStorage(factory);
    expect(await reloaded.load()).toEqual([
      entry('a', { ref: PATH_REF, pinned: true }),
      entry('b'),
    ]);
  });

  it('lets two windows record at the same moment without losing either', async () => {
    const factory = new FakeIDBFactory();
    const left = createIndexedDbRecentProjectStorage(factory);
    const right = createIndexedDbRecentProjectStorage(factory);
    await Promise.all([
      left.update((entries) => [entry('left'), ...entries]),
      right.update((entries) => [entry('right'), ...entries]),
    ]);
    const stored = await left.load();
    expect(stored.map((item) => item.id).sort()).toEqual(['left', 'right']);
  });

  it('remembers only the name when this browser cannot store the file handle', async () => {
    const factory = new FakeIDBFactory();
    const storage = createIndexedDbRecentProjectStorage(factory);
    // A function cannot be structured-cloned, as some engines refuse handles.
    const handle = { kind: 'file', name: 'a.lf2', read: () => 'x' } as unknown;
    const ref = { kind: 'handle', handle } as RecentFileRef;
    const result = await storage.update(() => [entry('a', { ref }), entry('p', { ref: PATH_REF })]);

    expect(result).toHaveLength(2);
    expect(await storage.load()).toEqual([entry('a'), entry('p', { ref: PATH_REF })]);
  });

  it('ignores damaged records instead of failing', async () => {
    const factory = new FakeIDBFactory();
    await rawPut(factory, {
      version: 1,
      entries: [
        entry('good'),
        entry('good', { name: 'duplicate id.lf2' }),
        { id: '', name: 'x.lf2', ref: null, pinned: false, lastUsedAt: 1 },
        { ...entry('bad-time'), lastUsedAt: Number.POSITIVE_INFINITY },
        { ...entry('bad-ref'), ref: { kind: 'desktop-path', path: 'C:\\a.lf2' } },
        { ...entry('bad-handle'), ref: { kind: 'handle', handle: { kind: 'directory' } } },
        'not an entry',
      ],
    });
    expect(await createIndexedDbRecentProjectStorage(factory).load()).toEqual([entry('good')]);

    await rawPut(factory, { version: 99, entries: [entry('future')] });
    expect(await createIndexedDbRecentProjectStorage(factory).load()).toEqual([]);
  });

  it('falls back to this session only when IndexedDB refuses', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Blocked by policy', 'SecurityError');
      },
    });
    const storage = defaultRecentProjectStorage();
    expect(await storage.load()).toEqual([]);
    await storage.update(() => [entry('session')]);
    expect(await storage.load()).toEqual([entry('session')]);
  });

  it('works in memory for hosts without IndexedDB', async () => {
    const storage = createMemoryRecentProjectStorage([entry('a')]);
    expect(await storage.update((entries) => [...entries, entry('b')])).toHaveLength(2);
    expect((await storage.load()).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps the length setting on this computer, clamped to 1 to 24', () => {
    expect(loadRecentProjectLimit()).toBe(10);
    saveRecentProjectLimit(15);
    expect(localStorage.getItem(LIMIT_KEY)).toBe('15');
    expect(loadRecentProjectLimit()).toBe(15);
    saveRecentProjectLimit(400);
    expect(loadRecentProjectLimit()).toBe(24);
    localStorage.setItem(LIMIT_KEY, 'lots');
    expect(loadRecentProjectLimit()).toBe(10);
  });
});
