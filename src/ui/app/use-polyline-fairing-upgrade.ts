import { useEffect } from 'react';
import { useStore } from '../state';
import { upgradeProjectPolylineFairing } from '../state/polyline-fairing-upgrade';
import { useToastStore } from '../state/toast-store';

type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];

export function upgradeCurrentProjectPolylineFairing(pushToast: PushToast): number {
  const state = useStore.getState();
  const upgraded = upgradeProjectPolylineFairing(state.project);
  if (upgraded.upgradedCount === 0) return 0;
  // eslint-disable-next-line kerfdesk/no-raw-project-set-state -- a format upgrade of drawn paths already in the document authors no new artwork, so like opening it, it skips the Pro guard (ADR-592 decision 5).
  useStore.setState({ project: upgraded.project, dirty: true });
  pushToast(
    `Smoothed ${upgraded.upgradedCount} existing drawn ${upgraded.upgradedCount === 1 ? 'path' : 'paths'}.`,
    'success',
  );
  return upgraded.upgradedCount;
}

/** Upgrade the project already held in memory when this feature first loads. */
export function usePolylineFairingUpgrade(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    upgradeCurrentProjectPolylineFairing(pushToast);
    return useStore.subscribe((state, previous) => {
      if (state.project !== previous.project) {
        queueMicrotask(() => upgradeCurrentProjectPolylineFairing(pushToast));
      }
    });
  }, [pushToast]);
}
