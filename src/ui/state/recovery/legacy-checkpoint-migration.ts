import { parseJobCheckpoint, type JobCheckpoint } from '../../../core/recovery';
import type { LegacyFingerprintOnlyArtifactV1, RunId } from './execution-artifact';

export const LEGACY_JOB_CHECKPOINT_STORAGE_KEY = 'laserforge.job-checkpoint.v1';

export type LegacyCheckpointStorage = {
  readonly read: () => string | null;
  readonly clear: () => void;
};

export function browserLegacyCheckpointStorage(storage: Storage | null): LegacyCheckpointStorage {
  return {
    read: () => {
      try {
        return storage?.getItem(LEGACY_JOB_CHECKPOINT_STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    clear: () => {
      try {
        storage?.removeItem(LEGACY_JOB_CHECKPOINT_STORAGE_KEY);
      } catch {
        // A failed cleanup is harmless; the next initialization retries it.
      }
    },
  };
}

export function readLegacyCheckpoint(storage: LegacyCheckpointStorage): JobCheckpoint | null {
  const raw = storage.read();
  if (raw === null) return null;
  const parsed = parseJobCheckpoint(raw);
  if (parsed === null) storage.clear();
  return parsed;
}

export function legacyArtifact(
  checkpoint: JobCheckpoint,
  migratedAtIso: string,
): LegacyFingerprintOnlyArtifactV1 {
  return {
    schemaVersion: 1,
    kind: 'legacy-fingerprint-only',
    runId: legacyRunId(checkpoint),
    createdAtIso: checkpoint.startedAtIso,
    migratedAtIso,
    fingerprint: checkpoint.fingerprint,
    sendableLines: checkpoint.sendableLines,
    machineKind: checkpoint.machineKind,
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  };
}

function legacyRunId(checkpoint: JobCheckpoint): RunId {
  const hash = checkpoint.fingerprint.fnv1a.toString(16).padStart(8, '0');
  const stamp = checkpoint.startedAtIso.replace(/[^0-9A-Za-z]/g, '').slice(0, 32);
  return `legacy-${hash}-${stamp}`;
}
