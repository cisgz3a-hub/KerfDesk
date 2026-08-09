import {
  AUTOSAVE_INDEXEDDB_SCHEMA_VERSION,
  autosaveSnapshotKey,
  parseAutosaveSnapshot,
  type AutosaveIndexedDbRecord,
  type StoredAutosaveManifest,
  type StoredAutosaveSnapshot,
} from './autosave-indexeddb-schema';
import {
  AUTOSAVE_MANIFEST_STORE,
  AUTOSAVE_SNAPSHOT_STORE,
  autosaveRequest,
} from './autosave-indexeddb-runtime';

export async function replaceAutosaveSnapshot(
  transaction: IDBTransaction,
  current: StoredAutosaveManifest,
  record: AutosaveIndexedDbRecord,
): Promise<StoredAutosaveManifest> {
  const epoch = nextAutosaveEpoch(current.epoch);
  const snapshot: StoredAutosaveSnapshot = parseAutosaveSnapshot({
    ...record,
    kind: 'snapshot-v1',
    schemaVersion: AUTOSAVE_INDEXEDDB_SCHEMA_VERSION,
    epoch,
  });
  const snapshots = transaction.objectStore(AUTOSAVE_SNAPSHOT_STORE);
  await autosaveRequest(snapshots.add(snapshot));
  if (current.previous !== null) {
    await autosaveRequest(
      snapshots.delete(autosaveSnapshotKey(current.storageKey, current.previous)),
    );
  }
  const next: StoredAutosaveManifest = {
    ...current,
    sessionId: record.sessionId,
    epoch,
    current: { epoch, savedAt: record.savedAt },
    previous: current.current,
  };
  await autosaveRequest(transaction.objectStore(AUTOSAVE_MANIFEST_STORE).put(next));
  return next;
}

export async function clearAutosaveManifest(
  transaction: IDBTransaction,
  current: StoredAutosaveManifest,
): Promise<StoredAutosaveManifest> {
  const snapshots = transaction.objectStore(AUTOSAVE_SNAPSHOT_STORE);
  for (const reference of [current.current, current.previous]) {
    if (reference !== null) {
      await autosaveRequest(snapshots.delete(autosaveSnapshotKey(current.storageKey, reference)));
    }
  }
  const next = {
    ...current,
    epoch: nextAutosaveEpoch(current.epoch),
    current: null,
    previous: null,
  };
  await autosaveRequest(transaction.objectStore(AUTOSAVE_MANIFEST_STORE).put(next));
  return next;
}

function nextAutosaveEpoch(value: number): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Autosave epoch cannot advance.');
  return next;
}
