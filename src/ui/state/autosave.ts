// Autosave - PROJECT.md Phase C item: "autosave + recovery."
//
// Writes the current Project to a per-window localStorage slot every 30 s when dirty.
// On boot, the recovery hook checks the slot and prompts the user
// to restore if it looks recent. This is not a generational backup
// system, but separate windows keep separate slots so one dirty project
// cannot overwrite or clear another.
//
// Boundaries:
//   * localStorage only - works web + Electron renderer; roughly 5 MB cap.
//   * Pauses during live streaming so the render loop owns the CPU.
//   * Cleared by handleSaveProject after a successful manual save.
//   * Storage failures are reported to the UI so the operator can
//     manually save instead of trusting a missing recovery slot.
//
// Schema: { schemaVersion, savedAt, projectJson }. Bumping schemaVersion
// invalidates older slots (readAutosave returns null), matching the
// project-file schema-migration policy.

import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import type { Project } from '../../core/scene';

const LEGACY_AUTOSAVE_KEY = 'lf2:autosave:v1';
const AUTOSAVE_KEY_PREFIX = `${LEGACY_AUTOSAVE_KEY}:`;
const AUTOSAVE_INDEX_KEY = 'lf2:autosave:index:v1';
const AUTOSAVE_SESSION_KEY = 'lf2:autosave:session-id:v1';
const AUTOSAVE_SCHEMA_VERSION = 1;
export const AUTOSAVE_INTERVAL_MS = 30_000;

type AutosaveRecord = {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly projectJson: string;
  readonly sessionId?: string;
};

type AutosaveIndexRecord = {
  readonly schemaVersion: number;
  readonly keys: ReadonlyArray<string>;
};

export type AutosaveSnapshot = {
  readonly project: Project;
  readonly savedAt: number;
  readonly storageKey: string;
};

export type AutosaveWriteResult =
  | { readonly kind: 'ok'; readonly savedAt: number; readonly storageKey: string }
  | { readonly kind: 'unavailable'; readonly reason: 'storage-unavailable' }
  | {
      readonly kind: 'failed';
      readonly reason: 'quota' | 'storage-error';
      readonly error: unknown;
    };

export type AutosaveWriteFailure = Exclude<AutosaveWriteResult, { readonly kind: 'ok' }>;

export type AutosaveScope = {
  readonly sessionId?: string;
};

let fallbackSessionId: string | null = null;

export function writeAutosave(
  project: Project,
  now: number = Date.now(),
  scope: AutosaveScope = {},
): AutosaveWriteResult {
  if (typeof localStorage === 'undefined') {
    return { kind: 'unavailable', reason: 'storage-unavailable' };
  }
  const sessionId = scope.sessionId ?? autosaveSessionId();
  const storageKey = autosaveKeyForSession(sessionId);
  try {
    const record: AutosaveRecord = {
      schemaVersion: AUTOSAVE_SCHEMA_VERSION,
      savedAt: now,
      projectJson: serializeProject(project),
      sessionId,
    };
    localStorage.setItem(storageKey, JSON.stringify(record));
    registerAutosaveKey(storageKey);
    return { kind: 'ok', savedAt: now, storageKey };
  } catch (error) {
    return {
      kind: 'failed',
      reason: isQuotaExceededError(error) ? 'quota' : 'storage-error',
      error,
    };
  }
}

export function readAutosave(): AutosaveSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  const snapshots = autosaveCandidateKeys()
    .map((storageKey) => readAutosaveAtKey(storageKey))
    .filter((snapshot): snapshot is AutosaveSnapshot => snapshot !== null)
    .sort((a, b) => b.savedAt - a.savedAt);
  return snapshots[0] ?? null;
}

function readAutosaveAtKey(storageKey: string): AutosaveSnapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isAutosaveRecord(record)) return null;
  if (record.schemaVersion !== AUTOSAVE_SCHEMA_VERSION) return null;
  const result = deserializeProject(record.projectJson);
  if (result.kind !== 'ok') return null;
  return { project: result.project, savedAt: record.savedAt, storageKey };
}

