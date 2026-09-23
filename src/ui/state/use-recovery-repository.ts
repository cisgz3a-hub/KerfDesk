import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { shallow } from 'zustand/shallow';
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

/** The same bridge, narrowed to the slots a component renders. A running job
 * publishes a new snapshot at every progress checkpoint; a consumer that does
 * not show active-run progress re-renders only when its slice changes
 * (shallowly). `select` must be a stable, module-level function. */
export function useRecoveryRepositorySelection<T>(
  select: (snapshot: RecoveryRepositorySnapshot) => T,
  repository: RecoveryRepository = recoveryRepository,
): T {
  const getSelection = useMemo(
    () => cachedSelection(repository.getSnapshot, select),
    [repository, select],
  );
  const selection = useSyncExternalStore(repository.subscribe, getSelection, getSelection);

  useEffect(() => {
    void repository.initialize();
  }, [repository]);

  return selection;
}

function cachedSelection<T>(
  getSnapshot: () => RecoveryRepositorySnapshot,
  select: (snapshot: RecoveryRepositorySnapshot) => T,
): () => T {
  let cached: { readonly snapshot: RecoveryRepositorySnapshot; readonly selection: T } | null =
    null;
  return () => {
    const snapshot = getSnapshot();
    if (cached?.snapshot === snapshot) return cached.selection;
    const next = select(snapshot);
    const selection = cached !== null && shallow(cached.selection, next) ? cached.selection : next;
    cached = { snapshot, selection };
    return selection;
  };
}
