import { useEffect, useSyncExternalStore } from 'react';
import {
  recoveryRepository,
  type RecoveryRepository,
  type RecoveryRepositorySnapshot,
} from './recovery';

/** React bridge for the sealed recovery repository. Reading this snapshot is
 * observational only; opening recovery UI never claims or activates a run. */
export function useRecoveryRepositorySnapshot(
  repository: RecoveryRepository = recoveryRepository,
): RecoveryRepositorySnapshot {
  const snapshot = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    repository.getSnapshot,
  );

  useEffect(() => {
    void repository.initialize();
  }, [repository]);

  return snapshot;
}
