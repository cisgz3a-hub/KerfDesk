import type { Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForAutosave } from '../../io/project/prepare-project-autosave';

export const AUTOSAVE_SCHEMA_VERSION = 1 as const;

export type AutosaveRecord = {
  readonly schemaVersion: typeof AUTOSAVE_SCHEMA_VERSION;
  readonly savedAt: number;
  readonly projectJson: string;
  readonly sessionId?: string;
};

export type AutosaveSnapshot = {
  readonly project: Project;
  readonly savedAt: number;
  readonly storageKey: string;
  readonly sessionId?: string;
};

export type AutosaveWriteResult =
  | { readonly kind: 'ok'; readonly savedAt: number; readonly storageKey: string }
  | { readonly kind: 'unavailable'; readonly reason: 'storage-unavailable' }
  | {
      readonly kind: 'failed';
      readonly reason: 'invalid-project' | 'quota' | 'storage-error';
      readonly error: unknown;
    };

export type AutosaveWriteFailure = Exclude<AutosaveWriteResult, { readonly kind: 'ok' }>;

export type AutosaveScope = {
  readonly sessionId?: string;
};

export type AutosavePreparation =
  | { readonly kind: 'ok'; readonly record: AutosaveRecord; readonly storageKey: string }
  | Extract<AutosaveWriteResult, { readonly kind: 'failed' }>;

export function prepareAutosaveRecord(
  project: Project,
  savedAt: number,
  sessionId: string,
  storageKey: string,
): AutosavePreparation {
  const prepared = prepareProjectForAutosave(project);
  if (prepared.kind !== 'ok') {
    return { kind: 'failed', reason: 'invalid-project', error: new Error(prepared.reason) };
  }
  return {
    kind: 'ok',
    storageKey,
    record: {
      schemaVersion: AUTOSAVE_SCHEMA_VERSION,
      savedAt,
      projectJson: prepared.json,
      sessionId,
    },
  };
}

export function autosaveSnapshotFromRecord(
  record: AutosaveRecord,
  storageKey: string,
): AutosaveSnapshot | null {
  const result = deserializeProject(record.projectJson);
  if (result.kind !== 'ok') return null;
  return {
    project: result.project,
    savedAt: record.savedAt,
    storageKey,
    ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
  };
}

export function isAutosaveRecord(value: unknown): value is AutosaveRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['schemaVersion'] === AUTOSAVE_SCHEMA_VERSION &&
    typeof record['savedAt'] === 'number' &&
    Number.isFinite(record['savedAt']) &&
    typeof record['projectJson'] === 'string' &&
    (record['sessionId'] === undefined || typeof record['sessionId'] === 'string')
  );
}
