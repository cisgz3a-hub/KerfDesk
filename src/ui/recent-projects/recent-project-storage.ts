// Where Recent Projects lives (ADR-378): this workstation's IndexedDB, never a
// project file. IndexedDB is the one browser store that keeps a File System
// Access handle across restarts. A browser that cannot store a handle keeps
// the entry's name only, and reopening it goes through the file picker.

import type { RecentFileRef } from '../../platform/types';
import { browserLocalStorage } from '../state/browser-local-storage';
import { saveComputerPreference } from '../state/preference-persistence';
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
export const RECENT_PROJECT_LIMIT_KEY = 'kerfdesk.recent-projects.limit.v1';

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
  const forget = (connection: Promise<IDBDatabase>): void => {
    if (database === connection) database = null;
  };
  const open = (): Promise<IDBDatabase> => {
    const connection = openDatabase(factory, () => forget(connection));
    database = connection;
    connection.catch(() => forget(connection));
    return connection;
  };
  // A failed operation drops its connection, so the next one opens a new one:
  // a connection the browser closed (a version change, lost storage) never
  // works again.
  const run = async (action: (database: IDBDatabase) => Promise<Entries>): Promise<Entries> => {
    const connection = database ?? open();
    try {
      return await action(await connection);
    } catch (error) {
      forget(connection);
      void connection.then((opened) => opened.close()).catch(() => undefined);
      throw error;
    }
  };
  return { load: () => run(readList), update: (change) => run((db) => changeList(db, change)) };
}

/** Consecutive refusals after which IndexedDB is left alone for this session. */
export const RECENT_PROJECT_STORAGE_ATTEMPTS = 3;

export type RecentProjectStorageOptions = {
  /** Called once, when IndexedDB has refused so often that the list will last
   * for this session only. */
  readonly onUnavailable?: () => void;
};

/** IndexedDB when the browser offers it; where it is missing, the list lasts
 * for this session only. */
export function defaultRecentProjectStorage(
  options: RecentProjectStorageOptions = {},
): RecentProjectStorage {
  const factory = indexedDbFactory();
  if (factory === null) return createMemoryRecentProjectStorage();
  return createFallbackRecentProjectStorage(createIndexedDbRecentProjectStorage(factory), options);
}

/** A refusal is often transient (a dropped connection, a busy profile), so it
 * never turns persistence off by itself. While `primary` refuses, the list
 * this window last saw keeps being shown and changed, and those changes are
 * replayed onto the stored list, inside the next transaction that succeeds, so
 * another window's changes are kept too. After
 * `RECENT_PROJECT_STORAGE_ATTEMPTS` refusals in a row the list lasts for this
 * session only, and `onUnavailable` says so once. */
export function createFallbackRecentProjectStorage(
  primary: RecentProjectStorage,
  options: RecentProjectStorageOptions = {},
): RecentProjectStorage {
  let known: Entries = [];
  let unstored: ReadonlyArray<(entries: Entries) => Entries> = [];
  let refusals = 0;
  const available = (): boolean => refusals < RECENT_PROJECT_STORAGE_ATTEMPTS;
  const attempt = async (
    action: (replay: (entries: Entries) => Entries) => Promise<Entries>,
  ): Promise<boolean> => {
    const replaying = unstored;
    try {
      known = await action((entries) => replaying.reduce((list, change) => change(list), entries));
      unstored = unstored.slice(replaying.length);
      refusals = 0;
      return true;
    } catch {
      refusals += 1;
      if (refusals === RECENT_PROJECT_STORAGE_ATTEMPTS) options.onUnavailable?.();
      return false;
    }
  };
  return {
    load: async () => {
      if (available()) {
        await attempt((replay) =>
          unstored.length === 0 ? primary.load() : primary.update(replay),
        );
      }
      return known;
    },
    update: async (change) => {
      if (available() && (await attempt((replay) => primary.update((e) => change(replay(e)))))) {
        return known;
      }
      known = change(known);
      if (available()) unstored = [...unstored, change];
      return known;
    },
  };
}

export function loadRecentProjectLimit(): number {
  try {
    const raw = browserLocalStorage()?.getItem(RECENT_PROJECT_LIMIT_KEY);
    return raw === null || raw === undefined
      ? DEFAULT_RECENT_PROJECT_LIMIT
      : clampRecentProjectLimit(Number(raw));
  } catch {
    return DEFAULT_RECENT_PROJECT_LIMIT;
  }
}

export function saveRecentProjectLimit(limit: number, onSaved?: () => void): boolean {
  return saveComputerPreference(RECENT_PROJECT_LIMIT_KEY, String(clampRecentProjectLimit(limit)), {
    onSaved,
  });
}

function indexedDbFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

/** `onClosed` runs when the browser closes the connection, or asks for it to be
 * closed for another window's version change. */
function openDatabase(factory: IDBFactory, onClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        onClosed();
      };
      database.onclose = onClosed;
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
