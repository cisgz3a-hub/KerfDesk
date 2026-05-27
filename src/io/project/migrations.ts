// Migration dispatch — promotes older .lf2 documents to the current schema
// version (WORKFLOW.md F-A12). Phase A's PROJECT_SCHEMA_VERSION is 1, so
// no migrators ship yet — but the registry, the chain runner, and the
// "schema-too-old when no migrator covers this version" failure path all
// exist now so the first real migration (Phase D or Phase E) is a single
// table entry rather than rewriting deserialize-project.
//
// A migrator is a pure function: it takes the raw JSON-parsed object
// (a generic record) at version N and returns the equivalent at N+1.
// The dispatcher walks from sawVersion upward, applying each registered
// migrator in order, until it reaches PROJECT_SCHEMA_VERSION or finds a
// gap.

import { PROJECT_SCHEMA_VERSION } from '../../core/scene';

export type RawProject = Record<string, unknown>;
export type Migrator = (raw: RawProject) => RawProject;

export type MigrationResult =
  | { readonly kind: 'ok'; readonly raw: RawProject; readonly steps: ReadonlyArray<number> }
  | { readonly kind: 'no-path'; readonly stoppedAt: number };

// Registry. Keyed by FROM version: e.g. `1` means "migrate v1 → v2".
// Phase A ships empty. Phase D/E will add the first entries here.
const MIGRATORS: Readonly<Record<number, Migrator>> = {};

export function migrateToCurrent(
  raw: RawProject,
  sawVersion: number,
  registry: Readonly<Record<number, Migrator>> = MIGRATORS,
): MigrationResult {
  let current = raw;
  let v = sawVersion;
  const steps: number[] = [];
  while (v < PROJECT_SCHEMA_VERSION) {
    const migrator = registry[v];
    if (migrator === undefined) return { kind: 'no-path', stoppedAt: v };
    current = migrator(current);
    steps.push(v);
    v += 1;
  }
  return { kind: 'ok', raw: { ...current, schemaVersion: PROJECT_SCHEMA_VERSION }, steps };
}
