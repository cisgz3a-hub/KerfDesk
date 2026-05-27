// deserializeProject — parses a .lf2 string and returns a typed Project, or a
// structured error describing why it can't be loaded.
//
// Phase A scope: PROJECT_SCHEMA_VERSION = 1; older versions can't exist yet,
// newer versions trigger WORKFLOW.md F-A12 "schema-too-new" modal. Shape
// validation in Phase A is "trust the file was ours" — Zod-style schema
// validation is a Phase B improvement.

import { PROJECT_SCHEMA_VERSION, type Project } from '../../core/scene';
import { migrateToCurrent } from './migrations';

export type DeserializeResult =
  | { readonly kind: 'ok'; readonly project: Project; readonly migratedFrom?: number }
  | { readonly kind: 'schema-too-new'; readonly sawVersion: number }
  | { readonly kind: 'schema-too-old'; readonly sawVersion: number }
  | { readonly kind: 'invalid'; readonly reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deserializeProject(jsonText: string): DeserializeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }

  if (!isObject(raw)) {
    return { kind: 'invalid', reason: 'top-level value is not an object' };
  }

  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { kind: 'invalid', reason: 'missing or non-numeric schemaVersion' };
  }

  if (version > PROJECT_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: version };
  }
  // Migration path (F-A12). Phase A's migration registry is empty so any
  // v<1 file lands in `no-path` here; the moment Phase D/E registers a
  // 0→1 migrator this branch starts succeeding, no other code changes.
  let workingRaw: Record<string, unknown> = raw;
  let migratedFrom: number | undefined;
  if (version < PROJECT_SCHEMA_VERSION) {
    const migrated = migrateToCurrent(raw, version);
    if (migrated.kind === 'no-path') {
      return { kind: 'schema-too-old', sawVersion: version };
    }
    workingRaw = migrated.raw;
    migratedFrom = version;
  }

  // Top-level shape check (audit finding I-5). A `.lf2` with a truncated or
  // hand-edited body must reach the F-A12 "Could not open" modal, not crash
  // deep in the renderer. Field-level validation is a Phase C improvement.
  const shapeError = validateShape(workingRaw);
  if (shapeError !== null) return { kind: 'invalid', reason: shapeError };

  if (migratedFrom !== undefined) {
    return { kind: 'ok', project: workingRaw as Project, migratedFrom };
  }
  return { kind: 'ok', project: workingRaw as Project };
}

function validateShape(raw: Record<string, unknown>): string | null {
  if (!isObject(raw['device'])) return 'missing or invalid `device`';
  if (!isObject(raw['workspace'])) return 'missing or invalid `workspace`';
  const scene = raw['scene'];
  if (!isObject(scene)) return 'missing or invalid `scene`';
  if (!Array.isArray(scene['objects'])) return 'missing or invalid `scene.objects`';
  if (!Array.isArray(scene['layers'])) return 'missing or invalid `scene.layers`';
  return null;
}
