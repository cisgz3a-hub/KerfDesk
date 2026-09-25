// Where Recent Projects lives (ADR-378): this workstation's IndexedDB, never a
// project file. IndexedDB is the one browser store that keeps a File System
// Access handle across restarts. A browser that cannot store a handle keeps
// the entry's name only, and reopening it goes through the file picker.

import type { RecentFileRef } from '../../platform/types';
import { browserLocalStorage } from '../state/browser-local-storage';
import {
  clampRecentProjectLimit,
  DEFAULT_RECENT_PROJECT_LIMIT,
  type RecentProjectEntry,
} from './recent-project-model';

const DATABASE_NAME = 'kerfdesk-recent-projects';
const DATABASE_VERSION = 1;
const STORE = 'lists';
const LIST_KEY = 'recent-projects';
const LIST_VERSION = 1;
const LIMIT_KEY = 'kerfdesk.recent-projects.limit.v1';

type Entries = ReadonlyArray<RecentProjectEntry>;

export type RecentProjectStorage = {
  readonly load: () => Promise<Entries>;
  /** Apply a change to the stored list inside one transaction, so two windows
   * recording at the same moment both land. Resolves with the changed list. */
  readonly update: (change: (entries: Entries) => Entries) => Promise<Entries>;
};

export function createMemoryRecentProjectStorage(initial: Entries = []): RecentProjectStorage {
  let entries = initial;
  return {
    load: async () => entries,
    update: async (change) => {
      entries = change(entries);
      return entries;
    },
  };
}

export function createIndexedDbRecentProjectStorage(factory: IDBFactory): RecentProjectStorage {
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    database ??= openDatabase(factory).catch((error: unknown) => {
      database = null;
      throw error;
    });
    return database;
  };
  return {
    load: async () => readList(await open()),
    update: async (change) => changeList(await open(), change),
  };
}

/** IndexedDB when the browser offers it. Where it is missing or refuses (a
 * locked-down profile), the list lasts for this session only. */
export function defaultRecentProjectStorage(): RecentProjectStorage {
  const factory = indexedDbFactory();
  const memory = createMemoryRecentProjectStorage();
  if (factory === null) return memory;
  const primary = createIndexedDbRecentProjectStorage(factory);
  let failed = false;
  const run = async (action: (storage: RecentProjectStorage) => Promise<Entries>) => {
    if (failed) return action(memory);
    try {
      return await action(primary);
    } catch {
      failed = true;
      return action(memory);
    }
  };
  return { load: () => run((s) => s.load()), update: (change) => run((s) => s.update(change)) };
}

export function loadRecentProjectLimit(): number {
  try {
    const raw = browserLocalStorage()?.getItem(LIMIT_KEY);
    return raw === null || raw === undefined
      ? DEFAULT_RECENT_PROJECT_LIMIT
      : clampRecentProjectLimit(Number(raw));
  } catch {
    return DEFAULT_RECENT_PROJECT_LIMIT;
  }
}

export function saveRecentProjectLimit(limit: number): void {
  try {
    browserLocalStorage()?.setItem(LIMIT_KEY, String(clampRecentProjectLimit(limit)));
  } catch {
    // A denied storage keeps the setting for this session only.
  }
}

function indexedDbFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Recent Projects storage failed.'));
    request.onblocked = () => reject(new Error('Recent Projects storage is blocked.'));
  });
}

function readList(database: IDBDatabase): Promise<Entries> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(LIST_KEY);
    request.onsuccess = () => resolve(decodeList(request.result));
    request.onerror = () => reject(request.error ?? new Error('Recent Projects read failed.'));
  });
}

function changeList(
  database: IDBDatabase,
  change: (entries: Entries) => Entries,
): Promise<Entries> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let next: Entries = [];
    const request = store.get(LIST_KEY);
    request.onsuccess = () => {
      next = change(decodeList(request.result));
      putList(store, next);
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Recent Projects update failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Recent Projects update was aborted.'));
  });
}

function putList(store: IDBObjectStore, entries: Entries): void {
  try {
    store.put({ version: LIST_VERSION, entries: entries.map(storedEntry) }, LIST_KEY);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'DataCloneError') throw error;
    // This browser cannot keep file handles; remember the names.
    store.put({ version: LIST_VERSION, entries: entries.map(nameOnlyEntry) }, LIST_KEY);
  }
}

function storedEntry(entry: RecentProjectEntry): RecentProjectEntry {
  return {
    id: entry.id,
    name: entry.name,
    ref: entry.ref,
    pinned: entry.pinned,
    lastUsedAt: entry.lastUsedAt,
  };
}

function nameOnlyEntry(entry: RecentProjectEntry): RecentProjectEntry {
  return { ...storedEntry(entry), ref: entry.ref?.kind === 'handle' ? null : entry.ref };
}

function decodeList(value: unknown): Entries {
  if (!isRecord(value) || value['version'] !== LIST_VERSION) return [];
  const raw = value['entries'];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: RecentProjectEntry[] = [];
  for (const item of raw) {
    const entry = decodeEntry(item);
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function decodeEntry(value: unknown): RecentProjectEntry | null {
  if (!isRecord(value)) return null;
  const { id, name, pinned, lastUsedAt } = value;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') return null;
  if (typeof pinned !== 'boolean' || typeof lastUsedAt !== 'number') return null;
  if (!Number.isFinite(lastUsedAt)) return null;
  const ref = decodeRef(value['ref']);
  return ref === undefined ? null : { id, name, ref, pinned, lastUsedAt };
}

/** undefined: malformed. null: a name-only entry. */
function decodeRef(value: unknown): RecentFileRef | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value['kind'] === 'handle') {
    const handle = value['handle'];
    return isRecord(handle) && handle['kind'] === 'file' && typeof handle['name'] === 'string'
      ? { kind: 'handle', handle: handle as unknown as FileSystemFileHandle }
      : undefined;
  }
  const { path, token } = value;
  if (value['kind'] !== 'desktop-path' || typeof path !== 'string' || path === '') return undefined;
  return typeof token === 'string' ? { kind: 'desktop-path', path, token } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
