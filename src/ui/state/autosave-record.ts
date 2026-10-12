import type { Project } from '../../core/scene';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { deserializeProject, deserializeProjectValue } from '../../io/project/deserialize-project';
import { prepareProjectForAutosave } from '../../io/project/prepare-project-autosave';
import { sealProjectText, trustIfSealedHere } from '../licensing/project-seal';
import { unadmittedProFeatures } from './pending-pro-project';

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
  return sealAutosavePreparation({
    kind: 'ok',
    storageKey,
    record: {
      schemaVersion: AUTOSAVE_SCHEMA_VERSION,
      savedAt,
      projectJson: prepared.json,
      sessionId,
    },
  });
}

/**
 * Seals a prepared record with this computer's key (ADR-592). A worker has no
 * key, so the window seals what the worker returns; sealing twice is a no-op.
 */
export function sealAutosavePreparation(prepared: AutosavePreparation): AutosavePreparation {
  if (prepared.kind !== 'ok') return prepared;
  const projectJson = sealProjectText(prepared.record.projectJson);
  return projectJson === prepared.record.projectJson
    ? prepared
    : { ...prepared, record: { ...prepared.record, projectJson } };
}

export type AutosaveRecordReadResult =
  | { readonly kind: 'ok'; readonly snapshot: AutosaveSnapshot }
  | { readonly kind: 'unsupported-version' | 'invalid' };

export function readAutosaveRecord(
  record: AutosaveRecord,
  storageKey: string,
): AutosaveRecordReadResult {
  const result = deserializeProject(record.projectJson);
  if (result.kind !== 'ok') {
    return { kind: result.kind === 'invalid' ? 'invalid' : 'unsupported-version' };
  }
  // Desktop Free restores Pro work only from an autosave sealed here (ADR-592).
  if (unadmittedProFeatures(result.project).length > 0)
    trustIfSealedHere(result.project, record.projectJson);
  return {
    kind: 'ok',
    snapshot: {
      project: result.project,
      savedAt: record.savedAt,
      storageKey,
      ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
    },
  };
}

export class UnsupportedAutosaveVersionError extends Error {
  constructor() {
    super('This autosave needs a different app version and has been retained.');
    this.name = 'UnsupportedAutosaveVersionError';
  }
}

export function hasUnsupportedAutosaveEnvelope(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const version = (value as Record<string, unknown>)['schemaVersion'];
  return (
    typeof version === 'number' && Number.isFinite(version) && version > AUTOSAVE_SCHEMA_VERSION
  );
}

// Mutators inspect the persisted version too: a read-time warning alone would
// still let interval writes, beforeunload, or manual-save cleanup destroy it.
// Current project versions need no normalization on this mutation path.
export function requireSupportedAutosaveVersion(value: unknown): void {
  if (hasUnsupportedAutosaveEnvelope(value)) throw new UnsupportedAutosaveVersionError();
  if (typeof value !== 'object' || value === null) return;
  const json = (value as Record<string, unknown>)['projectJson'];
  if (typeof json !== 'string') return;
  let project: unknown;
  try {
    project = JSON.parse(json);
  } catch {
    return;
  }
  if (typeof project !== 'object' || project === null) return;
  if ((project as Record<string, unknown>)['schemaVersion'] === PROJECT_SCHEMA_VERSION) return;
  const result = deserializeProjectValue(project);
  if (result.kind === 'schema-too-new' || result.kind === 'schema-too-old') {
    throw new UnsupportedAutosaveVersionError();
  }
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
