import { parseOptionalJobInterruption, type JobInterruption } from '../../../core/recovery';
import type {
  ExecutionArtifactV1,
  LegacyFingerprintOnlyArtifactV1,
  RecoveryArtifactV1,
  RunId,
} from './execution-artifact';

export const RECOVERY_REPOSITORY_SCHEMA_VERSION = 1;

export type ActiveRunRecord = {
  readonly runId: RunId;
  readonly ackedLines: number;
  readonly sendableLines: number;
  readonly startedAtIso: string;
  readonly updatedAtIso: string;
};

export type RecoveryClaim = {
  readonly attemptId: string;
  readonly claimedAtIso: string;
};

export type RecoveryCapsuleRecord = {
  readonly runId: RunId;
  readonly artifactKind: RecoveryArtifactV1['kind'];
  readonly revision: number;
  readonly ackedLines: number;
  readonly sendableLines: number;
  readonly interruption: JobInterruption;
  readonly updatedAtIso: string;
  readonly claim?: RecoveryClaim;
};

export type LastCompletedReceiptRecord = {
  readonly runId: RunId;
  readonly completedAtIso: string;
};

export type PersistedRecoverySlots = {
  readonly schemaVersion: typeof RECOVERY_REPOSITORY_SCHEMA_VERSION;
  readonly generation: number;
  readonly revision: number;
  readonly activeRun: ActiveRunRecord | null;
  readonly recoveryCapsule: RecoveryCapsuleRecord | null;
  readonly lastCompletedReceipt: LastCompletedReceiptRecord | null;
};

export type StoredRecoveryArtifact = {
  readonly runId: RunId;
  readonly generation: number;
  readonly artifact: RecoveryArtifactV1;
};

export type ActiveRun = ActiveRunRecord & { readonly artifact: ExecutionArtifactV1 };
export type RecoveryCapsule = RecoveryCapsuleRecord & { readonly artifact: RecoveryArtifactV1 };
export type LastCompletedReceipt = LastCompletedReceiptRecord & {
  readonly artifact: ExecutionArtifactV1;
};

export type RecoveryRepositorySnapshot = {
  readonly loaded: boolean;
  readonly generation: number;
  readonly activeRun: ActiveRun | null;
  readonly recoveryCapsule: RecoveryCapsule | null;
  readonly lastCompletedReceipt: LastCompletedReceipt | null;
};

export type RecoveryRepositoryError = 'storage-unavailable' | 'not-found' | 'conflict';
export type RecoveryRepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RecoveryRepositoryError };

export const UNLOADED_RECOVERY_SNAPSHOT: RecoveryRepositorySnapshot = {
  loaded: false,
  generation: 0,
  activeRun: null,
  recoveryCapsule: null,
  lastCompletedReceipt: null,
};

export function emptyRecoverySlots(generation: number): PersistedRecoverySlots {
  return {
    schemaVersion: RECOVERY_REPOSITORY_SCHEMA_VERSION,
    generation,
    revision: 0,
    activeRun: null,
    recoveryCapsule: null,
    lastCompletedReceipt: null,
  };
}

export function validRecoverySlots(
  value: unknown,
  minimumGeneration: number,
): PersistedRecoverySlots {
  if (!isRecord(value)) return emptyRecoverySlots(minimumGeneration);
  if (value['schemaVersion'] !== RECOVERY_REPOSITORY_SCHEMA_VERSION) {
    return emptyRecoverySlots(minimumGeneration);
  }
  const generation = value['generation'];
  const revision = value['revision'];
  if (!isNonNegativeInteger(generation) || generation < minimumGeneration) {
    return emptyRecoverySlots(minimumGeneration);
  }
  if (!isNonNegativeInteger(revision)) return emptyRecoverySlots(generation);
  const activeRun = parseActiveRun(value['activeRun']);
  const recoveryCapsule = parseRecoveryCapsule(value['recoveryCapsule']);
  const lastCompletedReceipt = parseCompletedReceipt(value['lastCompletedReceipt']);
  if (
    activeRun === undefined ||
    recoveryCapsule === undefined ||
    lastCompletedReceipt === undefined
  ) {
    return emptyRecoverySlots(generation);
  }
  return {
    schemaVersion: RECOVERY_REPOSITORY_SCHEMA_VERSION,
    generation,
    revision,
    activeRun,
    recoveryCapsule,
    lastCompletedReceipt,
  };
}

export function validStoredArtifact(value: unknown): StoredRecoveryArtifact | null {
  if (!isRecord(value)) return null;
  const runId = value['runId'];
  const generation = value['generation'];
  const artifact = value['artifact'];
  if (typeof runId !== 'string' || !isNonNegativeInteger(generation)) return null;
  if (!isRecord(artifact) || artifact['runId'] !== runId) return null;
  return value as StoredRecoveryArtifact;
}

function parseActiveRun(value: unknown): ActiveRunRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isProgressRecord(value)) return undefined;
  if (typeof value['startedAtIso'] !== 'string') return undefined;
  return value as ActiveRunRecord;
}

function parseRecoveryCapsule(value: unknown): RecoveryCapsuleRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isProgressRecord(value)) return undefined;
  if (
    value['artifactKind'] !== 'exact-execution' &&
    value['artifactKind'] !== 'legacy-fingerprint-only'
  ) {
    return undefined;
  }
  if (!isNonNegativeInteger(value['revision']) || !isInterruption(value['interruption'])) {
    return undefined;
  }
  const claim = value['claim'];
  if (claim !== undefined && !isClaim(claim)) return undefined;
  return value as RecoveryCapsuleRecord;
}

function parseCompletedReceipt(value: unknown): LastCompletedReceiptRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value['runId'] !== 'string' || typeof value['completedAtIso'] !== 'string') {
    return undefined;
  }
  return value as LastCompletedReceiptRecord;
}

function isProgressRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value['runId'] === 'string' &&
    isNonNegativeInteger(value['ackedLines']) &&
    isNonNegativeInteger(value['sendableLines']) &&
    value['ackedLines'] <= value['sendableLines'] &&
    typeof value['updatedAtIso'] === 'string'
  );
}

function isClaim(value: unknown): value is RecoveryClaim {
  return (
    isRecord(value) &&
    typeof value['attemptId'] === 'string' &&
    value['attemptId'].length > 0 &&
    typeof value['claimedAtIso'] === 'string'
  );
}

function isInterruption(value: unknown): value is JobInterruption {
  return parseOptionalJobInterruption(value)?.interruption !== undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { LegacyFingerprintOnlyArtifactV1 };
