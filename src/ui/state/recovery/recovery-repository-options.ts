import type { LegacyCheckpointStorage } from './legacy-checkpoint-migration';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryGenerationStore } from './recovery-generation';

export type RecoveryRepositoryWarning = {
  readonly operation: string;
  readonly message: string;
};

export type RecoveryRepositoryOptions = {
  readonly backend: RecoveryStorageBackend;
  readonly generationStore: RecoveryGenerationStore;
  readonly legacyStorage: LegacyCheckpointStorage;
  readonly nowIso?: () => string;
  readonly onWarning?: (warning: RecoveryRepositoryWarning) => void;
  /** Called after this window committed a change to the recovery slots (not
   * after progress writes), so other windows can refresh their snapshot. */
  readonly onSlotsChanged?: () => void;
};
