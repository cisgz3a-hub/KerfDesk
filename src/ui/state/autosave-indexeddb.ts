import {
  autosaveSnapshotKey,
  emptyAutosaveManifest,
  parseAutosaveManifest,
  parseAutosaveSnapshot,
  publicAutosaveRecord,
  type AutosaveIndexedDbRecord,
  type AutosaveIndexedDbSlot,
  type StoredAutosaveManifest,
  type StoredAutosaveSnapshotReference,
} from './autosave-indexeddb-schema';
import { clearAutosaveManifest, replaceAutosaveSnapshot } from './autosave-indexeddb-mutations';
import {
  abortAutosaveTransaction,
  AUTOSAVE_MANIFEST_STORE,
  AUTOSAVE_SNAPSHOT_STORE,
  autosaveRequest,
  autosaveTransactionFinished,
  openAutosaveDatabase,
} from './autosave-indexeddb-runtime';

export type { AutosaveIndexedDbRecord, AutosaveIndexedDbSlot };

const DEFAULT_DATABASE_NAME = 'curvedesk-project-autosave-v1';

export type AutosaveIndexedDbMutation =
  | { readonly kind: 'committed'; readonly epoch: number }
  | {
      readonly kind: 'conflict';
      readonly expectedEpoch: number;
      readonly actualEpoch: number;
    };

type AutosaveIndexedDbOperation = 'commit' | 'clear';

type AutosaveIndexedDbOptions = {
  readonly factory?: IDBFactory | undefined;
  readonly databaseName?: string;
  readonly beforeCommit?:
    | ((operation: AutosaveIndexedDbOperation, transaction: IDBTransaction) => void)
    | undefined;
};

export class IndexedDbAutosaveRepository {
  private readonly factory: IDBFactory | undefined;
  private readonly databaseName: string;
  private readonly beforeCommit: AutosaveIndexedDbOptions['beforeCommit'];
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: AutosaveIndexedDbOptions = {}) {
    this.factory = Object.hasOwn(options, 'factory') ? options.factory : availableIndexedDb();
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.beforeCommit = options.beforeCommit;
  }

  async commit(
    record: AutosaveIndexedDbRecord,
    expectedEpoch: number,
  ): Promise<AutosaveIndexedDbMutation> {
    requireExpectedEpoch(expectedEpoch);
    const database = await this.database();
    const transaction = database.transaction(
      [AUTOSAVE_MANIFEST_STORE, AUTOSAVE_SNAPSHOT_STORE],
      'readwrite',
    );
    try {
      const manifests = transaction.objectStore(AUTOSAVE_MANIFEST_STORE);
      const current = await readManifest(manifests, record.storageKey, record.sessionId);
      requireMatchingSession(current, record.sessionId);
      if (current.epoch !== expectedEpoch) {
        await autosaveTransactionFinished(transaction);
        return conflict(expectedEpoch, current.epoch);
      }
      const next = await replaceAutosaveSnapshot(transaction, current, record);
      this.beforeCommit?.('commit', transaction);
      await autosaveTransactionFinished(transaction);
      return { kind: 'committed', epoch: next.epoch };
    } catch (error) {
      abortAutosaveTransaction(transaction);
      throw error;
    }
  }

  async clear(input: {
    readonly storageKey: string;
    readonly sessionId: string;
    readonly expectedEpoch: number;
  }): Promise<AutosaveIndexedDbMutation> {
    requireExpectedEpoch(input.expectedEpoch);
    const database = await this.database();
    const transaction = database.transaction(
      [AUTOSAVE_MANIFEST_STORE, AUTOSAVE_SNAPSHOT_STORE],
      'readwrite',
    );
    try {
      const manifests = transaction.objectStore(AUTOSAVE_MANIFEST_STORE);
      const existing = await autosaveRequest<unknown>(manifests.get(input.storageKey));
      const current =
        existing === undefined
          ? emptyAutosaveManifest(input.storageKey, input.sessionId)
          : parseAutosaveManifest(existing);
      requireMatchingSession(current, input.sessionId);
      if (current.epoch !== input.expectedEpoch) {
        await autosaveTransactionFinished(transaction);
        return conflict(input.expectedEpoch, current.epoch);
      }
      const next = await clearAutosaveManifest(transaction, current);
      this.beforeCommit?.('clear', transaction);
      await autosaveTransactionFinished(transaction);
      return { kind: 'committed', epoch: next.epoch };
    } catch (error) {
      abortAutosaveTransaction(transaction);
      throw error;
    }
  }

  async readSlot(storageKey: string): Promise<AutosaveIndexedDbSlot | null> {
    const database = await this.database();
    const transaction = database.transaction(
      [AUTOSAVE_MANIFEST_STORE, AUTOSAVE_SNAPSHOT_STORE],
      'readonly',
    );
    const value = await autosaveRequest<unknown>(
      transaction.objectStore(AUTOSAVE_MANIFEST_STORE).get(storageKey),
    );
    if (value === undefined) {
      await autosaveTransactionFinished(transaction);
      return null;
    }
    const result = await resolveSlot(transaction, parseAutosaveManifest(value));
    await autosaveTransactionFinished(transaction);
    return result;
  }

  async readEpoch(storageKey: string): Promise<number> {
    const database = await this.database();
    const transaction = database.transaction(AUTOSAVE_MANIFEST_STORE, 'readonly');
    const value = await autosaveRequest<unknown>(
      transaction.objectStore(AUTOSAVE_MANIFEST_STORE).get(storageKey),
    );
    await autosaveTransactionFinished(transaction);
    return value === undefined ? 0 : parseAutosaveManifest(value).epoch;
  }

  async readAllSlots(): Promise<ReadonlyArray<AutosaveIndexedDbSlot>> {
    const database = await this.database();
    const transaction = database.transaction(
      [AUTOSAVE_MANIFEST_STORE, AUTOSAVE_SNAPSHOT_STORE],
      'readonly',
    );
    const values = await autosaveRequest<unknown[]>(
      transaction.objectStore(AUTOSAVE_MANIFEST_STORE).getAll(),
    );
    const slots = await Promise.all(
      values.map((value, index) => {
        try {
          return resolveSlot(transaction, parseAutosaveManifest(value));
        } catch {
          return corruptManifestSlot(value, index);
        }
      }),
    );
    await autosaveTransactionFinished(transaction);
    return slots;
  }

  private database(): Promise<IDBDatabase> {
    if (this.factory === undefined) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.databasePromise ??= openAutosaveDatabase(this.factory, this.databaseName);
    return this.databasePromise;
  }
}

