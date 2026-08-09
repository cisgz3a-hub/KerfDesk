export const AUTOSAVE_INDEXEDDB_SCHEMA_VERSION = 1 as const;

export type AutosaveIndexedDbRecord = {
  readonly schemaVersion: typeof AUTOSAVE_INDEXEDDB_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly storageKey: string;
  readonly savedAt: number;
  readonly projectJson: string;
};

export type StoredAutosaveSnapshot = AutosaveIndexedDbRecord & {
  readonly kind: 'snapshot-v1';
  readonly epoch: number;
};

export type StoredAutosaveSnapshotReference = {
  readonly epoch: number;
  readonly savedAt: number;
};

export type StoredAutosaveManifest = {
  readonly kind: 'manifest-v1';
  readonly schemaVersion: typeof AUTOSAVE_INDEXEDDB_SCHEMA_VERSION;
  readonly storageKey: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly current: StoredAutosaveSnapshotReference | null;
  readonly previous: StoredAutosaveSnapshotReference | null;
};

export type AutosaveIndexedDbSlot = {
  readonly storageKey: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly currentExpected: boolean;
  readonly previousExpected: boolean;
  readonly current: AutosaveIndexedDbRecord | null;
  readonly previous: AutosaveIndexedDbRecord | null;
};

export function emptyAutosaveManifest(
  storageKey: string,
  sessionId: string,
): StoredAutosaveManifest {
  return {
    kind: 'manifest-v1',
    schemaVersion: AUTOSAVE_INDEXEDDB_SCHEMA_VERSION,
    storageKey,
    sessionId,
    epoch: 0,
    current: null,
    previous: null,
  };
}

export function parseAutosaveManifest(value: unknown): StoredAutosaveManifest {
  if (!isRecord(value)) throw new Error('Autosave manifest is malformed.');
  const current = parseReference(value['current']);
  const previous = parseReference(value['previous']);
  if (
    value['kind'] !== 'manifest-v1' ||
    value['schemaVersion'] !== AUTOSAVE_INDEXEDDB_SCHEMA_VERSION ||
    !isNonemptyString(value['storageKey']) ||
    !isNonemptyString(value['sessionId']) ||
    !isEpoch(value['epoch']) ||
    !referencesMatchManifestEpoch(value['epoch'], current, previous)
  ) {
    throw new Error('Autosave manifest is malformed.');
  }
  return {
    kind: value['kind'],
    schemaVersion: value['schemaVersion'],
    storageKey: value['storageKey'],
    sessionId: value['sessionId'],
    epoch: value['epoch'],
    current,
    previous,
  };
}

export function parseAutosaveSnapshot(value: unknown): StoredAutosaveSnapshot {
  if (!isRecord(value)) throw new Error('Autosave snapshot is malformed.');
  if (
    value['kind'] !== 'snapshot-v1' ||
    value['schemaVersion'] !== AUTOSAVE_INDEXEDDB_SCHEMA_VERSION ||
    !isNonemptyString(value['storageKey']) ||
    !isNonemptyString(value['sessionId']) ||
    !isEpoch(value['epoch']) ||
    !isFiniteNumber(value['savedAt']) ||
    typeof value['projectJson'] !== 'string'
  ) {
    throw new Error('Autosave snapshot is malformed.');
  }
  return value as StoredAutosaveSnapshot;
}

export function publicAutosaveRecord(snapshot: StoredAutosaveSnapshot): AutosaveIndexedDbRecord {
  return {
    schemaVersion: snapshot.schemaVersion,
    sessionId: snapshot.sessionId,
    storageKey: snapshot.storageKey,
    savedAt: snapshot.savedAt,
    projectJson: snapshot.projectJson,
  };
}

export function autosaveSnapshotKey(
  storageKey: string,
  reference: StoredAutosaveSnapshotReference,
): [string, number] {
  return [storageKey, reference.epoch];
}

function parseReference(value: unknown): StoredAutosaveSnapshotReference | null {
  if (value === null) return null;
  if (!isRecord(value) || !isEpoch(value['epoch']) || !isFiniteNumber(value['savedAt'])) {
    throw new Error('Autosave manifest is malformed.');
  }
  return { epoch: value['epoch'], savedAt: value['savedAt'] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function referencesMatchManifestEpoch(
  epoch: number,
  current: StoredAutosaveSnapshotReference | null,
  previous: StoredAutosaveSnapshotReference | null,
): boolean {
  if (current === null) return previous === null;
  if (current.epoch === 0 || current.epoch !== epoch) return false;
  return previous === null || previous.epoch === current.epoch - 1;
}
