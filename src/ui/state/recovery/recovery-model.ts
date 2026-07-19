import { parseOptionalJobInterruption, type JobInterruption } from '../../../core/recovery';
import type {
  ExecutionArtifactV1,
  LegacyFingerprintOnlyArtifactV1,
  RecoveryArtifactV1,
} from './execution-artifact';
import { isRunId, type RunId } from './execution-artifact';
import {
  artifactOriginMatchesPayload,
  type StoredRecoveryArtifactOrigin,
} from './recovery-artifact-origin';

export {
  CURRENT_EXECUTION_ARTIFACT_ORIGIN,
  LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
  MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
  type StoredRecoveryArtifactOrigin,
} from './recovery-artifact-origin';

export const RECOVERY_REPOSITORY_SCHEMA_VERSION = 3;
/** Hard parser-work cap for an untrusted persisted history envelope. Runtime
 * retention is lower; the extra headroom permits protected records to coexist
 * with the normal history window. */
export const MAX_PERSISTED_EXECUTION_HISTORY_INPUT_RUNS = 64;
const LEGACY_RECOVERY_REPOSITORY_SCHEMA_VERSION = 1;
const PREVIOUS_RECOVERY_REPOSITORY_SCHEMA_VERSION = 2;

export type ActiveRunRecord = {
  readonly runId: RunId;
  readonly ackedLines: number;
  readonly sendableLines: number;
  readonly startedAtIso: string;
  readonly updatedAtIso: string;
  readonly estimatedArtifactBytes?: number;
};

export type RecoveryClaim = {
  readonly attemptId: string;
  readonly claimedAtIso: string;
};

// A recovery claim is a LEASE, not a permanent lock. It exists to stop a second
// recovery attempt (and the read-only Review) from racing an in-flight one. A
// crash between claiming and arming the start would otherwise strand the claim
// forever, permanently blocking Review of a still-valid record (audit B4). An
// unreleased claim older than this lease is treated as abandoned: a fresh
// attempt may supersede it and Review re-opens. The window is far longer than
// the seconds an attempt needs to arm or fail, so it never expires a genuinely
// active attempt; the live recovery Start is independently re-authorized before
// any motion regardless (recovery-start-authorization, #203).
export const RECOVERY_CLAIM_LEASE_MS = 5 * 60 * 1000;

export function recoveryClaimIsExpired(claim: RecoveryClaim, nowMs: number): boolean {
  const claimedMs = Date.parse(claim.claimedAtIso);
  // An unparseable timestamp fails closed — keep the claim active so a corrupt
  // record never silently unlocks recovery.
  if (Number.isNaN(claimedMs)) return false;
  return nowMs - claimedMs >= RECOVERY_CLAIM_LEASE_MS;
}

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

export type PendingStartRecord = {
  readonly runId: RunId;
  readonly kind: 'fresh' | 'supervised-recovery';
  readonly sendableLines: number;
  readonly armedAtIso: string;
  readonly sourceRecovery?: {
    readonly runId: RunId;
    readonly revision: number;
    readonly attemptId: string;
  };
};

export type ExecutionHistoryRecord = {
  readonly runId: RunId;
  readonly terminalKind: 'completed' | 'interrupted';
  readonly startedAtIso: string;
  readonly terminalAtIso: string;
  readonly ackedLines: number;
  readonly sendableLines: number;
  /** Deterministic approximation of the full retained structured-clone payload. */
  readonly estimatedArtifactBytes: number;
  readonly interruption?: JobInterruption;
};

export type PersistedRecoverySlots = {
  readonly schemaVersion: typeof RECOVERY_REPOSITORY_SCHEMA_VERSION;
  readonly generation: number;
  readonly revision: number;
  readonly activeRun: ActiveRunRecord | null;
  readonly recoveryCapsule: RecoveryCapsuleRecord | null;
  readonly lastCompletedReceipt: LastCompletedReceiptRecord | null;
  readonly pendingStart: PendingStartRecord | null;
  readonly executionHistory: ReadonlyArray<ExecutionHistoryRecord>;
};

export type StoredRecoveryArtifact = {
  readonly runId: RunId;
  readonly generation: number;
  readonly origin: StoredRecoveryArtifactOrigin;
  readonly stagingLeaseExpiresAtEpochMs?: number;
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
  readonly pendingStart: PendingStartRecord | null;
  readonly executionHistory: ReadonlyArray<ExecutionHistoryRecord>;
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
  pendingStart: null,
  executionHistory: [],
};

