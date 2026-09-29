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

/** The browser's IndexedDB, installed as the global, that can refuse the way a
 * busy or briefly locked profile does: `refuse()` drops every open connection
 * and refuses new ones until `allow()`. */
function unreliableIndexedDb(factory: IDBFactory) {
  let refusing = false;
  const connections: IDBDatabase[] = [];
  vi.stubGlobal('indexedDB', {
    open: (name: string, version?: number) => {
      if (refusing) throw new DOMException('Storage is busy', 'UnknownError');
      const request = factory.open(name, version);
      request.addEventListener('success', () => connections.push(request.result));
      return request;
    },
  });
  return {
    connections,
    refuse: () => {
      refusing = true;
      for (const connection of connections) connection.close();
    },
    allow: () => {
      refusing = false;
    },
  };
}

const stored = (factory: IDBFactory) => createIndexedDbRecentProjectStorage(factory).load();

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

  it('tries IndexedDB again after a refusal and stores what was recorded meanwhile', async () => {
    const factory = new FakeIDBFactory();
    await createIndexedDbRecentProjectStorage(factory).update(() => [entry('saved')]);
    const indexedDb = unreliableIndexedDb(factory);
    const storage = defaultRecentProjectStorage();

    indexedDb.refuse();
    expect(await storage.load()).toEqual([]);
    await storage.update((entries) => [entry('meanwhile'), ...entries]);

    indexedDb.allow();
    expect(await storage.load()).toEqual([entry('meanwhile'), entry('saved')]);
    // A reload finds both: nothing recorded during the refusal was lost.
    expect(await stored(factory)).toEqual([entry('meanwhile'), entry('saved')]);
  });

  it('keeps showing the list when the browser drops the connection, then merges', async () => {
    const factory = new FakeIDBFactory();
    const indexedDb = unreliableIndexedDb(factory);
    const storage = defaultRecentProjectStorage();
    await storage.update(() => [entry('a')]);

    indexedDb.connections[0]?.close();
    expect(await storage.update((entries) => [entry('b'), ...entries])).toEqual([
      entry('b'),
      entry('a'),
    ]);
    // Another window records a project before this one can store again.
    await createIndexedDbRecentProjectStorage(factory).update((e) => [entry('other'), ...e]);

    expect(await storage.load()).toEqual([entry('b'), entry('other'), entry('a')]);
    expect(await stored(factory)).toEqual([entry('b'), entry('other'), entry('a')]);
    expect(indexedDb.connections).toHaveLength(2);
  });

  it('reports once, and stops trying, only when IndexedDB keeps refusing', async () => {
    const factory = new FakeIDBFactory();
    const indexedDb = unreliableIndexedDb(factory);
    const onUnavailable = vi.fn();
    const storage = defaultRecentProjectStorage({ onUnavailable });

    indexedDb.refuse();
    await storage.load();
    indexedDb.allow();
    await storage.update(() => [entry('a')]);
    indexedDb.refuse();
    await storage.load();
    await storage.update((entries) => [entry('b'), ...entries]);
    expect(onUnavailable).not.toHaveBeenCalled();

    await storage.load();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    indexedDb.allow();
    // The list still lasts for this session; IndexedDB is left alone.
    expect(await storage.update((entries) => [entry('c'), ...entries])).toEqual([
      entry('c'),
      entry('b'),
      entry('a'),
    ]);
    expect(await storage.load()).toEqual([entry('c'), entry('b'), entry('a')]);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(await stored(factory)).toEqual([entry('a')]);
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
