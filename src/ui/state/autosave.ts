// Autosave — PROJECT.md Phase C item: "autosave + recovery."
//
// Writes the current Project to localStorage every 30 s when dirty.
// On boot, the recovery hook checks the slot and prompts the user
// to restore if it looks recent. Single-slot, last-write-wins —
// not a generational backup system (per CLAUDE.md "simplicity first").
//
// Boundaries:
//   * localStorage only — works web + Electron renderer; ~5 MB cap.
//   * Pauses during live streaming so the render loop owns the CPU.
//   * Cleared by handleSaveProject after a successful manual save.
//   * Best-effort: quota-exceeded / private-browsing failures are
//     swallowed silently. Autosave is a safety net, not a guarantee.
//
// Schema: { schemaVersion, savedAt, projectJson }. Bumping schemaVersion
// invalidates older slots (readAutosave returns null) — matches the
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

export function writeAutosave(project: Project, now: number = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const record: AutosaveRecord = {
      schemaVersion: AUTOSAVE_SCHEMA_VERSION,
      savedAt: now,
      projectJson: serializeProject(project),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
  } catch {
    // Quota exceeded or storage disabled — autosave is best-effort.
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
// for tests — production wiring passes AUTOSAVE_INTERVAL_MS.
export function startAutosaveLoop(
  getSnapshot: AutosaveSnapshotFn,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
): () => void {
  const handle = setInterval(() => {
    const snap = getSnapshot();
    if (!snap.dirty) return;
    if (snap.isStreaming) return;
    writeAutosave(snap.project);
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
