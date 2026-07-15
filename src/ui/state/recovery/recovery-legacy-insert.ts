import type { JobCheckpoint } from '../../../core/recovery';
import type { LegacyFingerprintOnlyArtifactV1 } from './execution-artifact';
import { matchesStoredArtifact } from './recovery-artifact-identity';
import type { RecoveryStorageBackend } from './recovery-backend';
import { validRecoverySlots } from './recovery-model';

export async function insertLegacyRecoveryCapsule(args: {
  readonly backend: RecoveryStorageBackend;
  readonly generation: number;
  readonly artifact: LegacyFingerprintOnlyArtifactV1;
  readonly checkpoint: JobCheckpoint;
}): Promise<'inserted' | 'occupied' | 'conflict'> {
  const inserted = await args.backend.putArtifact({
    runId: args.artifact.runId,
    generation: args.generation,
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
