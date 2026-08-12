import type { Project } from '../../core/scene';
import {
  AUTOSAVE_SCHEMA_VERSION,
  autosaveSnapshotFromRecord,
  isAutosaveRecord,
  prepareAutosaveRecord,
  type AutosaveRecord,
  type AutosaveScope,
  type AutosaveSnapshot,
  type AutosaveWriteResult,
} from './autosave-record';
import { isAutosaveQuotaExceededError } from './autosave-storage-error';

const LEGACY_AUTOSAVE_KEY = 'lf2:autosave:v1';
const AUTOSAVE_KEY_PREFIX = `${LEGACY_AUTOSAVE_KEY}:`;
const AUTOSAVE_INDEX_KEY = 'lf2:autosave:index:v1';
const AUTOSAVE_SESSION_KEY = 'lf2:autosave:session-id:v1';

type AutosaveIndexRecord = {
  readonly schemaVersion: number;
  readonly keys: ReadonlyArray<string>;
};

export type LocalAutosaveClearResult =
  | { readonly kind: 'ok'; readonly keys: readonly string[] }
  | { readonly kind: 'unavailable'; readonly keys: readonly string[] }
  | { readonly kind: 'failed'; readonly keys: readonly string[]; readonly error: unknown };

export type LocalAutosaveReadResult = {
  readonly snapshots: AutosaveSnapshot[];
  readonly corrupt: boolean;
  readonly failed: boolean;
};

type LocalReadDiagnostics = { corrupt: boolean; failed: boolean };

let fallbackSessionId: string | null = null;

export function writeLocalAutosave(
  project: Project,
  now: number = Date.now(),
  scope: AutosaveScope = {},
): AutosaveWriteResult {
  if (!localAutosaveAvailable()) return { kind: 'unavailable', reason: 'storage-unavailable' };
  const sessionId = scope.sessionId ?? currentAutosaveSessionId();
  const storageKey = autosaveStorageKeyForSession(sessionId);
  const prepared = prepareAutosaveRecord(project, now, sessionId, storageKey);
  return prepared.kind === 'ok'
    ? writePreparedLocalAutosave(prepared.record, storageKey)
    : prepared;
}

export function writePreparedLocalAutosave(
  record: AutosaveRecord,
  storageKey: string,
): AutosaveWriteResult {
  if (!localAutosaveAvailable()) return { kind: 'unavailable', reason: 'storage-unavailable' };
  try {
    localStorage.setItem(storageKey, JSON.stringify(record));
    registerAutosaveKey(storageKey);
    return { kind: 'ok', savedAt: record.savedAt, storageKey };
  } catch (error) {
    return {
      kind: 'failed',
      reason: isAutosaveQuotaExceededError(error) ? 'quota' : 'storage-error',
      error,
    };
  }
}

export function readLocalAutosave(): AutosaveSnapshot | null {
  return readLocalAutosaveSnapshots().sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

export function readLocalAutosaveSnapshots(): AutosaveSnapshot[] {
  return readLocalAutosaveState().snapshots;
}

export function readLocalAutosaveState(): LocalAutosaveReadResult {
  if (!localAutosaveAvailable()) return { snapshots: [], corrupt: false, failed: true };
  const diagnostics: LocalReadDiagnostics = { corrupt: false, failed: false };
  const snapshots = localAutosaveCandidateKeys(diagnostics)
    .map((storageKey) => readAutosaveAtKey(storageKey, diagnostics))
    .filter((snapshot): snapshot is AutosaveSnapshot => snapshot !== null);
  return { snapshots, ...diagnostics };
}

export function clearLocalAutosave(
  target: AutosaveScope | AutosaveSnapshot = {},
): LocalAutosaveClearResult {
  if (!localAutosaveAvailable()) return { kind: 'unavailable', keys: [] };
  const keys = 'storageKey' in target ? [target.storageKey] : keysForClearScope(target);
  const errors: unknown[] = [];
  for (const storageKey of keys) {
    try {
      localStorage.removeItem(storageKey);
      unregisterAutosaveKey(storageKey);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors.length === 0
    ? { kind: 'ok', keys }
    : {
        kind: 'failed',
        keys,
        error:
          errors.length === 1
            ? errors[0]
            : new AggregateError(errors, 'Autosave local cleanup was incomplete.'),
      };
}

export function currentAutosaveSessionId(): string {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const existing = sessionStorage.getItem(AUTOSAVE_SESSION_KEY);
      if (existing !== null && existing !== '') return existing;
      const next = createAutosaveSessionId();
      sessionStorage.setItem(AUTOSAVE_SESSION_KEY, next);
      return next;
    }
  } catch {
    /* fall through to process-local id */
  }
  fallbackSessionId ??= createAutosaveSessionId();
  return fallbackSessionId;
}

export function replaceAutosaveSessionId(): string {
  const next = createAutosaveSessionId();
  fallbackSessionId = next;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(AUTOSAVE_SESSION_KEY, next);
    }
  } catch {
    /* process-local identity remains authoritative */
  }
  return next;
}

