// The durable Start handoff record: its shape and its strict parser. Lifted
// out of recovery-model when the owner lease gained a renewal stamp and the
// model reached its line budget; recovery-model re-exports the type.

import type { JobCheckpoint } from '../../../core/recovery';
import type { RunId } from './execution-artifact';
import { parsePendingStartIntent } from './start-intent';

export type PendingStartRecord = {
  readonly runId: RunId;
  readonly kind: 'fresh' | 'supervised-recovery';
  readonly sendableLines: number;
  readonly armedAtIso: string;
  /** ADR-337: what a fresh Start arms BEFORE the first wire byte, standing in
   * for the execution archive until the controller has accepted the program.
   * Absent on a handoff armed against an already-staged artifact, which is
   * still how supervised recovery arms. */
  readonly intent?: JobCheckpoint;
  /** When the live window that armed an intent last renewed its owner lease.
   * It renews while it builds the archive after acceptance, so another window
   * reconciles only a record its owner stopped renewing. */
  readonly leaseRenewedAtIso?: string;
  readonly sourceRecovery?: {
    readonly runId: RunId;
    readonly revision: number;
    readonly attemptId: string;
  };
};

export function parsePendingStart(value: unknown): PendingStartRecord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const base = parsePendingStartBase(value);
  if (base === undefined) return undefined;
  if (base.kind === 'fresh') {
    return value['sourceRecovery'] === undefined ? base : undefined;
  }
  // Only a fresh Start arms from an intent; a supervised recovery handoff is
  // always armed against an artifact that is already staged.
  if (base.intent !== undefined) return undefined;
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
  const intent = parsePendingStartIntent(value['intent'], sendableLines);
  if (intent === undefined) return undefined;
  // A liveness hint, not operator-facing data: an unreadable one is dropped,
  // which measures the lease from arming as before, rather than failing the
  // whole slot record closed.
  const renewed = value['leaseRenewedAtIso'];
  const lease = typeof renewed === 'string' ? { leaseRenewedAtIso: renewed } : {};
  return { runId, kind, sendableLines, armedAtIso, ...intent, ...lease };
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