function availableIndexedDb(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

function corruptManifestSlot(value: unknown, index: number): AutosaveIndexedDbSlot {
  const record = typeof value === 'object' && value !== null ? (value as object) : null;
  const storageKey =
    record !== null && 'storageKey' in record && typeof record.storageKey === 'string'
      ? record.storageKey
      : `corrupt-autosave-manifest-${index}`;
  const sessionId =
    record !== null && 'sessionId' in record && typeof record.sessionId === 'string'
      ? record.sessionId
      : `corrupt-autosave-session-${index}`;
  return {
    storageKey,
    sessionId,
    epoch: 0,
    currentExpected: true,
    previousExpected: false,
    current: null,
    previous: null,
  };
}

async function readManifest(
  store: IDBObjectStore,
  storageKey: string,
  sessionId: string,
): Promise<StoredAutosaveManifest> {
  const value = await autosaveRequest<unknown>(store.get(storageKey));
  return value === undefined
    ? emptyAutosaveManifest(storageKey, sessionId)
    : parseAutosaveManifest(value);
}

async function resolveSlot(
  transaction: IDBTransaction,
  manifest: StoredAutosaveManifest,
): Promise<AutosaveIndexedDbSlot> {
  const snapshots = transaction.objectStore(AUTOSAVE_SNAPSHOT_STORE);
  const [current, previous] = await Promise.all([
    readSnapshot(snapshots, manifest.storageKey, manifest.sessionId, manifest.current),
    readSnapshot(snapshots, manifest.storageKey, manifest.sessionId, manifest.previous),
  ]);
  return {
    storageKey: manifest.storageKey,
    sessionId: manifest.sessionId,
    epoch: manifest.epoch,
    currentExpected: manifest.current !== null,
    previousExpected: manifest.previous !== null,
    current,
    previous,
  };
}

async function readSnapshot(
  store: IDBObjectStore,
  storageKey: string,
  sessionId: string,
  reference: StoredAutosaveSnapshotReference | null,
): Promise<AutosaveIndexedDbRecord | null> {
  if (reference === null) return null;
  const value = await autosaveRequest<unknown>(
    store.get(autosaveSnapshotKey(storageKey, reference)),
  );
  if (value === undefined) return null;
  try {
    const snapshot = parseAutosaveSnapshot(value);
    const matchesManifest =
      snapshot.storageKey === storageKey &&
      snapshot.sessionId === sessionId &&
      snapshot.epoch === reference.epoch &&
      snapshot.savedAt === reference.savedAt;
    return matchesManifest ? publicAutosaveRecord(snapshot) : null;
  } catch {
    return null;
  }
}

function conflict(expectedEpoch: number, actualEpoch: number): AutosaveIndexedDbMutation {
  return { kind: 'conflict', expectedEpoch, actualEpoch };
}

function requireExpectedEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Autosave epoch is invalid.');
}

function requireMatchingSession(manifest: StoredAutosaveManifest, sessionId: string): void {
  if (manifest.sessionId !== sessionId) {
    throw new Error('Autosave manifest session does not match its storage key.');
  }
}
