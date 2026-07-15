import { IndexedDbRecoveryStorageBackend } from './indexeddb-recovery-backend';
import { browserLegacyCheckpointStorage } from './legacy-checkpoint-migration';
import { availableLocalStorage, LocalStorageRecoveryGenerationStore } from './recovery-generation';
import { useToastStore } from '../toast-store';
import { RecoveryRepository, type RecoveryRepositoryWarning } from './recovery-repository';

const reportedWarningOperations = new Set<string>();

function reportRecoveryStorageWarning(warning: RecoveryRepositoryWarning): void {
  if (reportedWarningOperations.has(warning.operation)) return;
  reportedWarningOperations.add(warning.operation);
  useToastStore
    .getState()
    .pushToast(
      `Job recovery storage is unavailable while trying to ${warning.operation}. Normal jobs are unaffected.`,
      'warning',
    );
}

export const recoveryRepository = new RecoveryRepository({
  backend: new IndexedDbRecoveryStorageBackend(),
  generationStore: new LocalStorageRecoveryGenerationStore(),
  legacyStorage: browserLegacyCheckpointStorage(availableLocalStorage()),
  onWarning: reportRecoveryStorageWarning,
});
