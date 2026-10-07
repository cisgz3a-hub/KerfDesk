import {
  snapshotHeader,
  validateSnapshotCapacity,
  type LocalProjectSnapshot,
  type LocalProjectSnapshotHeader,
} from './local-project-snapshot';

const DATABASE = 'kerfdesk-local-project-snapshots-v1';
const HEADERS = 'headers';
const PROJECTS = 'projects';

export type LocalSnapshotStorage = {
  readonly list: () => Promise<ReadonlyArray<LocalProjectSnapshotHeader>>;
  readonly read: (id: string) => Promise<LocalProjectSnapshot | null>;
  readonly add: (snapshot: LocalProjectSnapshot) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

/** Separate named copies from the autosave recovery slots; every insertion is atomic. */
export function createLocalSnapshotStorage(factory?: IDBFactory): LocalSnapshotStorage {
  let connection: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (factory === undefined)
      return Promise.reject(new Error('Local snapshot storage is unavailable.'));
    connection ??= openDatabase(factory, () => {
      connection = null;
    });
    connection.catch(() => {
      connection = null;
    });
    return connection;
  };
  return {
    list: async () => {
      const transaction = (await database()).transaction(HEADERS, 'readonly');
      const [headers] = await Promise.all([
        request<LocalProjectSnapshotHeader[]>(transaction.objectStore(HEADERS).getAll()),
        finished(transaction),
      ]);
      return headers.sort((a, b) => b.createdAt - a.createdAt);
    },
    read: async (id) => {
      const transaction = (await database()).transaction(PROJECTS, 'readonly');
      const [value] = await Promise.all([
        request<LocalProjectSnapshot | undefined>(transaction.objectStore(PROJECTS).get(id)),
        finished(transaction),
      ]);
      if (value === undefined) return null;
      if (value.version !== 1 || value.id !== id || typeof value.projectJson !== 'string')
        throw new Error('This local snapshot cannot be read by this version of KerfDesk.');
      return value;
    },
    add: async (snapshot) => {
      const transaction = (await database()).transaction([HEADERS, PROJECTS], 'readwrite');
      const done = finished(transaction);
      try {
        const headers = transaction.objectStore(HEADERS);
        const current = await request<LocalProjectSnapshotHeader[]>(headers.getAll());
        validateSnapshotCapacity(current, snapshot);
        headers.add(snapshotHeader(snapshot));
        transaction.objectStore(PROJECTS).add(snapshot);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* Already aborted or committed. */
        }
        await done.catch(() => undefined);
        throw error;
      }
      await done;
    },
    remove: async (id) => {
      const transaction = (await database()).transaction([HEADERS, PROJECTS], 'readwrite');
      const done = finished(transaction);
      transaction.objectStore(HEADERS).delete(id);
      transaction.objectStore(PROJECTS).delete(id);
      await done;
    },
  };
}

let defaultStorage: LocalSnapshotStorage | null = null;
export function localSnapshotStorage(): LocalSnapshotStorage {
  if (defaultStorage !== null) return defaultStorage;
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    factory = undefined;
  }
  defaultStorage = createLocalSnapshotStorage(factory);
  return defaultStorage;
}

function openDatabase(factory: IDBFactory, closed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(DATABASE, 1);
    pending.onupgradeneeded = () => {
      pending.result.createObjectStore(HEADERS, { keyPath: 'id' });
      pending.result.createObjectStore(PROJECTS, { keyPath: 'id' });
    };
    pending.onsuccess = () => {
      pending.result.onversionchange = () => {
        pending.result.close();
        closed();
      };
      pending.result.onclose = closed;
      resolve(pending.result);
    };
    pending.onerror = () =>
      reject(pending.error ?? new Error('Could not open local snapshot storage.'));
    pending.onblocked = () => reject(new Error('Local snapshot storage is blocked.'));
  });
}

function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () =>
      reject(pending.error ?? new Error('Local snapshot storage request failed.'));
  });
}
function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Local snapshot could not be saved.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Local snapshot storage was aborted.'));
  });
}
