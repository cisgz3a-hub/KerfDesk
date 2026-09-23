import type { RecoveryStorageBackend } from './recovery-backend';
import type { RunId } from './execution-artifact';
import {
  parseRecoverySlots,
  RECOVERY_REPOSITORY_SCHEMA_VERSION,
  type ParsedRecoverySlots,
  type PersistedRecoverySlots,
} from './recovery-model';

type CommitResult<T> =
  | { readonly artifactExists: false }
  | {
      readonly artifactExists: true;
      readonly baseAccepted: boolean;
      readonly value: T;
    };

export async function commitRecoverySlotMutation<T>(args: {
  readonly backend: RecoveryStorageBackend;
  readonly minimumGeneration: number;
  readonly requiredArtifactRunId?: RunId;
  readonly mutate: (slots: PersistedRecoverySlots) => {
    readonly slots: PersistedRecoverySlots;
    readonly value: T;
  };
}): Promise<CommitResult<T>> {
  let baseAccepted = true;
  const apply = (raw: unknown) => {
    const parsed = parseRecoverySlots(raw, args.minimumGeneration);
    baseAccepted = parsed.accepted;
    const mutation = args.mutate(parsed.slots);
    return { ...mutation, unchanged: storedSlotsUnchanged(raw, parsed, mutation.slots) };
  };
  if (args.requiredArtifactRunId !== undefined) {
    const guarded = await args.backend.mutateSlotsWithArtifact(args.requiredArtifactRunId, apply);
    return guarded.artifactExists
      ? { artifactExists: true, baseAccepted, value: guarded.value }
      : guarded;
  }
  const value = await args.backend.mutateSlots(apply);
  return { artifactExists: true, baseAccepted, value };
}

/** A mutation that handed back its own parsed input left the stored record
 * as it was. Rejected, stale-generation or older-schema records still count
 * as changed: rewriting them is what sanitizes or migrates the slot. */
export function storedSlotsUnchanged(
  raw: unknown,
  parsed: ParsedRecoverySlots,
  next: PersistedRecoverySlots,
): boolean {
  return (
    next === parsed.slots &&
    parsed.accepted &&
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { readonly schemaVersion?: unknown }).schemaVersion ===
      RECOVERY_REPOSITORY_SCHEMA_VERSION
  );
}
