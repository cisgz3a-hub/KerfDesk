import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { migrateToCurrent } from './migrations';
import { validateArchiveBooleanCompounds } from './project-archive-compound-admission';

type ArchiveRead =
  | { readonly ok: true; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

export function readProjectArchive(json: string, forbidden: readonly string[]): ArchiveRead {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'invalid project' };
  const record = raw as Record<string, unknown>;
  if (forbidden.some((key) => record[key] !== undefined))
    return { ok: false, reason: 'nested workflow archives are not supported' };
  const version = record['schemaVersion'];
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > PROJECT_SCHEMA_VERSION
  )
    return { ok: false, reason: 'unsupported schema version' };
  const migrated = migrateToCurrent(record, version);
  return migrated.kind === 'ok'
    ? { ok: true, raw: migrated.raw }
    : { ok: false, reason: 'unavailable migration' };
}

export function validateProjectArchive(
  json: string,
  forbidden: readonly string[],
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  const loaded = readProjectArchive(json, forbidden);
  return loaded.ok ? validateArchiveProjectValue(loaded.raw, validate) : loaded.reason;
}

/** The callback validates nested archive shapes first; only then inspect retained geometry. */
export function validateArchiveProjectValue(
  raw: Record<string, unknown>,
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  return validate(raw) ?? validateArchiveBooleanCompounds(raw);
}
