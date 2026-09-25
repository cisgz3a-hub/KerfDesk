import type { LegacyCheckpointStorage } from './legacy-checkpoint-migration';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryGenerationStore } from './recovery-generation';
import type { RecoveryRunLocks } from './recovery-run-lock';

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
  /** Web Locks naming each run this window has pending or active (ADR-369
   * Amendment 1). Defaults to the browser's; tests pass one shared manager. */
  readonly runLocks?: RecoveryRunLocks;
};
