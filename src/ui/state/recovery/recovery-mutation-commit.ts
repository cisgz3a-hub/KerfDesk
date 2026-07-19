import type { RecoveryStorageBackend } from './recovery-backend';
import type { RunId } from './execution-artifact';
import { parseRecoverySlots, type PersistedRecoverySlots } from './recovery-model';

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
    return args.mutate(parsed.slots);
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
