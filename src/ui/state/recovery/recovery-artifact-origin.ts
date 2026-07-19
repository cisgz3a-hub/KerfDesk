import {
  EXECUTION_ARTIFACT_SCHEMA_VERSION,
  LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION,
} from './execution-artifact';

export const CURRENT_EXECUTION_ARTIFACT_ORIGIN = 'current-v2' as const;
export const MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN = 'pre-provenance-db-v1' as const;
export const LEGACY_CHECKPOINT_ARTIFACT_ORIGIN = 'legacy-checkpoint' as const;
export type StoredRecoveryArtifactOrigin =
  | typeof CURRENT_EXECUTION_ARTIFACT_ORIGIN
  | typeof MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN
  | typeof LEGACY_CHECKPOINT_ARTIFACT_ORIGIN;

export function artifactOriginMatchesPayload(
  origin: unknown,
  artifact: Record<string, unknown>,
): origin is StoredRecoveryArtifactOrigin {
  if (origin === CURRENT_EXECUTION_ARTIFACT_ORIGIN) {
    return (
      artifact['kind'] === 'exact-execution' &&
      artifact['schemaVersion'] === EXECUTION_ARTIFACT_SCHEMA_VERSION
    );
  }
  if (origin === MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN) {
    return (
      artifact['kind'] === 'exact-execution' &&
      artifact['schemaVersion'] === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION
    );
  }
  return (
    origin === LEGACY_CHECKPOINT_ARTIFACT_ORIGIN &&
    artifact['kind'] === 'legacy-fingerprint-only' &&
    artifact['schemaVersion'] === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION
  );
}
