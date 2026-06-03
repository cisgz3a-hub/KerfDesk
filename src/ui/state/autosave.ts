// Autosave - PROJECT.md Phase C item: "autosave + recovery."
//
// Writes the current Project to localStorage every 30 s when dirty.
// On boot, the recovery hook checks the slot and prompts the user
// to restore if it looks recent. Single-slot, last-write-wins: not a
// generational backup system.
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

const AUTOSAVE_KEY = 'lf2:autosave:v1';
const AUTOSAVE_SCHEMA_VERSION = 1;
export const AUTOSAVE_INTERVAL_MS = 30_000;

type AutosaveRecord = {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly projectJson: string;
};

export type AutosaveSnapshot = {
  readonly project: Project;
  readonly savedAt: number;
};

export type AutosaveWriteResult =
  | { readonly kind: 'ok'; readonly savedAt: number }
  | { readonly kind: 'unavailable'; readonly reason: 'storage-unavailable' }
  | {
      readonly kind: 'failed';
      readonly reason: 'quota' | 'storage-error';
      readonly error: unknown;
    };

export type AutosaveWriteFailure = Exclude<AutosaveWriteResult, { readonly kind: 'ok' }>;

export function writeAutosave(project: Project, now: number = Date.now()): AutosaveWriteResult {
  if (typeof localStorage === 'undefined') {
    return { kind: 'unavailable', reason: 'storage-unavailable' };
  }
  try {
    const record: AutosaveRecord = {
      schemaVersion: AUTOSAVE_SCHEMA_VERSION,
      savedAt: now,
      projectJson: serializeProject(project),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
    return { kind: 'ok', savedAt: now };
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
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
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
  return { project: result.project, savedAt: record.savedAt };
}

export function clearAutosave(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
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
