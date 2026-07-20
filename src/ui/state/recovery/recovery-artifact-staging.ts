import { validStoredArtifact } from './recovery-model';

/** A staged artifact is written before its Start handoff is armed. Keep that
 * short cross-window gap durable so another tab's startup orphan sweep cannot
 * delete the artifact underneath the owner. */
export const STAGED_ARTIFACT_LEASE_MS = 60_000;

export function activeStoredArtifactStagingLeaseExpiry(
  value: unknown,
  generation: number,
  nowEpochMs: number,
): number | null {
  const record = validStoredArtifact(value);
  const expiresAt = record?.stagingLeaseExpiresAtEpochMs;
  return record?.generation === generation &&
    expiresAt !== undefined &&
    expiresAt > nowEpochMs &&
    expiresAt <= nowEpochMs + STAGED_ARTIFACT_LEASE_MS
    ? expiresAt
    : null;
}
