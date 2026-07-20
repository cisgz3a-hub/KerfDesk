import {
  artifactMatchesDeleteGuard,
  type RecoveryArtifactDeleteGuard,
  type RecoveryArtifactGuardedMutation,
  type RecoveryArtifactStagingBoundary,
  type RecoverySlotMutation,
  type RecoveryStorageBackend,
} from './recovery-backend';
import { LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION } from './execution-artifact';
import {
  emptyRecoverySlots,
  LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
  MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
  type StoredRecoveryArtifact,
} from './recovery-model';
import { activeStoredArtifactStagingLeaseExpiry } from './recovery-artifact-staging';
import { persistedRecoveryArtifactRunIds } from './recovery-artifact-retention';

const DATABASE_NAME = 'laserforge-job-recovery-v1';
const DATABASE_VERSION = 2;
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

  async mutateSlotsWithArtifact<T>(
    runId: string,
    mutate: (current: unknown) => RecoverySlotMutation<T>,
  ): Promise<RecoveryArtifactGuardedMutation<T>> {
    const database = await this.database();
    const tx = database.transaction([SLOT_STORE, ARTIFACT_STORE], 'readwrite');
    try {
      const slotStore = tx.objectStore(SLOT_STORE);
      const current = await request<StoredSlotEnvelope | undefined>(slotStore.get(SLOT_KEY));
      const artifactKey = await request<IDBValidKey | undefined>(
        tx.objectStore(ARTIFACT_STORE).getKey(runId),
      );
      if (artifactKey === undefined) {
        await transactionFinished(tx);
        return { artifactExists: false };
      }
      const mutation = mutate(current?.value ?? null);
      await request(
        slotStore.put({ key: SLOT_KEY, value: mutation.slots } satisfies StoredSlotEnvelope),
      );
      await transactionFinished(tx);
      return { artifactExists: true, value: mutation.value };
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  async getArtifact(runId: string): Promise<unknown> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readonly');
    const record = await request<unknown>(tx.objectStore(ARTIFACT_STORE).get(runId));
    await transactionFinished(tx);
    return record ?? null;
  }

  async artifactExists(runId: string): Promise<boolean> {
    const database = await this.database();
    const tx = database.transaction(ARTIFACT_STORE, 'readonly');
    const key = await request<IDBValidKey | undefined>(
      tx.objectStore(ARTIFACT_STORE).getKey(runId),
    );
    await transactionFinished(tx);
    return key !== undefined;
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

  async deleteArtifactIfUnreferenced(
    runId: string,
    guard: RecoveryArtifactDeleteGuard,
  ): Promise<boolean> {
    const database = await this.database();
    const tx = database.transaction([SLOT_STORE, ARTIFACT_STORE], 'readwrite');
    try {
      const slots = await request<StoredSlotEnvelope | undefined>(
        tx.objectStore(SLOT_STORE).get(SLOT_KEY),
      );
      if (persistedRecoveryArtifactRunIds(slots?.value ?? null, guard.generation).has(runId)) {
        await transactionFinished(tx);
        return false;
      }
      const artifactStore = tx.objectStore(ARTIFACT_STORE);
      const artifact = await request<unknown>(artifactStore.get(runId));
      if (!artifactMatchesDeleteGuard(artifact, guard)) {
        await transactionFinished(tx);
        return false;
      }
      await request(artifactStore.delete(runId));
      await transactionFinished(tx);
      return true;
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  async deleteArtifactsExcept(
    retainedRunIds: ReadonlySet<string>,
    stagingBoundary?: RecoveryArtifactStagingBoundary,
  ): Promise<number | null> {
    const database = await this.database();
    const tx = database.transaction([ARTIFACT_STORE, SLOT_STORE], 'readwrite');
    const store = tx.objectStore(ARTIFACT_STORE);
    let retryAtEpochMs: number | null = null;
    try {
      const current = await request<StoredSlotEnvelope | undefined>(
        tx.objectStore(SLOT_STORE).get(SLOT_KEY),
      );
      const retained = new Set(retainedRunIds);
      if (stagingBoundary !== undefined) {
        for (const runId of persistedRecoveryArtifactRunIds(
          current?.value ?? null,
          stagingBoundary.generation,
        )) {
          retained.add(runId);
        }
      }
      await walkCursor(store.openCursor(), (cursor) => {
        if (typeof cursor.key !== 'string' || retained.has(cursor.key)) return;
        const leaseExpiry = stagingLeaseExpiry(cursor.value, stagingBoundary);
        if (leaseExpiry === null) cursor.delete();
        else retryAtEpochMs = earliestEpoch(retryAtEpochMs, leaseExpiry);
      });
      await transactionFinished(tx);
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
    return retryAtEpochMs;
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

function stagingLeaseExpiry(
  artifact: unknown,
  boundary: RecoveryArtifactStagingBoundary | undefined,
): number | null {
  return boundary === undefined
    ? null
    : activeStoredArtifactStagingLeaseExpiry(artifact, boundary.generation, Date.now());
}

function earliestEpoch(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DATABASE_NAME, DATABASE_VERSION);
    open.onupgradeneeded = (event) => {
      const database = open.result;
      if (!database.objectStoreNames.contains(ARTIFACT_STORE)) {
        database.createObjectStore(ARTIFACT_STORE, { keyPath: 'runId' });
      }
      if (!database.objectStoreNames.contains(SLOT_STORE)) {
        database.createObjectStore(SLOT_STORE, { keyPath: 'key' });
      }
      if (event.oldVersion === 1 && open.transaction !== null) {
        tagPreProvenanceArtifacts(open.transaction.objectStore(ARTIFACT_STORE));
      }
    };
    open.onsuccess = () => {
      const database = open.result;
      // Release this connection when another tab/build needs a newer recovery
      // schema. Keeping an old connection open would otherwise block that
      // tab's versionchange transaction until this page is closed.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    open.onerror = () => reject(open.error ?? new Error('Could not open recovery storage.'));
    open.onblocked = () => reject(new Error('Recovery storage upgrade is blocked.'));
  });
}

function tagPreProvenanceArtifacts(store: IDBObjectStore): void {
  const pending = store.openCursor();
  pending.onsuccess = () => {
    const cursor = pending.result;
    if (cursor === null) return;
    const migrated = migrateLegacyStoredArtifactOrigin(cursor.value);
    if (migrated !== cursor.value) cursor.update(migrated);
    cursor.continue();
  };
}

/** Pure upgrade transform exported for deterministic migration coverage. New
 * writes never call this; only records physically present in database v1 can
 * receive a legacy execution origin. */
export function migrateLegacyStoredArtifactOrigin(value: unknown): unknown {
  if (!isRecord(value) || value['origin'] !== undefined) return value;
  const artifact = value['artifact'];
  if (!isRecord(artifact)) return value;
  if (
    artifact['kind'] === 'exact-execution' &&
    artifact['schemaVersion'] === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION
  ) {
    return { ...value, origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN };
  }
  if (artifact['kind'] === 'legacy-fingerprint-only') {
    return { ...value, origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN };
  }
  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
