import type { RecoveryArtifactV1 } from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryGenerationStore } from './recovery-generation';
import {
  parseRecoverySlots,
  type RecoveryRepositoryResult,
  type RecoveryRepositorySnapshot,
  type StoredRecoveryArtifact,
} from './recovery-model';
import { recoveryOk as ok } from './recovery-result';
import type {
  RecoveryAuthoritativeResetBase,
  RecoveryRepositoryState,
} from './recovery-repository-state';
import { hydrateRecoveryState } from './recovery-snapshot';

export class RecoverySnapshotCoordinator {
  private verifiedArtifacts: ReadonlyMap<string, RecoveryArtifactV1> = new Map();

  constructor(
    private readonly options: {
      readonly backend: RecoveryStorageBackend;
      readonly generationStore: RecoveryGenerationStore;
      readonly state: RecoveryRepositoryState;
      readonly storageFailure: (
        operation: string,
        error: unknown,
      ) => RecoveryRepositoryResult<RecoveryRepositorySnapshot>;
    },
  ) {}

  clear(): void {
    this.verifiedArtifacts = new Map();
  }

  async refresh(args?: {
    readonly reuseVerifiedArtifacts?: boolean;
    readonly additionalArtifacts?: ReadonlyArray<StoredRecoveryArtifact>;
    readonly authoritativeResetBase?: RecoveryAuthoritativeResetBase;
  }): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    const resetBase = {
      snapshot: this.options.state.snapshot,
      slotRevision: this.options.state.slotRevision,
    };
    try {
      const marker = this.options.generationStore.read();
      const rawSlots = await this.options.backend.readSlots();
      const parsed = parseRecoverySlots(rawSlots, marker);
      const { slots } = parsed;
      if (slots.generation > marker) this.options.generationStore.write(slots.generation);
      const known = this.knownArtifacts(slots.generation, args);
      const hydrated = await hydrateRecoveryState(this.options.backend, slots, known);
      const published = this.options.state.publish(
        hydrated.snapshot,
        slots.revision,
        parsed.accepted ? args?.authoritativeResetBase : resetBase,
      );
      if (published) this.verifiedArtifacts = hydrated.artifacts;
      return ok(this.options.state.snapshot);
    } catch (error) {
      return this.options.storageFailure('read recovery data', error);
    }
  }

  private knownArtifacts(
    generation: number,
    args:
      | {
          readonly reuseVerifiedArtifacts?: boolean;
          readonly additionalArtifacts?: ReadonlyArray<StoredRecoveryArtifact>;
        }
      | undefined,
  ): ReadonlyMap<string, RecoveryArtifactV1> {
    const known = new Map<string, RecoveryArtifactV1>();
    if (
      args?.reuseVerifiedArtifacts === true &&
      this.options.state.snapshot.generation === generation
    ) {
      for (const [runId, artifact] of this.verifiedArtifacts) known.set(runId, artifact);
    }
    for (const record of args?.additionalArtifacts ?? []) {
      if (record.generation === generation) known.set(record.runId, record.artifact);
    }
    return known;
  }
}