export function emptyRecoverySlots(generation: number): PersistedRecoverySlots {
  return {
    schemaVersion: RECOVERY_REPOSITORY_SCHEMA_VERSION,
    generation,
    revision: 0,
    activeRun: null,
    recoveryCapsule: null,
    lastCompletedReceipt: null,
    pendingStart: null,
    executionHistory: [],
  };
}

export function validRecoverySlots(
  value: unknown,
  minimumGeneration: number,
): PersistedRecoverySlots {
  return parseRecoverySlots(value, minimumGeneration).slots;
}

export type ParsedRecoverySlots = {
  readonly slots: PersistedRecoverySlots;
  readonly accepted: boolean;
};

export function parseRecoverySlots(value: unknown, minimumGeneration: number): ParsedRecoverySlots {
  if (!isRecord(value)) return rejectedSlots(minimumGeneration);
  const schemaVersion = value['schemaVersion'];
  if (!isSupportedSchemaVersion(schemaVersion)) {
    return rejectedSlots(minimumGeneration);
  }
  const generation = value['generation'];
  const revision = value['revision'];
  if (!isNonNegativeInteger(generation) || generation < minimumGeneration) {
    return rejectedSlots(minimumGeneration);
  }
  if (!isNonNegativeInteger(revision)) return rejectedSlots(generation);
  const activeRun = parseActiveRun(value['activeRun']);
  const recoveryCapsule = parseRecoveryCapsule(value['recoveryCapsule']);
  const lastCompletedReceipt = parseCompletedReceipt(value['lastCompletedReceipt']);
  const pendingStart = parsePendingStartForSchema(value['pendingStart'], schemaVersion);
  const executionHistory = parseHistoryForSchema(value['executionHistory'], schemaVersion);
  const parsedSlots = {
    activeRun,
    recoveryCapsule,
    lastCompletedReceipt,
    pendingStart,
    executionHistory,
  };
  if (!parsedSlotsAreValid(parsedSlots)) {
    return rejectedSlots(generation);
  }
  return {
    accepted: true,
    slots: {
      schemaVersion: RECOVERY_REPOSITORY_SCHEMA_VERSION,
      generation,
      revision,
      ...parsedSlots,
    },
  };
}

function rejectedSlots(generation: number): ParsedRecoverySlots {
  return { slots: emptyRecoverySlots(generation), accepted: false };
}

function isSupportedSchemaVersion(value: unknown): value is 1 | 2 | 3 {
  return (
    value === RECOVERY_REPOSITORY_SCHEMA_VERSION ||
    value === PREVIOUS_RECOVERY_REPOSITORY_SCHEMA_VERSION ||
    value === LEGACY_RECOVERY_REPOSITORY_SCHEMA_VERSION
  );
}

function parsePendingStartForSchema(
  value: unknown,
  schemaVersion: 1 | 2 | 3,
): PendingStartRecord | null | undefined {
  return schemaVersion === LEGACY_RECOVERY_REPOSITORY_SCHEMA_VERSION
    ? null
    : parsePendingStart(value);
}

function parseHistoryForSchema(
  value: unknown,
  schemaVersion: 1 | 2 | 3,
): ReadonlyArray<ExecutionHistoryRecord> {
  return schemaVersion === RECOVERY_REPOSITORY_SCHEMA_VERSION ? parseExecutionHistory(value) : [];
}

function parsedSlotsAreValid(value: {
  readonly activeRun: ActiveRunRecord | null | undefined;
  readonly recoveryCapsule: RecoveryCapsuleRecord | null | undefined;
  readonly lastCompletedReceipt: LastCompletedReceiptRecord | null | undefined;
  readonly pendingStart: PendingStartRecord | null | undefined;
  readonly executionHistory: ReadonlyArray<ExecutionHistoryRecord>;
}): value is {
  readonly activeRun: ActiveRunRecord | null;
  readonly recoveryCapsule: RecoveryCapsuleRecord | null;
  readonly lastCompletedReceipt: LastCompletedReceiptRecord | null;
  readonly pendingStart: PendingStartRecord | null;
  readonly executionHistory: ReadonlyArray<ExecutionHistoryRecord>;
} {
  return Object.values(value).every((entry) => entry !== undefined);
}

export function validStoredArtifact(value: unknown): StoredRecoveryArtifact | null {
  if (!isRecord(value)) return null;
  const runId = value['runId'];
  const generation = value['generation'];
  const origin = value['origin'];
  const stagingLeaseExpiresAtEpochMs = value['stagingLeaseExpiresAtEpochMs'];
  const artifact = value['artifact'];
  if (typeof runId !== 'string' || !isNonNegativeInteger(generation)) return null;
  if (
    stagingLeaseExpiresAtEpochMs !== undefined &&
    !isNonNegativeInteger(stagingLeaseExpiresAtEpochMs)
  ) {
    return null;
  }
  if (!isRecord(artifact) || artifact['runId'] !== runId) return null;
  if (!artifactOriginMatchesPayload(origin, artifact)) return null;
  return value as StoredRecoveryArtifact;
}

