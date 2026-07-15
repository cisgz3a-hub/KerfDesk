import type { RecoverySlotMutation, RecoveryStorageBackend } from './recovery-backend';
import { emptyRecoverySlots, type StoredRecoveryArtifact } from './recovery-model';

const DATABASE_NAME = 'laserforge-job-recovery-v1';
const DATABASE_VERSION = 1;
const ARTIFACT_STORE = 'artifacts';
const SLOT_STORE = 'slots';
const SLOT_KEY = 'current';

type StoredSlotEnvelope = { readonly key: typeof SLOT_KEY; readonly value: unknown };

export class IndexedDbRecoveryStorageBackend implements RecoveryStorageBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  async readSlots(): Promise<unknown> {
    const database = await this.database();
    const tx = database.transaction(SLOT_STORE, 'readonly');
    const envelope = await request<StoredSlotEnvelope | undefined>(
      tx.objectStore(SLOT_STORE).get(SLOT_KEY),
    );
    await transactionFinished(tx);
    return envelope?.value ?? null;
  }

  async mutateSlots<T>(mutate: (current: unknown) => RecoverySlotMutation<T>): Promise<T> {
    const database = await this.database();
    const tx = database.transaction(SLOT_STORE, 'readwrite');
    const store = tx.objectStore(SLOT_STORE);
    let value: T | undefined;
    try {
      const current = await request<StoredSlotEnvelope | undefined>(store.get(SLOT_KEY));
      const mutation = mutate(current?.value ?? null);
      value = mutation.value;
      await request(
        store.put({ key: SLOT_KEY, value: mutation.slots } satisfies StoredSlotEnvelope),
      );
      await transactionFinished(tx);
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
    return value as T;
  }

  async getArtifact(runId: string): Promise<unknown> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readonly');
    const record = await request<unknown>(tx.objectStore(ARTIFACT_STORE).get(runId));
    await transactionFinished(tx);
    return record ?? null;
  }

  async putArtifact(record: StoredRecoveryArtifact): Promise<boolean> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readwrite');
    const store = tx.objectStore(ARTIFACT_STORE);
    const existing = await request<unknown>(store.get(record.runId));
    if (existing === undefined) await request(store.add(record));
    await transactionFinished(tx);
    return existing === undefined;
  }

  async deleteArtifact(runId: string): Promise<void> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readwrite');
    await request(tx.objectStore(ARTIFACT_STORE).delete(runId));
    await transactionFinished(tx);
  }

  async deleteArtifactsExcept(retainedRunIds: ReadonlySet<string>): Promise<void> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readwrite');
    const store = tx.objectStore(ARTIFACT_STORE);
    try {
      await walkCursor(store.openCursor(), (cursor) => {
        if (typeof cursor.key === 'string' && !retainedRunIds.has(cursor.key)) cursor.delete();
      });
      await transactionFinished(tx);
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  async purge(generation: number): Promise<void> {
    const database = await this.database();
    const tx = database.transaction([ARTIFACT_STORE, SLOT_STORE], 'readwrite');
    await request(tx.objectStore(ARTIFACT_STORE).clear());
    await request(
      tx.objectStore(SLOT_STORE).put({
        key: SLOT_KEY,
        value: emptyRecoverySlots(generation),
      } satisfies StoredSlotEnvelope),
    );
    await transactionFinished(tx);
  }

  private database(): Promise<IDBDatabase> {
    if (this.factory === undefined) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.databasePromise ??= openDatabase(this.factory);
    return this.databasePromise;
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DATABASE_NAME, DATABASE_VERSION);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(ARTIFACT_STORE)) {
        database.createObjectStore(ARTIFACT_STORE, { keyPath: 'runId' });
      }
      if (!database.objectStoreNames.contains(SLOT_STORE)) {
        database.createObjectStore(SLOT_STORE, { keyPath: 'key' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Could not open recovery storage.'));
    open.onblocked = () => reject(new Error('Recovery storage upgrade is blocked.'));
  });
}

function request<T = IDBValidKey>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('Recovery storage request failed.'));
  });
}

function walkCursor(
  pending: IDBRequest<IDBCursorWithValue | null>,
  visit: (cursor: IDBCursorWithValue) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => {
      try {
        const cursor = pending.result;
        if (cursor === null) {
          resolve();
          return;
        }
        visit(cursor);
        cursor.continue();
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error('Recovery storage cursor visitor failed unexpectedly.'),
        );
      }
    };
    pending.onerror = () => reject(pending.error ?? new Error('Recovery storage cursor failed.'));
  });
}

function transactionFinished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Recovery storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Recovery storage transaction aborted.'));
  });
}

function abortIfActive(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    // The transaction already completed or aborted.
  }
}
