import type { JobCheckpoint } from '../../../core/recovery';
import {
  isRecoveryArtifact,
  type LegacyFingerprintOnlyArtifactV1,
  type RecoveryArtifactV1,
} from './execution-artifact';
import { matchesStoredArtifact, sameRecoveryProgramIdentity } from './recovery-artifact-identity';
import { storedExecutionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import type { RecoveryStorageBackend } from './recovery-backend';
import {
  LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
  validRecoverySlots,
  validStoredArtifact,
} from './recovery-model';
import { startIntentStandInArtifact } from './start-intent';

export async function insertLegacyRecoveryCapsule(args: {
  readonly backend: RecoveryStorageBackend;
  readonly generation: number;
  readonly artifact: LegacyFingerprintOnlyArtifactV1;
  readonly checkpoint: JobCheckpoint;
}): Promise<'inserted' | 'occupied' | 'conflict'> {
  const inserted = await args.backend.putArtifact({
    runId: args.artifact.runId,
    generation: args.generation,
    origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
    artifact: args.artifact,
  });
  if (!inserted && !(await matchesStoredArtifact(args.backend, args.generation, args.artifact))) {
    return 'conflict';
  }
  const capsuleInserted = await args.backend.mutateSlots((raw) => {
    const slots = validRecoverySlots(raw, args.generation);
    if (slots.activeRun !== null || slots.recoveryCapsule !== null) {
      return { slots, value: false };
    }
    const revision = slots.revision + 1;
    return {
      slots: {
        ...slots,
        revision,
        recoveryCapsule: {
          runId: args.artifact.runId,
          artifactKind: args.artifact.kind,
          revision,
          ackedLines: args.checkpoint.ackedLines,
          sendableLines: args.checkpoint.sendableLines,
          interruption: args.checkpoint.interruption ?? {
            kind: 'unknown',
            message: 'An earlier session left an interrupted job checkpoint.',
          },
          updatedAtIso: args.checkpoint.updatedAtIso,
        },
      },
      value: true,
    };
  });
  return capsuleInserted ? 'inserted' : 'occupied';
}

/** ADR-337: write the fingerprint-only stand-in for an intent whose run never
 * reached its archive, so the capsule reconciliation is about to write points
 * at a real artifact. Idempotent, and an artifact already stored under this
 * run wins: an accepted run's real archive must never be replaced by the
 * stand-in it superseded. */
export async function putStartIntentStandIn(args: {
  readonly backend: RecoveryStorageBackend;
  readonly generation: number;
  readonly nowIso: () => string;
  readonly onFailure: (error: unknown) => void;
  readonly runId: string;
  readonly intent: JobCheckpoint;
}): Promise<RecoveryArtifactV1['kind'] | null> {
  try {
    const inserted = await args.backend.putArtifact({
      runId: args.runId,
      generation: args.generation,
      origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
      artifact: startIntentStandInArtifact(args.runId, args.intent, args.nowIso()),
    });
    if (inserted) return 'legacy-fingerprint-only';
    // A crash can leave the real archive, or an earlier reconciliation's
    // stand-in, committed before its slot transition. Neither is in execution
    // history yet. Read the immutable row directly and preserve its kind.
    const stored = validStoredArtifact(await args.backend.getArtifact(args.runId));
    if (
      stored === null ||
      stored.runId !== args.runId ||
      stored.generation !== args.generation ||
      !isRecoveryArtifact(stored.artifact) ||
      !sameRecoveryProgramIdentity(stored.artifact, args.intent)
    ) {
      return null;
    }
    return stored.artifact.kind === 'legacy-fingerprint-only' ||
      (await storedExecutionArtifactIntegrityIsValid(stored))
      ? stored.artifact.kind
      : null;
  } catch (error) {
    args.onFailure(error);
    return null;
  }
}