export function autosaveStorageKeyForSession(sessionId: string): string {
  return `${AUTOSAVE_KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

export function localAutosaveAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readAutosaveAtKey(
  storageKey: string,
  state: LocalReadDiagnostics,
): AutosaveSnapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    state.failed = true;
    return null;
  }
  if (raw === null) return null;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    state.corrupt = true;
    return null;
  }
  const snapshot =
    isAutosaveRecord(record) && recordMatchesStorageKey(record, storageKey)
      ? autosaveSnapshotFromRecord(record, storageKey)
      : null;
  if (snapshot === null) state.corrupt = true;
  return snapshot;
}

function localAutosaveCandidateKeys(diagnostics: LocalReadDiagnostics): ReadonlyArray<string> {
  return uniqueStrings([
    autosaveStorageKeyForSession(currentAutosaveSessionId()),
    ...readAutosaveIndex(diagnostics),
    ...enumerateAutosaveKeys(diagnostics),
    LEGACY_AUTOSAVE_KEY,
  ]);
}

function keysForClearScope(scope: AutosaveScope): ReadonlyArray<string> {
  if (scope.sessionId !== undefined) return [autosaveStorageKeyForSession(scope.sessionId)];
  return [autosaveStorageKeyForSession(currentAutosaveSessionId()), LEGACY_AUTOSAVE_KEY];
}

function createAutosaveSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function registerAutosaveKey(storageKey: string): void {
  writeAutosaveIndex(uniqueStrings([...readAutosaveIndex(), storageKey]));
}

function unregisterAutosaveKey(storageKey: string): void {
  writeAutosaveIndex(readAutosaveIndex().filter((key) => key !== storageKey));
}

function writeAutosaveIndex(keys: ReadonlyArray<string>): void {
  if (keys.length === 0) {
    localStorage.removeItem(AUTOSAVE_INDEX_KEY);
    return;
  }
  localStorage.setItem(
    AUTOSAVE_INDEX_KEY,
    JSON.stringify({ schemaVersion: AUTOSAVE_SCHEMA_VERSION, keys }),
  );
}

function readAutosaveIndex(diagnostics?: LocalReadDiagnostics): ReadonlyArray<string> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTOSAVE_INDEX_KEY);
  } catch {
    if (diagnostics !== undefined) diagnostics.failed = true;
    return [];
  }
  if (raw === null) return [];
  try {
    const record: unknown = JSON.parse(raw);
    if (!isAutosaveIndexRecord(record)) {
      if (diagnostics !== undefined) diagnostics.corrupt = true;
      return [];
    }
    return record.keys.filter((key) => key.startsWith(AUTOSAVE_KEY_PREFIX));
  } catch {
    if (diagnostics !== undefined) diagnostics.corrupt = true;
    return [];
  }
}

function enumerateAutosaveKeys(diagnostics: LocalReadDiagnostics): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(AUTOSAVE_KEY_PREFIX) === true) keys.push(key);
    }
  } catch {
    diagnostics.failed = true;
  }
  return keys;
}

function isAutosaveIndexRecord(value: unknown): value is AutosaveIndexRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['schemaVersion'] === AUTOSAVE_SCHEMA_VERSION &&
    Array.isArray(record['keys']) &&
    record['keys'].every((key) => typeof key === 'string')
  );
}

function uniqueStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)];
}

function recordMatchesStorageKey(record: AutosaveRecord, storageKey: string): boolean {
  if (storageKey === LEGACY_AUTOSAVE_KEY) return record.sessionId === undefined;
  return (
    record.sessionId !== undefined && autosaveStorageKeyForSession(record.sessionId) === storageKey
  );
}
