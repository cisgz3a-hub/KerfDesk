import type { RecoveryArtifactV1 } from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import { validStoredArtifact } from './recovery-model';

export async function matchesStoredArtifact(
  backend: RecoveryStorageBackend,
  generation: number,
  artifact: RecoveryArtifactV1,
): Promise<boolean> {
  const stored = validStoredArtifact(await backend.getArtifact(artifact.runId));
  if (stored === null || stored.generation !== generation) return false;
  const existing = stored.artifact;
  if (existing.kind !== artifact.kind) return false;
  if (existing.kind === 'legacy-fingerprint-only') {
    return existing.createdAtIso === artifact.createdAtIso;
  }
  return (
    artifact.kind === 'exact-execution' &&
    existing.createdAtIso === artifact.createdAtIso &&
    existing.executionSignature === artifact.executionSignature &&
    existing.gcode === artifact.gcode
  );
}