function parseActiveRun(value: unknown): ActiveRunRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isProgressRecord(value)) return undefined;
  if (typeof value['startedAtIso'] !== 'string') return undefined;
  if (
    value['estimatedArtifactBytes'] !== undefined &&
    !isNonNegativeInteger(value['estimatedArtifactBytes'])
  ) {
    return undefined;
  }
  return value as ActiveRunRecord;
}

function parseExecutionHistory(value: unknown): ReadonlyArray<ExecutionHistoryRecord> {
  // Execution history is additive forensic data. A corrupt history envelope or
  // entry must never erase otherwise valid active/recovery/start state.
  if (!Array.isArray(value)) return [];
  const records: ExecutionHistoryRecord[] = [];
  const newestCandidates = value.slice(-MAX_PERSISTED_EXECUTION_HISTORY_INPUT_RUNS);
  for (const candidate of newestCandidates) {
    const record = parseExecutionHistoryRecord(candidate);
    if (record !== undefined) records.push(record);
  }
  return records;
}

function parseExecutionHistoryRecord(value: unknown): ExecutionHistoryRecord | undefined {
  if (!isRecord(value) || !hasValidHistoryProgress(value)) return undefined;
  const terminalKind = value['terminalKind'];
  if (terminalKind !== 'completed' && terminalKind !== 'interrupted') return undefined;
  if (terminalKind === 'interrupted' && !isBoundedHistoryInterruption(value['interruption'])) {
    return undefined;
  }
  if (terminalKind === 'completed' && value['interruption'] !== undefined) return undefined;
  return value as ExecutionHistoryRecord;
}

function hasValidHistoryProgress(value: Record<string, unknown>): boolean {
  if (!isRunId(value['runId'])) return false;
  if (!isBoundedHistoryString(value['startedAtIso'], 128)) return false;
  if (!isBoundedHistoryString(value['terminalAtIso'], 128)) return false;
  if (!isNonNegativeInteger(value['ackedLines'])) return false;
  if (!isNonNegativeInteger(value['sendableLines'])) return false;
  if (value['ackedLines'] > value['sendableLines']) return false;
  return isNonNegativeInteger(value['estimatedArtifactBytes']);
}

function isBoundedHistoryInterruption(value: unknown): value is JobInterruption {
  if (!isInterruption(value) || !isRecord(value)) return false;
  if (!isBoundedHistoryString(value['message'], 16_384, true)) return false;
  return (
    value['rejectedLine'] === undefined ||
    isBoundedHistoryString(value['rejectedLine'], 16_384, true)
  );
}

function isBoundedHistoryString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= maxLength;
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

function parsePendingStart(value: unknown): PendingStartRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const base = parsePendingStartBase(value);
  if (base === undefined) return undefined;
  if (base.kind === 'fresh') {
    return value['sourceRecovery'] === undefined ? base : undefined;
  }
  return parseRecoveryPendingStart(base, value['sourceRecovery']);
}

function parsePendingStartBase(
  value: unknown,
): Omit<PendingStartRecord, 'sourceRecovery'> | undefined {
  if (!isRecord(value)) return undefined;
  const runId = value['runId'];
  const kind = value['kind'];
  const sendableLines = value['sendableLines'];
  const armedAtIso = value['armedAtIso'];
  if (
    typeof runId !== 'string' ||
    (kind !== 'fresh' && kind !== 'supervised-recovery') ||
    !isNonNegativeInteger(sendableLines) ||
    typeof armedAtIso !== 'string'
  ) {
    return undefined;
  }
  return { runId, kind, sendableLines, armedAtIso };
}

function parseRecoveryPendingStart(
  base: Omit<PendingStartRecord, 'sourceRecovery'>,
  sourceRecovery: unknown,
): PendingStartRecord | undefined {
  if (!isRecord(sourceRecovery)) return undefined;
  const sourceRunId = sourceRecovery['runId'];
  const revision = sourceRecovery['revision'];
  const attemptId = sourceRecovery['attemptId'];
  if (
    typeof sourceRunId !== 'string' ||
    !isNonNegativeInteger(revision) ||
    typeof attemptId !== 'string' ||
    attemptId.length === 0
  ) {
    return undefined;
  }
  return {
    ...base,
    kind: 'supervised-recovery',
    sourceRecovery: { runId: sourceRunId, revision, attemptId },
  };
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