export function clearAutosave(target: AutosaveScope | AutosaveSnapshot = {}): void {
  if (typeof localStorage === 'undefined') return;
  const keys = 'storageKey' in target ? [target.storageKey] : keysForClearScope(target);
  for (const storageKey of keys) {
    try {
      localStorage.removeItem(storageKey);
      unregisterAutosaveKey(storageKey);
    } catch {
      /* ignore */
    }
  }
}

export type AutosaveSnapshotFn = () => {
  readonly project: Project;
  readonly dirty: boolean;
  readonly isStreaming: boolean;
};

// Starts a setInterval-driven autosave loop. Returns the stop function;
// callers (the React hook) clear on unmount. The interval is configurable
// for tests; production wiring passes AUTOSAVE_INTERVAL_MS.
export function startAutosaveLoop(
  getSnapshot: AutosaveSnapshotFn,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
  onWriteFailure?: (failure: AutosaveWriteFailure) => void,
): () => void {
  const handle = setInterval(() => {
    const snap = getSnapshot();
    if (!snap.dirty) return;
    if (snap.isStreaming) return;
    const result = writeAutosave(snap.project);
    if (result.kind !== 'ok') onWriteFailure?.(result);
  }, intervalMs);
  return () => clearInterval(handle);
}

function isAutosaveRecord(v: unknown): v is AutosaveRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['schemaVersion'] === 'number' &&
    typeof r['savedAt'] === 'number' &&
    typeof r['projectJson'] === 'string'
  );
}

function autosaveCandidateKeys(): ReadonlyArray<string> {
  return uniqueStrings([
    autosaveKeyForSession(autosaveSessionId()),
    ...readAutosaveIndex(),
    LEGACY_AUTOSAVE_KEY,
  ]);
}

function keysForClearScope(scope: AutosaveScope): ReadonlyArray<string> {
  if (scope.sessionId !== undefined) return [autosaveKeyForSession(scope.sessionId)];
  return [autosaveKeyForSession(autosaveSessionId()), LEGACY_AUTOSAVE_KEY];
}

function autosaveKeyForSession(sessionId: string): string {
  return `${AUTOSAVE_KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

function autosaveSessionId(): string {
  if (typeof sessionStorage !== 'undefined') {
    try {
      const existing = sessionStorage.getItem(AUTOSAVE_SESSION_KEY);
      if (existing !== null && existing !== '') return existing;
      const next = createSessionId();
      sessionStorage.setItem(AUTOSAVE_SESSION_KEY, next);
      return next;
    } catch {
      /* fall through to process-local id */
    }
  }
  fallbackSessionId ??= createSessionId();
  return fallbackSessionId;
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function registerAutosaveKey(storageKey: string): void {
  const keys = uniqueStrings([...readAutosaveIndex(), storageKey]);
  localStorage.setItem(
    AUTOSAVE_INDEX_KEY,
    JSON.stringify({ schemaVersion: AUTOSAVE_SCHEMA_VERSION, keys }),
  );
}

function unregisterAutosaveKey(storageKey: string): void {
  const keys = readAutosaveIndex().filter((key) => key !== storageKey);
  if (keys.length === 0) {
    localStorage.removeItem(AUTOSAVE_INDEX_KEY);
    return;
  }
  localStorage.setItem(
    AUTOSAVE_INDEX_KEY,
    JSON.stringify({ schemaVersion: AUTOSAVE_SCHEMA_VERSION, keys }),
  );
}

function readAutosaveIndex(): ReadonlyArray<string> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTOSAVE_INDEX_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isAutosaveIndexRecord(record)) return [];
  if (record.schemaVersion !== AUTOSAVE_SCHEMA_VERSION) return [];
  return record.keys.filter((key) => key.startsWith(AUTOSAVE_KEY_PREFIX));
}

function isAutosaveIndexRecord(v: unknown): v is AutosaveIndexRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['schemaVersion'] === 'number' &&
    Array.isArray(r['keys']) &&
    r['keys'].every((key) => typeof key === 'string')
  );
}

function uniqueStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)];
}

function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22
    );
  }
  if (error instanceof Error) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }
  return false;
}
