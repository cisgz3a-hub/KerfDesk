export const AUTOSAVE_MANIFEST_STORE = 'manifests';
export const AUTOSAVE_SNAPSHOT_STORE = 'snapshots';

const DATABASE_VERSION = 1;

export function openAutosaveDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(databaseName, DATABASE_VERSION);
    open.onupgradeneeded = () => createStores(open.result);
    open.onsuccess = () => {
      const database = open.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    open.onerror = () => reject(open.error ?? new Error('Could not open autosave storage.'));
    open.onblocked = () => reject(new Error('Autosave storage upgrade is blocked.'));
  });
}

export function autosaveRequest<T = IDBValidKey>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('Autosave storage request failed.'));
  });
}

export function autosaveTransactionFinished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Autosave transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Autosave transaction aborted.'));
  });
}

export function abortAutosaveTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // Transaction already committed or aborted.
  }
}

function createStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(AUTOSAVE_MANIFEST_STORE)) {
    database.createObjectStore(AUTOSAVE_MANIFEST_STORE, { keyPath: 'storageKey' });
  }
  if (!database.objectStoreNames.contains(AUTOSAVE_SNAPSHOT_STORE)) {
    database.createObjectStore(AUTOSAVE_SNAPSHOT_STORE, {
      keyPath: ['storageKey', 'epoch'],
    });
  }
}
